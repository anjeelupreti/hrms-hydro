"""Enrollment lifecycle + notifications for the training module.

Two entry paths (Phase 12 decision): employees *request* a seat and HR
approves/declines; HR can also *assign* directly. All transitions notify
the affected party through the shared notifications.notify().
"""

import logging

from django.utils import timezone

from accounts.policy import Perm, users_with
from notifications.services import notify
from training.models import Enrollment, TrainingSession

logger = logging.getLogger(__name__)


def _notify_hr(verb, message, subject):
    for user in users_with(Perm.WORKPLACE_MANAGE):
        notify(user, verb, message, email_subject=subject)


def _employee_name(employee):
    return employee.user.get_full_name() or employee.user.get_username()


def _ensure_open(session):
    if session.status == TrainingSession.Status.CANCELLED:
        raise ValueError("This session has been cancelled.")
    if session.is_full:
        raise ValueError("This session is full.")


def request_enrollment(session, employee, actor=None):
    """Employee asks for a seat — pending HR approval."""
    if session.status == TrainingSession.Status.CANCELLED:
        raise ValueError("This session has been cancelled.")
    enrollment, created = Enrollment.objects.get_or_create(
        session=session,
        employee=employee,
        defaults={"status": Enrollment.Status.REQUESTED, "created_by": actor, "updated_by": actor},
    )
    if not created and enrollment.status in (
        Enrollment.Status.CANCELLED,
        Enrollment.Status.DECLINED,
    ):
        # Re-requesting after a prior no — reset to a fresh request.
        enrollment.status = Enrollment.Status.REQUESTED
        enrollment.decided_at = None
        enrollment.updated_by = actor
        enrollment.save(update_fields=["status", "decided_at", "updated_by", "updated_at"])
    _notify_hr(
        "training_requested",
        f"{_employee_name(employee)} requested to join {session.program.title}.",
        "New training request",
    )
    return enrollment


def assign_enrollment(session, employee, actor=None):
    """HR puts an employee straight into a session."""
    _ensure_open(session)
    enrollment, _ = Enrollment.objects.update_or_create(
        session=session,
        employee=employee,
        defaults={
            "status": Enrollment.Status.ENROLLED,
            "decided_at": timezone.now(),
            "updated_by": actor,
        },
    )
    notify(
        employee.user,
        "training_enrolled",
        f"You've been enrolled in {session.program.title} on {session.start_datetime:%b %d, %Y}.",
        email_subject="You've been enrolled in a training",
    )
    return enrollment


def approve_request(enrollment, actor=None):
    _ensure_open(enrollment.session)
    enrollment.status = Enrollment.Status.ENROLLED
    enrollment.decided_at = timezone.now()
    enrollment.updated_by = actor
    enrollment.save(update_fields=["status", "decided_at", "updated_by", "updated_at"])
    notify(
        enrollment.employee.user,
        "training_enrolled",
        f"Your request to join {enrollment.session.program.title} was approved.",
        email_subject="Training request approved",
    )
    return enrollment


def decline_request(enrollment, actor=None):
    enrollment.status = Enrollment.Status.DECLINED
    enrollment.decided_at = timezone.now()
    enrollment.updated_by = actor
    enrollment.save(update_fields=["status", "decided_at", "updated_by", "updated_at"])
    notify(
        enrollment.employee.user,
        "training_declined",
        f"Your request to join {enrollment.session.program.title} was declined.",
        email_subject="Training request declined",
    )
    return enrollment


def cancel_enrollment(enrollment, actor=None):
    """Take someone off a roster.

    Refused once a certificate has been issued. That certificate is already in
    the participant's hands — it may be on a CV or with a regulator — and the
    verification page renders straight from this enrollment, so cancelling
    would leave a live certificate pointing at a cancelled record.

    The guard lives here rather than in the view because hiding the button
    would still leave the endpoint open, and both the roster UI and any future
    bulk action have to obey the same rule. Revoking a certificate is a
    separate, deliberate decision — it is not a side effect of tidying a list.
    """
    if enrollment.certificate_issued_at:
        raise ValueError(
            "This participant holds an issued certificate. Revoke the "
            "certificate first if it was issued in error."
        )
    enrollment.status = Enrollment.Status.CANCELLED
    enrollment.updated_by = actor
    enrollment.save(update_fields=["status", "updated_by", "updated_at"])
    return enrollment


