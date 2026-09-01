"""Calendar conversion and fiscal-year rules.

**Why these tests are load-bearing.** A wrong date conversion does not raise —
it returns a real date, one or two days out. In payroll that is a period
boundary in the wrong place, which silently moves a day's pay, an accrual or a
tax period for everyone in the run. Nothing downstream can detect it. So the
conversions are pinned to **published anchors** rather than to whatever the
library happens to return, which would only test that the library agrees with
itself.
"""

from datetime import date

import pytest

from core.calendars import (
    BikramSambat,
    Gregorian,
    UnsupportedDateError,
    get_calendar,
)

bs = BikramSambat()
ad = Gregorian()


# ── Conversion, pinned to published dates ────────────────────────────────


@pytest.mark.parametrize(
    ("bs_year", "gregorian"),
    [
        (2080, date(2023, 4, 14)),
        (2081, date(2024, 4, 13)),
        (2082, date(2025, 4, 14)),
    ],
)
def test_nepali_new_year_falls_on_the_published_day(bs_year, gregorian):
    """1 Baishakh is the most widely published BS↔AD anchor there is.

    Three consecutive years on purpose: the Gregorian date moves between the
    13th and 14th, so a single anchor could pass against a table that was
    uniformly off by a day.
    """
    assert bs.to_gregorian(bs_year, 1, 1) == gregorian
    assert bs.from_gregorian(gregorian).year == bs_year
    assert bs.from_gregorian(gregorian).month == 1
    assert bs.from_gregorian(gregorian).day == 1


def test_conversion_round_trips():
    original = date(2026, 8, 12)
    converted = bs.from_gregorian(original)
    assert bs.to_gregorian(converted.year, converted.month, converted.day) == original


def test_a_bs_month_is_not_a_fixed_length():
    """The point of the table.

    If month lengths were derivable, the whole dependency would be unnecessary.
    Asserting that they actually vary is what proves we are reading real data
    rather than a 30-day approximation that would drift a day per month.
    """
    lengths = {bs.month_length(2082, m) for m in range(1, 13)}
    assert len(lengths) > 1
    assert all(29 <= length <= 32 for length in lengths)


def test_month_start_and_end_bracket_the_month():
    start = bs.month_start(2082, 4)
    end = bs.month_end(2082, 4)
    assert bs.from_gregorian(start).day == 1
    assert bs.from_gregorian(end).month == 4
    # The day after the end must be the next month, or the boundary is wrong.
    assert bs.from_gregorian(date.fromordinal(end.toordinal() + 1)).month == 5


# ── Fiscal year — Shrawan to Ashad ───────────────────────────────────────


def test_the_fiscal_year_opens_on_shrawan():
    """Shrawan 1 opens the year; the day before it closes the previous one.

    Tested as a pair across the boundary rather than as a single date, because
    an off-by-one in `fiscal_year_of` only shows up on the boundary itself.
    """
    shrawan_1 = bs.month_start(2083, 4)
    ashad_end = date.fromordinal(shrawan_1.toordinal() - 1)

    assert bs.fiscal_year_of(shrawan_1) == 2083
    assert bs.fiscal_year_of(ashad_end) == 2082


def test_the_first_three_bs_months_belong_to_the_previous_fiscal_year():
    """The rule that makes this more than "the calendar year".

    Baishakh, Jestha and Ashad of BS year N fall in fiscal year N-1, because the
    year opened the previous Shrawan. Getting this wrong files three months of
    payroll under the wrong year.
    """
    for month in (1, 2, 3):
        assert bs.fiscal_year_of(bs.month_start(2083, month)) == 2082
    for month in (4, 5, 12):
        assert bs.fiscal_year_of(bs.month_start(2083, month)) == 2083


def test_the_label_is_the_pair_every_filing_uses():
    assert bs.fiscal_year_label(2082) == "2082/83"
    assert bs.fiscal_year_label(2083) == "2083/84"


def test_the_label_survives_the_century_roll():
    """2099/00, not 2099/100.

    The tail is taken modulo 100 rather than sliced off the string, so the one
    year this could break is the one year nobody would test by hand.
    """
    assert bs.fiscal_year_label(2099) == "2099/00"


