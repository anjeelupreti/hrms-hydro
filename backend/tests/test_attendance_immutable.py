"""Yesterday's attendance is history, and nobody edits history.

The owner's rule, stated plainly: **attendance older than today is not editable
by HR or by anyone.** The code already worked this way and said so in a
docstring — and a docstring is not a guarantee. This session has repeatedly
found capabilities that were documented, believed, and quietly not wired; the
difference between a rule and a comment is a test that fails when somebody
removes it.

**Why the rule exists.** Attendance decides pay. A record that can be rewritten
after the fact is a record that can be rewritten *after somebody has seen what
it costs*, and the person best placed to do that is the person with the most
authority — which is why the check sits ahead of the role logic rather than
inside it, and refuses an owner as readily as an employee.

**Corrections still happen, through a door that leaves a trail.** A
regularisation is a *claim* — the employee asks, somebody approves, and the
approval writes an `AttendanceEditLog` row saying what changed and who changed
it. The point is not that the past is frozen; it is that the past can only be
changed by a process that records itself.

The tests are grouped as: the lock, the ways around it that must not work, and
the sanctioned channel that must.
"""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from attendance.models import AttendanceLog

pytestmark = [pytest.mark.django_db]

LOGS = "/api/v1/attendance/logs"


@pytest.fixture
def employee(company, employee_user):
    from employees.models import Employee

    return Employee.objects.create(
        user=employee_user, employee_code="ATT-1", date_joined=date(2024, 1, 1)
    )


@pytest.fixture
def today_log(company, employee):
    return AttendanceLog.objects.create(
        employee=employee, date=timezone.localdate(), status=AttendanceLog.Status.PRESENT
    )


@pytest.fixture
def yesterday_log(company, employee):
    return AttendanceLog.objects.create(
        employee=employee,
        date=timezone.localdate() - timedelta(days=1),
        status=AttendanceLog.Status.PRESENT,
    )


# ── The lock ──────────────────────────────────────────────────────────────


def test_hr_can_correct_todays_record(hr_client, company, today_log):
    """The lock has to leave today open, or the correction dialog is dead."""
    response = hr_client.patch(
        f"{LOGS}/{today_log.pk}/", {"status": AttendanceLog.Status.LATE}, format="json"
    )

    assert response.status_code == 200, response.data


def test_hr_cannot_edit_yesterday(hr_client, company, yesterday_log):
    """🔒 The rule itself. HR holds `attendance.manage` and is still refused."""
    response = hr_client.patch(
        f"{LOGS}/{yesterday_log.pk}/", {"status": AttendanceLog.Status.ABSENT}, format="json"
    )

    assert response.status_code == 403
    yesterday_log.refresh_from_db()
    assert yesterday_log.status == AttendanceLog.Status.PRESENT


def test_an_owner_cannot_edit_yesterday_either(admin_client, company, yesterday_log):
    """"Nobody" includes the account that can do everything else.

    The check runs *before* the role logic for exactly this reason: a rule that
    protects payroll from everyone except whoever has the most authority
    protects payroll from nobody who matters.
    """
    response = admin_client.patch(
        f"{LOGS}/{yesterday_log.pk}/", {"status": AttendanceLog.Status.ABSENT}, format="json"
    )

    assert response.status_code == 403


def test_an_employee_cannot_edit_their_own_past_record(employee_client, company, yesterday_log):
    """The one whose pay it is has the clearest motive and the same answer."""
    response = employee_client.patch(
        f"{LOGS}/{yesterday_log.pk}/",
        {"check_in_time": timezone.now().isoformat()},
        format="json",
    )

    assert response.status_code == 403


def test_reading_the_past_is_still_allowed(hr_client, company, yesterday_log):
    """Locked against writes, not against eyes — the whole month has to remain
    readable or the attendance page has nothing to show."""
    assert hr_client.get(f"{LOGS}/{yesterday_log.pk}/").status_code == 200


# ── The ways around it ────────────────────────────────────────────────────


def test_a_punch_cannot_be_aimed_at_a_past_day(employee_client, company, employee):
    """The check-in endpoint is `detail=False`, so the object permission never
    runs on it — the lock has to come from somewhere else, and it does: the date
    is taken from the clock and there is no parameter to override it.

    Posting one anyway must not produce a record for that date.
    """
    past = (timezone.localdate() - timedelta(days=3)).isoformat()

    employee_client.post(f"{LOGS}/check-in/", {"date": past}, format="json")

    assert not AttendanceLog.objects.filter(employee=employee, date=past).exists()


def test_put_is_refused_on_a_past_record_too(hr_client, company, yesterday_log):
    """PATCH is the route the UI uses; PUT is the one somebody reaches for with
    curl. `SAFE_METHODS` covers both, and this says so out loud."""
    response = hr_client.put(
        f"{LOGS}/{yesterday_log.pk}/",
        {"employee": yesterday_log.employee_id, "date": str(yesterday_log.date), "status": "absent"},
        format="json",
    )

    assert response.status_code == 403


def test_there_is_no_delete_route(hr_client, company, yesterday_log):
    """Deleting a day is editing it to nothing. The viewset omits
    `DestroyModelMixin` rather than overriding it, so DRF answers 405 by itself
    — the method is not advertised at all."""
    assert hr_client.delete(f"{LOGS}/{yesterday_log.pk}/").status_code == 405


# ── The sanctioned channel ────────────────────────────────────────────────


def test_a_past_day_is_corrected_through_regularisation(company, employee, yesterday_log, hr_user):
    """The past is not frozen — it is only changeable by a process that records
    itself. Approving a regularisation edits the record *and* writes what
    changed, which a direct PATCH would not have done."""
    from attendance.models import AttendanceEditLog, RegularisationRequest
    from attendance.regularisation import approve_regularisation

    requested = timezone.now().replace(hour=9, minute=0, second=0, microsecond=0)
    request_obj = RegularisationRequest.objects.create(
        employee=employee,
        date=yesterday_log.date,
        requested_check_in=requested,
        reason="Forgot to clock in",
    )

    approve_regularisation(request_obj, actor=hr_user, note="Confirmed with the manager")

    yesterday_log.refresh_from_db()
    assert yesterday_log.check_in_time == requested

    trail = AttendanceEditLog.objects.filter(attendance_log=yesterday_log)
    assert trail.exists(), "the past changed and nothing recorded that it had"
