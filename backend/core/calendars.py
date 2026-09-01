"""Calendar systems, and the fiscal year built on them.

**Why an abstraction rather than "just use Nepali dates".** §1.1 advantage #2 is
that our rules are data: the engine can be taught any country. The moment a
Bikram Sambat month is assumed anywhere in `payroll/` or `leave/`, that stops
being true and we become a Nepal product with extra steps. So domain code asks a
`CalendarSystem` what the period is, and Nepal is one implementation of that
question rather than the answer baked into the caller.

**Why a library for the conversion.** Bikram Sambat month lengths vary between
29 and 32 days with no formula behind them — the calendar is astronomical, and
each year's twelve lengths are published rather than computed. Conversion is
therefore a ~100-year lookup table that can only be transcribed, and a
transcription slip does not raise: it silently returns a date one day out, which
in payroll is a period boundary in the wrong place and a wrong payslip for
everyone in it. `nepali-datetime` carries a maintained table; this module owns
the seam, the validation and the fiscal-year rules on top of it.
"""

from __future__ import annotations

import copy
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date

import nepali_datetime


class UnsupportedDateError(ValueError):
    """A date outside the calendar's usable range.

    Raised rather than clamped or extrapolated. A conversion table has hard
    edges, and guessing past them produces a plausible-looking wrong answer —
    the worst possible failure for a date a payslip is keyed on.
    """


@dataclass(frozen=True)
class CalendarDate:
    """A date as one calendar sees it, plus the Gregorian date it maps to.

    `gregorian` is always present because storage is always Gregorian: the
    database keeps one unambiguous timeline and calendars are a presentation and
    period-boundary concern. Storing BS strings would make every date query a
    conversion.
    """

    year: int
    month: int
    day: int
    gregorian: date

    def __str__(self) -> str:
        return f"{self.year}-{self.month:02d}-{self.day:02d}"


class CalendarSystem(ABC):
    """What domain code is allowed to ask about dates.

    Deliberately small. Anything a payroll run, a leave accrual or a report
    needs — which period a date falls in, where that period starts and ends,
    what to call it — is here. Anything calendar-specific is not.
    """

    key: str
    label: str
    month_names: tuple[str, ...]
    #: Month number the fiscal year opens on.
    fiscal_start_month: int

    @abstractmethod
    def from_gregorian(self, value: date) -> CalendarDate: ...

    @abstractmethod
    def to_gregorian(self, year: int, month: int, day: int) -> date: ...

    @abstractmethod
    def month_length(self, year: int, month: int) -> int: ...

    def month_start(self, year: int, month: int) -> date:
        return self.to_gregorian(year, month, 1)

    def month_end(self, year: int, month: int) -> date:
        return self.to_gregorian(year, month, self.month_length(year, month))

    def month_name(self, month: int) -> str:
        if not 1 <= month <= 12:
            raise UnsupportedDateError(f"{self.label} has no month {month}")
        return self.month_names[month - 1]

    # ── Fiscal year ──────────────────────────────────────────────────────
    #
    # Expressed here rather than in payroll because the *rule* is a property of
    # the calendar: which month opens the year, and therefore which label a date
    # belongs to. Payroll asks; it does not decide.

    def fiscal_year_of(self, value: date) -> int:
        """The opening year of the fiscal year containing `value`.

        Returns the *first* of the pair — FY 2082/83 is `2082` — because a
        single number is what a database column and a filter can hold, and the
        pair is a presentation of it (`fiscal_year_label`).
        """
        cal = self.from_gregorian(value)
        return cal.year if cal.month >= self.fiscal_start_month else cal.year - 1

    def fiscal_year_label(self, start_year: int) -> str:
        """`2082` → `"2082/83"`.

        The two-digit tail is how it is written on every Nepali filing, payslip
        and report. A year that rolls the century (2099/00) still reads
        correctly because the tail is taken modulo 100, not sliced off the
        string.
        """
        return f"{start_year}/{(start_year + 1) % 100:02d}"

    def with_fiscal_start(self, month: int | None) -> CalendarSystem:
        """This calendar, opening its financial year on `month`.

        **A copy, never a mutation.** `CALENDARS` holds one shared instance per
        calendar and the whole process resolves through it, so setting
        the attribute in place would give one caller's fiscal year to every
        other — a leak across companies in the one module that decides what a payroll
        period means.

        `None` returns `self`, so a company that never answered the question
        keeps the calendar's own rule and pays no allocation for it.
        """
        if month is None or month == self.fiscal_start_month:
            return self
        if not 1 <= month <= 12:
            raise UnsupportedDateError(f"{self.label} has no month {month}")
        clone = copy.copy(self)
        # Shadows the class attribute on this instance only.
        clone.fiscal_start_month = month
        return clone

    def fiscal_year_bounds(self, start_year: int) -> tuple[date, date]:
        """First and last Gregorian day of a fiscal year.

        The end is the day before the next year opens, rather than "the last day
        of month N" — that way a calendar whose final month changes length does
        not need special-casing here.
        """
        start = self.month_start(start_year, self.fiscal_start_month)
        next_start = self.month_start(start_year + 1, self.fiscal_start_month)
        return start, date.fromordinal(next_start.toordinal() - 1)


