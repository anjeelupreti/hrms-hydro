"""What a payroll period *is*, and the one place it becomes a date range.

**D‑06.** A run stored `period_year=2026, period_month=8` and five places
independently turned that into 1–31 August with `monthrange`. For a company on
Bikram Sambat that is the wrong month: their Shrawan 2083 runs 17 July to 16
August, so a "August 2026" run paid across two of their months and matched
neither. The payslip printed BS and the statutory rates keyed on the BS fiscal
year, which made it worse — the labels agreed with the law while the window
underneath did not.

**A period is a business identity, not a date.** That is the line settled in the
checklist: a *date* is Gregorian and converts at the edge; a *period* is what
the company calls the thing it is paying for, and is stored in the company's own
calendar. So the run now carries which calendar its two numbers are in, and the
window is derived from all three.

**Existing runs stay Gregorian, and that is not a compatibility shim.** They
were computed over 1–31 August. Relabelling them "Shrawan 2083" would assert
that money was paid for a period it was not paid for — the one thing a payroll
record must never do. The migration therefore stamps every existing run `AD`,
which is exactly what it was, and only new runs follow the company.
"""

from __future__ import annotations

from datetime import date

from core.calendars import get_calendar, company_calendar


def default_period_calendar() -> str:
    """Which calendar a *new* run's period is expressed in.

    A callable model default rather than a constant, because the answer is the
    company's and is not known when the class is defined.
    """
    return company_calendar().key


def window_for(calendar_key: str, year: int, month: int) -> tuple[date, date, int]:
    """`(first day, last day, length)` in Gregorian dates, for any calendar.

    The length is counted from the two dates rather than asked for separately,
    so a month can never report a different number of days than the range it
    hands back — the two disagreeing is precisely the bug that prorates a
    leaver's final month wrongly.
    """
    calendar = get_calendar(calendar_key)
    start = calendar.month_start(year, month)
    end = calendar.month_end(year, month)
    return start, end, (end - start).days + 1


def period_window(run) -> tuple[date, date, int]:
    """The window a run pays over. **The only derivation of it.**"""
    return window_for(run.period_calendar, run.period_year, run.period_month)


def period_label(run) -> str:
    """What to call the period out loud — "Shrawan 2083", "August 2026".

    Falls back to the bare numbers rather than raising: a run whose month the
    table cannot express must still be listable, because a run you cannot see
    is a run you cannot fix.
    """
    try:
        calendar = get_calendar(run.period_calendar)
        return f"{calendar.month_name(run.period_month)} {run.period_year}"
    except (ValueError, KeyError, IndexError):
        return f"{run.period_year}-{run.period_month:02d}"


def current_period(calendar_key: str | None = None) -> tuple[str, int, int]:
    """The period containing today, for defaulting the "new run" form.

    Offered by the server so the browser does not need a conversion table to
    work out which month it is proposing to pay.
    """
    calendar = get_calendar(calendar_key) if calendar_key else company_calendar()
    today = calendar.from_gregorian(date.today())
    return calendar.key, today.year, today.month