def test_fiscal_year_bounds_are_contiguous_with_the_next_year():
    """No gap and no overlap at the boundary.

    A day that belongs to neither fiscal year, or to both, is a day whose
    payroll either vanishes or is counted twice.
    """
    start, end = bs.fiscal_year_bounds(2082)
    next_start, _ = bs.fiscal_year_bounds(2083)

    assert bs.fiscal_year_of(start) == 2082
    assert bs.fiscal_year_of(end) == 2082
    assert date.fromordinal(end.toordinal() + 1) == next_start


# ── The abstraction holds ────────────────────────────────────────────────


def test_gregorian_answers_the_same_questions():
    """The engine must work with no country pack at all.

    If anything in the domain only makes sense under Bikram Sambat, this is
    where it surfaces — the default calendar has to satisfy the same interface.
    """
    assert ad.fiscal_year_of(date(2026, 8, 12)) == 2026
    assert ad.month_length(2024, 2) == 29  # leap year, from the stdlib
    start, end = ad.fiscal_year_bounds(2026)
    assert (start, end) == (date(2026, 1, 1), date(2026, 12, 31))


def test_an_unknown_calendar_falls_back_rather_than_locking_the_company_out():
    """A mistyped setting must not be able to stop payroll running.

    Falling back to Gregorian gives wrong *labels*; raising would give no
    payroll at all. The first is visible and correctable, the second is an
    outage caused by a settings typo.
    """
    assert get_calendar("nonsense").key == "AD"
    assert get_calendar(None).key == "AD"
    assert get_calendar("bs").key == "BS"


def test_a_date_outside_the_table_is_refused_not_guessed():
    """Hard edges, stated.

    Extrapolating past the table returns a plausible date that is wrong, which
    is strictly worse than an error — nothing downstream can tell it apart from
    a correct one.
    """
    with pytest.raises(UnsupportedDateError):
        bs.to_gregorian(9999, 1, 1)
    with pytest.raises(UnsupportedDateError):
        bs.to_gregorian(2082, 13, 1)


# ── The company chooses ───────────────────────────────────────────────────


@pytest.mark.django_db
def test_the_company_chooses_its_own_calendar(company):
    """🔒 The setting that stops this being a Nepal-only engine.

    Hardcoding `"BS"` anywhere — `payroll/services.py` above all, the file §2.3
    names when it says a built-in Nepal rule costs us the advantage — leaves a
    company on a January–December year no way to say so. Their fiscal year,
    statutory-rate lookups, leave entitlements and payslip stamps would all be
    computed against a year they do not use.
    """
    from core.calendars import company_calendar
    from organization.models import CompanyProfile

    profile = CompanyProfile.get_solo()

    profile.calendar = CompanyProfile.Calendar.GREGORIAN
    profile.save(update_fields=["calendar"])
    assert company_calendar().key == "AD"

    profile.calendar = CompanyProfile.Calendar.BIKRAM_SAMBAT
    profile.save(update_fields=["calendar"])
    assert company_calendar().key == "BS"


@pytest.mark.django_db
def test_a_gregorian_companies_fiscal_year_is_the_calendar_year(company):
    """The setting has to reach the thing everybody actually asks for."""
    from core.calendars import fiscal_year_for
    from organization.models import CompanyProfile

    profile = CompanyProfile.get_solo()
    profile.calendar = CompanyProfile.Calendar.GREGORIAN
    profile.save(update_fields=["calendar"])

    # March 2026 is FY 2082/83 in Bikram Sambat and simply 2026 here.
    assert fiscal_year_for(date(2026, 3, 2)) == 2026


# ── A financial year the company declares ─────────────────────────────────
#
# The calendar supplies a default; the country supplies the truth. India and the
# UK run April–March on the same Gregorian calendar the US federal year opens in
# October, so the year cannot be derived from the calendar alone.


@pytest.mark.django_db
def test_a_nepali_company_never_touches_this_and_nothing_changes(company):
    """The field is additive, and this is the test that says so.

    Every existing company is Nepali and every row ships `NULL`, so the whole
    feature must be invisible to them — same fiscal year, same label, same
    boundaries as before it existed.
    """
    from core.calendars import fiscal_year_for, company_calendar
    from organization.models import CompanyProfile

    assert CompanyProfile.get_solo().fiscal_year_start_month is None

    calendar = company_calendar()
    assert calendar.key == "BS"
    assert calendar.fiscal_start_month == 4  # Shrawan
    # 16 July 2026 is Ashad — the last month of the year that opened in 2082.
    assert fiscal_year_for(date(2026, 7, 16)) == 2082
    # 17 July 2026 is Shrawan 1 — the next one.
    assert fiscal_year_for(date(2026, 7, 17)) == 2083