class Gregorian(CalendarSystem):
    """The default, and the fallback for any company without a country pack."""

    key = "AD"
    label = "Gregorian"
    month_names = (
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    )
    # Calendar-year fiscal by default. A company on an April or July fiscal year
    # is a country-pack setting, not a different calendar.
    fiscal_start_month = 1

    def from_gregorian(self, value: date) -> CalendarDate:
        return CalendarDate(value.year, value.month, value.day, value)

    def to_gregorian(self, year: int, month: int, day: int) -> date:
        try:
            return date(year, month, day)
        except ValueError as exc:
            raise UnsupportedDateError(str(exc)) from exc

    def month_length(self, year: int, month: int) -> int:
        from calendar import monthrange

        return monthrange(year, month)[1]


class BikramSambat(CalendarSystem):
    """Nepal's official calendar.

    The fiscal year opens on **Shrawan 1** (month 4) and closes at the end of
    **Ashad** (month 3) the following year, which is why `fiscal_year_of` cannot
    be "the calendar year": for the first three months of a BS year, the fiscal
    year is the one that opened the previous BS year.
    """

    key = "BS"
    label = "Bikram Sambat"
    month_names = (
        "Baishakh", "Jestha", "Ashad", "Shrawan", "Bhadra", "Ashwin",
        "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
    )
    fiscal_start_month = 4  # Shrawan

    def from_gregorian(self, value: date) -> CalendarDate:
        try:
            bs = nepali_datetime.date.from_datetime_date(value)
        except Exception as exc:  # the table has hard edges; say so
            raise UnsupportedDateError(
                f"{value.isoformat()} is outside the supported Bikram Sambat range"
            ) from exc
        return CalendarDate(bs.year, bs.month, bs.day, value)

    def to_gregorian(self, year: int, month: int, day: int) -> date:
        try:
            return nepali_datetime.date(year, month, day).to_datetime_date()
        except Exception as exc:
            raise UnsupportedDateError(
                f"BS {year}-{month:02d}-{day:02d} is not a valid Bikram Sambat date"
            ) from exc

    def month_length(self, year: int, month: int) -> int:
        """Days in a BS month — 29 to 32, from the table, never computed."""
        if not 1 <= month <= 12:
            raise UnsupportedDateError(f"Bikram Sambat has no month {month}")
        start = self.to_gregorian(year, month, 1)
        if month == 12:
            next_start = self.to_gregorian(year + 1, 1, 1)
        else:
            next_start = self.to_gregorian(year, month + 1, 1)
        return (next_start - start).days


    # ── Nepali script ────────────────────────────────────────────────────
    #
    # Rendered here rather than in the frontend for the same reason the
    # conversion is: one source, already tested. A second transliteration table
    # in TypeScript is a second thing to disagree with this one.

    #: Devanagari digits ०–९, indexed by value.
    DEVANAGARI_DIGITS = "०१२३४५६७८९"

    MONTH_NAMES_NP = (
        "बैशाख", "जेठ", "असार", "श्रावण", "भदौ", "असोज",
        "कार्तिक", "मंसिर", "पुष", "माघ", "फागुन", "चैत",
    )
    #: Indexed by `date.weekday()` — Monday is 0, matching Python.
    WEEKDAY_NAMES_NP = (
        "सोमबार", "मंगलबार", "बुधबार", "बिहीबार", "शुक्रबार", "शनिबार", "आइतबार",
    )

    @classmethod
    def to_devanagari(cls, value) -> str:
        """`2083` → `२०८३`. Non-digits pass through, so "2082/83" keeps its slash."""
        return "".join(cls.DEVANAGARI_DIGITS[int(ch)] if ch.isdigit() else ch for ch in str(value))

    def format_np(self, value: date) -> str:
        """A full Nepali date line: `बुधबार, २७ श्रावण २०८३`."""
        cal = self.from_gregorian(value)
        return (
            f"{self.WEEKDAY_NAMES_NP[value.weekday()]}, "
            f"{self.to_devanagari(cal.day)} {self.MONTH_NAMES_NP[cal.month - 1]} "
            f"{self.to_devanagari(cal.year)}"
        )


