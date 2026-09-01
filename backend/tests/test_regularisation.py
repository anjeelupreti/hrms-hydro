"""Attendance regularisation — an employee disputing their own record.

Before this, the only route was `AttendanceEditLog`: HR editing the record
directly. So an employee whose badge failed had to ask somebody to change their
attendance for them, with the conversation happening outside the system and only
the result recorded. The dispute, the reason and the decision are the parts
worth keeping.

**The constraint these tests exist for.** Since B1, payroll reads attendance.
Approving a change to a month whose payroll is finalised would rewrite the
attendance a paid payslip was computed from, leaving the two permanently
disagreeing with no way to tell which is right.
"""

from datetime import date

import pytest
from django.utils import timezone

from attendance.models import AttendanceLog, RegularisationRequest
from attendance.regularisation import (
    RegularisationError,
    approve_regularisation,
    reject_regularisation,
)

pytestmark = pytest.mark.django_db

DISPUTED = date(2026, 8, 6)


@pytest.fixture
def request_obj(company, payroll_setup):
    yield RegularisationRequest.objects.create(
        employee=payroll_setup["emp"],
        date=DISPUTED,
        requested_check_in=timezone.make_aware(
            timezone.datetime(2026, 8, 6, 9, 5)
        ),
        requested_status=AttendanceLog.Status.PRESENT,
        reason="Badge reader failed at the gate.",
    )


# ── A pending request changes nothing ────────────────────────────────────


def test_a_pending_request_does_not_touch_attendance(company, payroll_setup, request_obj):
    """A claim, not a correction.

    Writing immediately would make attendance self-service editable, which is
    the same thing as not recording attendance.
    """
    exists = AttendanceLog.objects.filter(
        employee=payroll_setup["emp"], date=DISPUTED
    ).exists()

    assert exists is False


# ── Approval applies it ──────────────────────────────────────────────────


def test_approving_creates_the_missing_log(company, payroll_setup, request_obj, hr_user):
    """A missed punch is the commonest dispute, and it is exactly the case a
    request that could only *edit* an existing row would be unable to fix."""
    approve_regularisation(request_obj, actor=hr_user)
    log = AttendanceLog.objects.get(employee=payroll_setup["emp"], date=DISPUTED)
    request_obj.refresh_from_db()

    assert log.status == AttendanceLog.Status.PRESENT
    assert log.check_in_time is not None
    assert log.source == AttendanceLog.Source.MANUAL
    assert request_obj.status == RegularisationRequest.Status.APPROVED


def test_approving_an_existing_log_records_what_changed_and_who(
    company, payroll_setup, request_obj, hr_user
):
    """The audit trail names the **approver**, not the requester: the employee
    asked, HR decided."""
    AttendanceLog.objects.create(
        employee=payroll_setup["emp"], date=DISPUTED,
        status=AttendanceLog.Status.ABSENT,
    )
    approve_regularisation(request_obj, actor=hr_user)
    log = AttendanceLog.objects.get(employee=payroll_setup["emp"], date=DISPUTED)
    edits = list(log.edit_logs.all())
    actor_ids = {e.actor_id for e in edits}

    assert log.status == AttendanceLog.Status.PRESENT
    assert any(e.field == "status" and e.from_value == "absent" for e in edits)
    assert actor_ids == {hr_user.id}


def test_a_request_cannot_be_approved_twice(company, request_obj, hr_user):
    approve_regularisation(request_obj, actor=hr_user)
    with pytest.raises(RegularisationError, match="already"):
        approve_regularisation(request_obj, actor=hr_user)


# ── The payroll constraint ───────────────────────────────────────────────


def test_a_finalised_payroll_month_cannot_be_regularised(
    company, payroll_setup, request_obj, hr_user
):
    """The cross-module rule that matters.

    Payroll reads attendance, so rewriting a locked month would leave the
    payslip and the attendance record permanently disagreeing. An adjustment in
    the next run is visible; a silent rewrite of a closed month is not.
    """
    run = payroll_setup["run"]          # 2026-08, same month as DISPUTED
    run.locked_at = timezone.now()
    run.save(update_fields=["locked_at"])

    with pytest.raises(RegularisationError, match="finalised"):
        approve_regularisation(request_obj, actor=hr_user)

    request_obj.refresh_from_db()
    touched = AttendanceLog.objects.filter(
        employee=payroll_setup["emp"], date=DISPUTED
    ).exists()

    # Refused, and nothing partially applied.
    assert request_obj.status == RegularisationRequest.Status.PENDING
    assert touched is False