@pytest.mark.django_db
def test_an_indian_company_gets_april_to_march(company):
    """The case the field exists for.

    Gregorian calendar, April–March year. Before this field the product
    silently asserted January–December for them — which is not a wrong label,
    it is a wrong *period*, so their leave entitlements and statutory lookups
    would key three months out.
    """
    from core.calendars import fiscal_year_for, company_calendar
    from organization.models import CompanyProfile

    profile = CompanyProfile.get_solo()
    profile.calendar = CompanyProfile.Calendar.GREGORIAN
    profile.fiscal_year_start_month = 4
    profile.save(update_fields=["calendar", "fiscal_year_start_month"])

    assert company_calendar().fiscal_start_month == 4

    # March still belongs to the year that opened last April.
    assert fiscal_year_for(date(2026, 3, 31)) == 2025
    assert fiscal_year_for(date(2026, 4, 1)) == 2026

    start, end = company_calendar().fiscal_year_bounds(2026)
    assert start == date(2026, 4, 1)
    assert end == date(2027, 3, 31)


@pytest.mark.django_db
def test_the_override_does_not_leak_between_companies(company):
    """🔒 `CALENDARS` holds one shared instance per calendar.

    Setting `fiscal_start_month` on it in place would hand the company's
    financial year to every other company in the process — in the one module
    that decides what a payroll period means. `with_fiscal_start` copies.
    """
    from core.calendars import CALENDARS, get_calendar

    shared = get_calendar("AD")
    moved = shared.with_fiscal_start(7)

    assert moved.fiscal_start_month == 7
    assert shared.fiscal_start_month == 1
    assert CALENDARS["AD"].fiscal_start_month == 1
    # No copy is made when there is nothing to override.
    assert shared.with_fiscal_start(None) is shared
    assert shared.with_fiscal_start(1) is shared


def test_a_month_that_does_not_exist_is_refused():
    """A settings value out of range is a bug, not a fiscal year."""
    with pytest.raises(UnsupportedDateError):
        get_calendar("AD").with_fiscal_start(13)


@pytest.mark.django_db
def test_the_start_month_cannot_move_once_payroll_has_run(company, admin_client):
    """The D‑06 lesson, applied.

    Moving the boundary re-keys which fiscal year a date belongs to, and leave
    balances, tax slabs and statutory rates are all keyed on it. Doing that
    under runs already computed would make finalised payslips refer to a year
    that no longer means what it meant when they were produced.
    """
    from organization.models import CompanyProfile
    from payroll.models import PayrollRun

    url = "/api/v1/organization/company-profile/"

    assert not PayrollRun.objects.exists()

    ok = admin_client.patch(url, {"fiscal_year_start_month": 4}, format="json")
    assert ok.status_code == 200, ok.data

    PayrollRun.objects.create(period_year=2083, period_month=1)

    refused = admin_client.patch(url, {"fiscal_year_start_month": 7}, format="json")
    assert refused.status_code == 400
    assert "financial year" in str(refused.data).lower()

    assert CompanyProfile.get_solo().fiscal_year_start_month == 4

    # Re-sending the value it already holds is not a change, so it is allowed.
    unchanged = admin_client.patch(url, {"fiscal_year_start_month": 4}, format="json")
    assert unchanged.status_code == 200


@pytest.mark.django_db
def test_the_settings_screen_is_served_its_own_month_names(company, admin_client):
    """A BS company picks "Shrawan", not "month 4".

    Served rather than shipped to the browser as a second month table — one of
    those disagreeing with the server is the shape of bug §2.6 exists to stop.
    """
    response = admin_client.get("/api/v1/organization/company-profile/")

    assert response.status_code == 200
    months = response.data["calendar_months"]
    assert [m["label"] for m in months][:4] == [
        "Baishakh", "Jestha", "Ashad", "Shrawan",
    ]
    assert response.data["fiscal_year_start_month"] is None
    # The default, resolved, so the screen never has to work it out.
    assert response.data["fiscal_year_start_month_effective"] == 4
    assert "/" in response.data["fiscal_year_label"]