CALENDARS: dict[str, CalendarSystem] = {
    Gregorian.key: Gregorian(),
    BikramSambat.key: BikramSambat(),
}


def get_calendar(key: str | None) -> CalendarSystem:
    """Resolve a calendar by key, defaulting to Gregorian.

    Unknown keys fall back rather than raising: a company with a mistyped or
    not-yet-supported setting should still be able to run payroll on Gregorian
    dates, not be locked out of the product by a settings value.
    """
    return CALENDARS.get((key or "").upper(), CALENDARS[Gregorian.key])


def company_calendar() -> CalendarSystem:
    """The calendar **this company** chose at setup.

    The one place that answers "which calendar?", so nothing else has to guess.
    Hardcoding Bikram Sambat anywhere — `payroll/services.py` above all — is what
    §2.3 means when it says a built-in Nepal rule costs us the engine: a company
    on a January–December year has no way to say so, and gets payslips stamped
    with a fiscal year they do not use.

    Falls back to Bikram Sambat when there is no company profile yet — a fresh
    schema mid-provisioning, or a management command running before setup. That
    is the same answer the hardcoding gave, so nothing changes behaviour until
    a company actually chooses otherwise.

    **And the fiscal year it opens on**, where the company has said. A financial
    year is a country's rule rather than a calendar's — India and the UK run
    April–March on the same Gregorian calendar the US federal year opens in
    October — so the calendar supplies the default and the company may override
    it. A Nepali company leaves it empty and gets Shrawan–Ashad, exactly as
    before this field existed.
    """
    try:
        from organization.models import CompanyProfile

        profile = CompanyProfile.objects.first()
        if profile is not None:
            return get_calendar(profile.calendar).with_fiscal_start(
                profile.fiscal_year_start_month
            )
    except Exception:  # noqa: BLE001 — no schema, no table, no profile yet
        pass
    return CALENDARS[BikramSambat.key]


def fiscal_year_for(value: date, calendar_key: str | None = None) -> int:
    """The fiscal year a date belongs to — **the one way to ask.**

    One function, so there is no second opinion. Asked separately, two modules
    answer differently and neither is wrong on its own: a reader keyed on the BS
    fiscal year (2082) and a writer keyed on `start_date.year`, the Gregorian
    one (2026), are addressing different rows — so approving leave decrements a
    balance the employee's own portal never shows, and the portal's figure never
    moves however much leave is taken.

    **Uses the company's chosen calendar** unless a caller names one explicitly.
    Defaulting to Bikram Sambat would answer for a company nobody has asked.

    Falls back to the Gregorian year if the conversion table cannot place the
    date, matching the portal's own reasoning — a balance keyed on the wrong
    year is recoverable, and refusing to record leave at all is not.
    """
    calendar = get_calendar(calendar_key) if calendar_key else company_calendar()
    try:
        return calendar.fiscal_year_of(value)
    except Exception:  # noqa: BLE001 — see the docstring
        return value.year
