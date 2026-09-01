"""D-06 — a payroll period knows which calendar it is in.

**A period is a window, not two numbers.** Turning `period_year` and
`period_month` into a Gregorian month with `monthrange` gives the wrong month
for a company keeping Bikram Sambat books: Shrawan 2083 runs 17 July to 16
August, so an "August 2026" run pays across two of their months and matches
neither — while the payslip prints BS and the statutory rates key on the BS
fiscal year. The labels agree with the law; the window underneath would not.

These tests pin the window, because a wrong one does not raise. It pays a real
amount for the wrong set of days, and nothing downstream can tell.
"""

from datetime import date

import pytest

from core.calendars import get_calendar
from payroll.models import PayrollRun
from payroll.periods import period_label, period_window, window_for

pytestmark = pytest.mark.django_db


# ── The window, pinned to published dates ────────────────────────────────


def test_a_gregorian_period_is_the_gregorian_month():
    """Unchanged behaviour for a company on the Gregorian calendar, which is
    what makes the migration safe for every run that already exists."""
    start, end, days = window_for("AD", 2026, 8)
    assert (start, end, days) == (date(2026, 8, 1), date(2026, 8, 31), 31)


def test_a_bikram_sambat_period_is_not_the_gregorian_month_of_the_same_number():
    """Shrawan 2083 — the whole defect in one assertion.

    Month 4 of 2083 is *not* April 2083 and not August 2026. It straddles two
    Gregorian months, which is exactly why deriving the window with
    `monthrange` could never have been right.
    """
    start, end, days = window_for("BS", 2083, 4)
    assert start == date(2026, 7, 17)
    assert end == date(2026, 8, 16)
    assert days == 31
    # It crosses a Gregorian month boundary. If this ever stops being true the
    # test has been rewritten into something that proves nothing.
    assert start.month != end.month


def test_the_length_always_matches_the_range():
    """A month reporting a different number of days than the range it hands
    back is how a leaver's final month gets prorated against the wrong
    denominator. Checked across a whole Bikram Sambat year, whose months run
    29 to 32 days and are not derivable by any rule."""
    for month in range(1, 13):
        start, end, days = window_for("BS", 2083, month)
        assert days == (end - start).days + 1
        assert 29 <= days <= 32


def test_bikram_sambat_months_are_not_all_the_same_length():
    """Guards the test above from passing on a calendar that ignored BS and
    quietly answered with Gregorian months."""
    lengths = {window_for("BS", 2083, m)[2] for m in range(1, 13)}
    assert len(lengths) > 1


# ── The run carries its own calendar ─────────────────────────────────────


def test_a_new_run_follows_the_companies_calendar(company):
    """The default is a callable, so it is the company's answer and not one
    baked in when the class was defined."""
    run = PayrollRun.objects.create(period_year=2083, period_month=4)
    assert run.period_calendar == "BS"
    assert period_window(run)[0] == date(2026, 7, 17)


def test_a_run_can_be_gregorian_on_a_bikram_sambat_company(company):
    """Which is what every run created before the migration is.

    Relabelling those would assert that money was paid for a period it was not
    paid for, so they stay Gregorian and keep covering the days they covered.
    """
    run = PayrollRun.objects.create(
        period_calendar="AD", period_year=2026, period_month=8
    )
    assert period_window(run) == (date(2026, 8, 1), date(2026, 8, 31), 31)


def test_the_same_numbers_in_two_calendars_are_two_different_periods(company):
    """So the unique constraint has to include the calendar.

    Without it a company that switched could not be stopped from creating a
    second run over overlapping days, because the two carry different year
    numbers and look unrelated.
    """
    PayrollRun.objects.create(period_calendar="AD", period_year=2083, period_month=4)
    PayrollRun.objects.create(period_calendar="BS", period_year=2083, period_month=4)
    assert PayrollRun.objects.filter(period_year=2083, period_month=4).count() == 2


def test_a_period_is_named_in_its_own_calendar(company):
    bs = PayrollRun.objects.create(period_calendar="BS", period_year=2083, period_month=4)
    ad = PayrollRun.objects.create(period_calendar="AD", period_year=2026, period_month=8)
    assert period_label(bs) == "Shrawan 2083"
    assert period_label(ad) == "August 2026"


def test_naming_a_period_the_table_cannot_express_does_not_raise(company):
    """A run you cannot see is a run you cannot fix, so an unnameable period
    falls back to its numbers rather than breaking the list it appears in."""
    run = PayrollRun.objects.create(period_calendar="BS", period_year=2083, period_month=13)
    assert period_label(run) == "2083-13"


# ── The window is what payroll actually uses ─────────────────────────────


def test_the_run_pays_over_its_own_month_not_the_gregorian_one(company, payroll_setup):
    """The end-to-end version: a Bikram Sambat run must prorate against
    Shrawan's days, not August's.

    The employee joins on 1 August 2026 — inside Shrawan, which ends on the
    16th, but only just. A run deriving 1–31 August instead would pay them for
    all 31 days; the truth is 16.
    """
    from employees.models import Employee
    from payroll.services import compute_proration

    employee = payroll_setup["emp"]
    run = PayrollRun.objects.create(
        period_calendar="BS", period_year=2083, period_month=4
    )
    Employee.objects.filter(pk=employee.pk).update(date_joined=date(2026, 8, 1))
    employee.refresh_from_db()
    structure = employee.salary_structures.latest("effective_from")

    _factor, period_days, payable_days = compute_proration(run, employee, structure)

    # Shrawan is 31 days, like August — the same number over different days,
    # which is what made this so quiet.
    assert period_days == 31
    assert payable_days == 16  # 1 to 16 August, where Shrawan ends


def test_a_locked_bikram_sambat_run_still_blocks_regularisation(company):
    """The lock matched `period_year=date.year`, so on a Bikram Sambat company
    it matched nothing and silently stopped working — attendance could be
    rewritten underneath a run that had already been paid."""
    from django.utils import timezone

    from attendance.regularisation import _payroll_is_locked_for

    PayrollRun.objects.create(
        period_calendar="BS",
        period_year=2083,
        period_month=4,
        locked_at=timezone.now(),
    )
    # Inside Shrawan 2083.
    assert _payroll_is_locked_for(date(2026, 8, 10)) is True
    # The day after it ends.
    assert _payroll_is_locked_for(date(2026, 8, 17)) is False


def test_the_fiscal_year_for_tax_is_not_the_periods_year():
    """Baishakh 2083 is month 1, so it carries year 2083 while belonging to
    fiscal year 2082 — and `compute_payslip` was handing the slab lookup the
    period's year. Three months of every year were taxed against a fiscal year
    that does not exist yet, and a missing slab table taxes nobody.
    """
    calendar = get_calendar("BS")
    baishakh_end = calendar.month_end(2083, 1)

    assert calendar.fiscal_year_of(baishakh_end) == 2082
    assert calendar.fiscal_year_of(baishakh_end) != 2083
