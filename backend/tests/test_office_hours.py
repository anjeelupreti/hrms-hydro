"""D24 — what marks somebody late who has no shift assigned.

**Settled 25 August: the company's opening hours.** The alternative was that an
unshifted person can never be late, which is safe but wrong about how an office
works — most staff are never assigned a shift, they come in when the office
opens, and judging lateness only for shift workers is a rule nobody would
recognise as fair.

An assigned shift still wins. This is a floor, not an override.
"""

from datetime import date, datetime, time, timedelta

import pytest
from django.utils import timezone

from attendance.models import AttendanceLog, Shift, ShiftAssignment
from attendance.services import compute_check_in_status
from employees.models import Employee
from organization.models import CompanyProfile

pytestmark = pytest.mark.django_db

ON = date(2026, 8, 3)


def _at(hour, minute=0):
    return timezone.make_aware(datetime.combine(ON, time(hour, minute)))


@pytest.fixture
def worker(company, employee_user):
    yield Employee.objects.create(
        user=employee_user, employee_code="EMP-800", date_joined=date(2026, 1, 1)
    )


def test_with_no_office_hours_nobody_is_ever_late(company, worker):
    """🔒 Additive. A company that has not answered the question behaves exactly
    as it did before the field existed — "no opinion" and "nine o'clock" are
    different answers, and a default would invent a schedule and dock pay."""
    assert CompanyProfile.get_solo().office_start_time is None

    assert compute_check_in_status(worker, ON, _at(11, 30)) == AttendanceLog.Status.PRESENT


def test_office_hours_decide_it_for_somebody_with_no_shift(company, worker):
    """The case D24 was actually about — most staff, most of the time."""
    profile = CompanyProfile.get_solo()
    profile.office_start_time = time(9, 0)
    profile.office_grace_period_minutes = 15
    profile.save()

    assert compute_check_in_status(worker, ON, _at(9, 10)) == AttendanceLog.Status.PRESENT
    # Inside the grace period is not late; past it is.
    assert compute_check_in_status(worker, ON, _at(9, 16)) == AttendanceLog.Status.LATE


def test_an_assigned_shift_still_wins(company, worker):
    """🔒 A night-shift worker must be judged against their night shift, not
    against the hours the office happens to keep."""
    profile = CompanyProfile.get_solo()
    profile.office_start_time = time(9, 0)
    profile.save()

    night = Shift.objects.create(
        name="Night", start_time=time(22, 0), end_time=time(6, 0),
        grace_period_minutes=10,
    )
    ShiftAssignment.objects.create(employee=worker, shift=night, start_date=ON)

    # Long past the office opening, but well inside their own shift.
    assert compute_check_in_status(worker, ON, _at(21, 55)) == AttendanceLog.Status.PRESENT
    assert compute_check_in_status(worker, ON, _at(22, 30)) == AttendanceLog.Status.LATE


def test_the_two_grace_periods_are_independent(company, worker):
    """A company's general tolerance for traffic and a particular shift's are
    different decisions — changing one must not move the other."""
    profile = CompanyProfile.get_solo()
    profile.office_start_time = time(9, 0)
    profile.office_grace_period_minutes = 30
    profile.save()

    # Generous company grace: 9:20 is fine with no shift.
    assert compute_check_in_status(worker, ON, _at(9, 20)) == AttendanceLog.Status.PRESENT

    strict = Shift.objects.create(
        name="Strict", start_time=time(9, 0), end_time=time(17, 0),
        grace_period_minutes=5,
    )
    ShiftAssignment.objects.create(employee=worker, shift=strict, start_date=ON)

    # Same arrival, now judged by the shift's own tolerance.
    assert compute_check_in_status(worker, ON, _at(9, 20)) == AttendanceLog.Status.LATE


def test_an_expired_assignment_falls_back_to_the_office(company, worker):
    """Somebody whose shift ended last month is an ordinary office worker
    again, not somebody who can never be late."""
    profile = CompanyProfile.get_solo()
    profile.office_start_time = time(9, 0)
    profile.office_grace_period_minutes = 15
    profile.save()

    old_shift = Shift.objects.create(
        name="Old", start_time=time(14, 0), end_time=time(22, 0),
        grace_period_minutes=15,
    )
    ShiftAssignment.objects.create(
        employee=worker, shift=old_shift,
        start_date=ON - timedelta(days=60), end_date=ON - timedelta(days=30),
    )

    assert compute_check_in_status(worker, ON, _at(9, 45)) == AttendanceLog.Status.LATE