@pytest.mark.django_db
def test_the_default_is_bikram_sambat(company):
    """A default is not an assumption: we sell to Nepal first, and a company
    elsewhere changes one field."""
    from core.calendars import company_calendar

    assert company_calendar().key == "BS"


# ── The endpoint the top bar calls ───────────────────────────────────────


@pytest.mark.django_db
def test_today_endpoint_returns_both_calendars(api_client, company, hr_user):
    """Covered because this is now on every page, not because it is complex.

    A 500 here would put an error in the top bar of the whole product, and the
    Nepali half is the part that can fail on its own — an unconvertible date
    must blank one segment, not the response.
    """
    api_client.force_authenticate(hr_user)
    response = api_client.get("/api/v1/organization/today/")

    assert response.status_code == 200
    body = response.json()

    assert body["gregorian"]["date"]
    assert body["gregorian"]["label"]
    # Nepali is best-effort by design, but for today's date it must be present.
    assert body["nepali"] is not None
    assert "/" in body["nepali"]["fiscal_year"]
    # Devanagari, not ASCII — the whole point of rendering it server-side.
    assert any("\u0966" <= ch <= "\u096f" for ch in body["nepali"]["fiscal_year_np"])


# ── Converting stored dates for display ──────────────────────────────────


@pytest.mark.django_db
def test_convert_answers_one_date(api_client, company, hr_user):
    """What a picker asks: one date, in the company's calendar."""
    api_client.force_authenticate(hr_user)
    response = api_client.get("/api/v1/organization/calendar/convert/?date=2026-08-18")

    assert response.status_code == 200
    body = response.json()
    assert body["calendar"] == "BS"
    assert body["gregorian"] == "2026-08-18"
    assert body["local"]["label"] == "2 Bhadra 2083"


@pytest.mark.django_db
def test_convert_answers_many_dates_in_one_request(api_client, company, hr_user):
    """What a *table* asks. Fifty rows firing fifty requests is the reason this
    call shape exists, and the browser only runs six at a time."""
    api_client.force_authenticate(hr_user)
    response = api_client.get(
        "/api/v1/organization/calendar/convert/"
        "?dates=2026-08-18,2026-04-13,1999-01-01"
    )

    assert response.status_code == 200
    dates = response.json()["dates"]
    # Keyed by the date as asked, so a caller looks up what it sent rather
    # than matching on order.
    assert dates["2026-08-18"]["label"] == "2 Bhadra 2083"
    assert dates["2026-04-13"]["label"] == "30 Chaitra 2082"
    assert dates["1999-01-01"]["label"] == "17 Poush 2055"


@pytest.mark.django_db
def test_a_bad_date_in_a_batch_does_not_lose_the_good_ones(api_client, company, hr_user):
    """One unconvertible date must not take the other forty-nine with it.

    `None` is the honest answer for a date the table cannot express — the
    browser then shows the Gregorian date it already had, which is never wrong,
    only un-localised. A plausible *wrong* BS date would be worse, because
    nothing downstream could tell it apart from a right one.
    """
    api_client.force_authenticate(hr_user)
    response = api_client.get(
        "/api/v1/organization/calendar/convert/"
        "?dates=2026-08-18,not-a-date,1850-01-01"
    )

    assert response.status_code == 200
    dates = response.json()["dates"]
    assert dates["2026-08-18"]["label"] == "2 Bhadra 2083"
    assert dates["not-a-date"] is None
    # Before the table starts: outside its range, not a crash.
    assert dates["1850-01-01"] is None


@pytest.mark.django_db
def test_an_unbounded_batch_is_refused(api_client, company, hr_user):
    """An uncapped list is a way to ask one request to do unbounded work."""
    from organization.calendar_api import MAX_BATCH

    api_client.force_authenticate(hr_user)
    response = api_client.get(
        "/api/v1/organization/calendar/convert/?dates="
        + ",".join(["2026-08-18"] * (MAX_BATCH + 1))
    )

    assert response.status_code == 400