def test_an_unlocked_payroll_month_can_still_be_regularised(
    company, payroll_setup, request_obj, hr_user
):
    """A guard that blocks every month is not a guard — a run that has not been
    finalised has not been paid, so correcting it is exactly right."""
    run = payroll_setup["run"]
    assert run.locked_at is None
    approve_regularisation(request_obj, actor=hr_user)
    request_obj.refresh_from_db()

    assert request_obj.status == RegularisationRequest.Status.APPROVED


# ── Rejection ────────────────────────────────────────────────────────────


def test_rejecting_leaves_attendance_untouched(
    company, payroll_setup, request_obj, hr_user
):
    reject_regularisation(request_obj, actor=hr_user, note="Gate logs show no entry.")
    request_obj.refresh_from_db()
    exists = AttendanceLog.objects.filter(
        employee=payroll_setup["emp"], date=DISPUTED
    ).exists()

    assert request_obj.status == RegularisationRequest.Status.REJECTED
    assert request_obj.review_note == "Gate logs show no entry."
    assert exists is False


# ── Through the API ──────────────────────────────────────────────────────


def test_filing_without_an_employee_record_is_refused(company, payroll_setup, hr_client):
    """`hr_user` has no employee record, so there is no attendance to dispute.

    Worth its own test: the alternative is a 500 deep in `perform_create`, and
    an HR admin who is not themselves an employee is a real configuration.
    """
    response = hr_client.post(
        "/api/v1/attendance/regularisations/",
        {"date": str(DISPUTED), "requested_status": "present", "reason": "Badge failed."},
        format="json",
    )

    assert response.status_code == 400


def test_an_employee_files_for_themselves_only(company, payroll_setup, admin_client):
    """Taken from the session rather than the payload, so nobody can file a
    dispute against somebody else's attendance by changing an id."""
    response = admin_client.post(
        "/api/v1/attendance/regularisations/",
        {
            "employee": 999999,          # ignored
            "date": str(DISPUTED),
            "requested_status": "present",
            "reason": "Badge failed.",
        },
        format="json",
    )
    created = RegularisationRequest.objects.get(pk=response.data["id"])

    assert response.status_code == 201
    assert created.employee_id != 999999


def test_a_reason_is_required(company, payroll_setup, admin_client):
    """Asking to change a record without saying why leaves the approver
    guessing, and the reason is what the decision is made on."""
    response = admin_client.post(
        "/api/v1/attendance/regularisations/",
        {"date": str(DISPUTED), "requested_status": "present", "reason": "   "},
        format="json",
    )

    assert response.status_code == 400


def test_a_request_must_ask_for_something(company, payroll_setup, admin_client):
    response = admin_client.post(
        "/api/v1/attendance/regularisations/",
        {"date": str(DISPUTED), "reason": "Something was wrong."},
        format="json",
    )

    assert response.status_code == 400


def test_rejecting_requires_a_note(company, request_obj, hr_client):
    """A rejection with no reason gives the employee nothing to correct or
    appeal, and turns the request into a dead end rather than an answer."""
    response = hr_client.post(
        f"/api/v1/attendance/regularisations/{request_obj.id}/reject/", {}, format="json"
    )

    assert response.status_code == 400


def test_an_employee_cannot_approve_their_own_request(
    company, payroll_setup, request_obj, employee_client
):
    response = employee_client.post(
        f"/api/v1/attendance/regularisations/{request_obj.id}/approve/", {}, format="json"
    )

    assert response.status_code in (403, 404)


def test_an_employee_does_not_see_someone_elses_dispute(
    company, request_obj, employee_client
):
    """Somebody else's attendance argument is not their business."""
    response = employee_client.get("/api/v1/attendance/regularisations/")
    rows = response.data["results"] if isinstance(response.data, dict) else response.data

    assert request_obj.id not in {r["id"] for r in rows}
