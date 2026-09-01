"""Approving an employee's attendance dispute, and applying it.

**The constraint worth naming.** Since B1, payroll reads attendance: absences
and unpaid leave reduce pay. So approving a regularisation for a month whose
payroll has already been **finalised and locked** would change the attendance
that a paid payslip was computed from — leaving the payslip and the attendance
record permanently disagreeing, with no way to tell which one is right.

That is refused here rather than allowed and apologised for later. The correct
handling of "we underpaid them because a punch was missing" is an adjustment in
the *next* run, which is visible, not a silent rewrite of a closed month.
"""

from django.db import transaction
from django.utils import timezone

from attendance.models import AttendanceEditLog, AttendanceLog, RegularisationRequest


class RegularisationError(Exception):
    """A request that cannot be approved as things stand."""


def _payroll_is_locked_for(date_value):
    """Whether a finalised payroll run already covers this date.

    **Asks each locked run which days it covers** rather than matching the
    date's Gregorian year and month against the run's two numbers (D‑06). On a
    Bikram Sambat company those numbers are 2083 and 5, so a Gregorian comparison
    matches nothing and the lock silently stops working — letting a
    regularisation rewrite attendance under a payroll run that has been paid.

    Only locked runs are loaded, and a company has a handful.
    """
    from payroll.models import PayrollRun
    from payroll.periods import period_window

    for run in PayrollRun.objects.filter(locked_at__isnull=False):
        start, end, _ = period_window(run)
        if start <= date_value <= end:
            return True
    return False


@transaction.atomic
def approve_regularisation(request_obj, *, actor=None, note=""):
    """Apply the requested change to the attendance record.

    Creates the `AttendanceLog` when the disputed day has none — a missed punch
    is the commonest case, and it is exactly the one a request that could only
    edit an existing row would be unable to fix.

    Every field changed writes an `AttendanceEditLog` row **attributed to the
    approver**, not the requester: the employee asked, HR decided, and the audit
    trail should say who made the change rather than who wanted it.
    """
    if request_obj.status != RegularisationRequest.Status.PENDING:
        raise RegularisationError(
            f"This request is already {request_obj.get_status_display().lower()}."
        )

    if _payroll_is_locked_for(request_obj.date):
        raise RegularisationError(
            f"Payroll for {request_obj.date.year}-{request_obj.date.month:02d} has been "
            "finalised, so its attendance can no longer be changed — the payslips were "
            "computed from it. Raise an adjustment in the next run instead."
        )

    log, created = AttendanceLog.objects.get_or_create(
        employee=request_obj.employee,
        date=request_obj.date,
        defaults={
            "source": AttendanceLog.Source.MANUAL,
            "status": request_obj.requested_status or AttendanceLog.Status.PRESENT,
        },
    )

    changes = []
    if request_obj.requested_check_in is not None:
        changes.append((AttendanceEditLog.Field.CHECK_IN_TIME, log.check_in_time, request_obj.requested_check_in))
        log.check_in_time = request_obj.requested_check_in
    if request_obj.requested_check_out is not None:
        changes.append((AttendanceEditLog.Field.CHECK_OUT_TIME, log.check_out_time, request_obj.requested_check_out))
        log.check_out_time = request_obj.requested_check_out
    if request_obj.requested_status and request_obj.requested_status != log.status:
        changes.append((AttendanceEditLog.Field.STATUS, log.status, request_obj.requested_status))
        log.status = request_obj.requested_status

    log.source = AttendanceLog.Source.MANUAL
    log.save()

    # A newly created log needs no edit rows for its initial values — it has no
    # "from", and inventing one would read as though something was overwritten.
    if not created:
        AttendanceEditLog.objects.bulk_create([
            AttendanceEditLog(
                attendance_log=log,
                field=field,
                from_value=str(before or ""),
                to_value=str(after or ""),
                # `actor` is the approver, not the requester: the employee
                # asked, HR decided, and the trail should say who made the
                # change. The request itself carries who asked and why.
                actor=actor,
            )
            for field, before, after in changes
        ])

    request_obj.status = RegularisationRequest.Status.APPROVED
    request_obj.reviewed_by = actor
    request_obj.reviewed_at = timezone.now()
    request_obj.review_note = note
    request_obj.updated_by = actor
    request_obj.save(update_fields=[
        "status", "reviewed_by", "reviewed_at", "review_note", "updated_by", "updated_at",
    ])
    return log


@transaction.atomic
def reject_regularisation(request_obj, *, actor=None, note=""):
    """Decline the dispute, leaving attendance untouched.

    The note is the point: a rejection with no reason gives the employee nothing
    to correct or appeal, and the request becomes a dead end rather than an
    answer.
    """
    if request_obj.status != RegularisationRequest.Status.PENDING:
        raise RegularisationError(
            f"This request is already {request_obj.get_status_display().lower()}."
        )

    request_obj.status = RegularisationRequest.Status.REJECTED
    request_obj.reviewed_by = actor
    request_obj.reviewed_at = timezone.now()
    request_obj.review_note = note
    request_obj.updated_by = actor
    request_obj.save(update_fields=[
        "status", "reviewed_by", "reviewed_at", "review_note", "updated_by", "updated_at",
    ])
    return request_obj