def complete_enrollment(enrollment, status, score=None, feedback="", actor=None):
    """HR marks the outcome — COMPLETED (with optional score/feedback) or
    NO_SHOW."""
    if status not in (Enrollment.Status.COMPLETED, Enrollment.Status.NO_SHOW):
        raise ValueError("Completion status must be 'completed' or 'no_show'.")
    enrollment.status = status
    enrollment.score = score if status == Enrollment.Status.COMPLETED else None
    enrollment.feedback = feedback
    enrollment.completed_at = timezone.now()
    enrollment.updated_by = actor
    enrollment.save(
        update_fields=["status", "score", "feedback", "completed_at", "updated_by", "updated_at"]
    )
    if status == Enrollment.Status.COMPLETED:
        notify(
            enrollment.employee.user,
            "training_completed",
            f"You've completed {enrollment.session.program.title}."
            + (f" Score: {score}." if score is not None else ""),
            email_subject="Training completed",
        )
    return enrollment


def issue_certificate(enrollment, actor=None):
    """Certifies one participant: marks them COMPLETED if they aren't yet,
    stamps certificate_issued_at, renders the certificate PDF (best-effort
    — WeasyPrint may be absent, see certificates.py) and notifies them.

    Only enrolled/completed participants qualify — a no-show or declined
    request can't be certified."""
    if enrollment.status not in (Enrollment.Status.ENROLLED, Enrollment.Status.COMPLETED):
        raise ValueError("Only enrolled or completed participants can be certified.")
    now = timezone.now()
    if enrollment.status == Enrollment.Status.ENROLLED:
        enrollment.status = Enrollment.Status.COMPLETED
        enrollment.completed_at = enrollment.completed_at or now
    enrollment.certificate_issued_at = now
    enrollment.updated_by = actor
    enrollment.save(
        update_fields=["status", "completed_at", "certificate_issued_at", "updated_by", "updated_at"]
    )

    # Render the PDF (best-effort — WeasyPrint may be absent) and, if it
    # produced a file, attach it to the notification email.
    attachments = None
    try:
        from documents.models import Document
        from documents.services import latest_document_for
        from training.certificates import generate_certificate_pdf

        document = generate_certificate_pdf(enrollment, actor=actor) or latest_document_for(
            enrollment, kind=Document.Kind.CERTIFICATE
        )
        if document is not None:
            with document.file.open("rb") as fh:
                attachments = [(document.original_filename, fh.read(), "application/pdf")]
    except Exception:
        logger.exception(
            "Certificate PDF generation/attachment failed for enrollment %s — record is stamped; "
            "the certificate is still viewable/printable from the Training page.",
            enrollment.id,
        )

    ready = "attached" if attachments else "ready — download it from your Training page"
    notify(
        enrollment.employee.user,
        "training_certificate",
        f"Your certificate for \"{enrollment.session.program.title}\" is {ready}.",
        email_subject="Your training certificate",
        attachments=attachments,
    )
    return enrollment


def issue_session_certificates(session, enrollment_ids, actor=None):
    """Bulk-certify the selected participants of a session, then mark the
    session COMPLETED. Skips anyone who can't be certified (no-show, etc.)
    rather than failing the whole batch."""
    issued = []
    for enrollment in session.enrollments.filter(id__in=enrollment_ids):
        try:
            issue_certificate(enrollment, actor=actor)
            issued.append(enrollment.id)
        except ValueError:
            continue
    if session.status != TrainingSession.Status.COMPLETED:
        session.status = TrainingSession.Status.COMPLETED
        session.updated_by = actor
        session.save(update_fields=["status", "updated_by", "updated_at"])
    return issued
