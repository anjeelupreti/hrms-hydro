"""The nightly absence sweep, and the day it must not run on.

`ShiftAssignment` is a date range, not a roster — it records which shift
somebody is on, never which days of the week they work. So "has an active
assignment and no attendance log" describes every employee on every Saturday.

This matters because `absent_days` feeds `unpaid_days`, which scales pay
directly in `compute_payslip`. An unchecked sweep run daily on a Monday-to-
Friday company accrues roughly nine absences a month per person and takes about
a third of everybody's salary.
"""

from datetime import date

import pytest
from django.core.management import call_command

from attendance.models import AttendanceLog, Shift, ShiftAssignment
from notifications.models import Holiday
from organization.models import CompanyProfile

pytestmark = pytest.mark.django_db

SATURDAY = date(2026, 3, 7)
MONDAY = date(2026, 3, 9)


@pytest.fixture
def rostered(company, payroll_setup):
    """One employee, on a shift, with a Monday-to-Friday company around them."""
    profile = CompanyProfile.get_solo()
    profile.working_days = [1, 2, 3, 4, 5]
    profile.save(update_fields=["working_days"])

    shift = Shift.objects.create(name="General", start_time="09:00", end_time="17:00")
    ShiftAssignment.objects.create(
        employee=payroll_setup["emp"], shift=shift, start_date=date(2026, 1, 1)
    )
    yield payroll_setup["emp"]


def _absences(company, on_date):
    return AttendanceLog.objects.filter(date=on_date, status=AttendanceLog.Status.ABSENT).count()


def test_nobody_is_marked_absent_on_a_non_working_day(company, rostered):
    """A Saturday is not an absence."""
    call_command("mark_absent_employees", f"--date={SATURDAY}")

    assert _absences(company, SATURDAY) == 0


def test_nobody_is_marked_absent_on_a_holiday(company, rostered):
    """A holiday is a day off the company gave everybody. Recording it as an
    absence bills them for it."""
    Holiday.objects.create(name="A festival", date=MONDAY)

    call_command("mark_absent_employees", f"--date={MONDAY}")

    assert _absences(company, MONDAY) == 0


def test_a_working_day_with_no_log_is_still_an_absence(company, rostered):
    """The sweep still has to do its job — the fix must not switch it off."""
    call_command("mark_absent_employees", f"--date={MONDAY}")

    assert _absences(company, MONDAY) == 1


def test_a_day_already_logged_is_left_alone(company, rostered):
    AttendanceLog.objects.create(
        employee=rostered, date=MONDAY, status=AttendanceLog.Status.PRESENT
    )

    call_command("mark_absent_employees", f"--date={MONDAY}")

    assert _absences(company, MONDAY) == 0


def test_an_unconfigured_working_week_still_sweeps(company, rostered):
    """A company that has not said which days it works gets the old behaviour,
    not a sweep that silently stops running."""
    profile = CompanyProfile.get_solo()
    profile.working_days = []
    profile.save(update_fields=["working_days"])

    call_command("mark_absent_employees", f"--date={SATURDAY}")

    assert _absences(company, SATURDAY) == 1
