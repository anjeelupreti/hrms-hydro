from django.utils import timezone

from accounts.policy import Perm, can, users_with
from notifications.services import notify
from wfh.models import WFHRequest


def _employee_name(employee):
    return employee.user.get_full_name() or employee.user.get_username()


def can_decide(user, wfh):
    """HR/superuser, or the employee's own manager, may approve/reject."""
    if can(user, Perm.WORKPLACE_MANAGE):
        return True
    manager = wfh.employee.manager
    return manager is not None and manager.user_id == user.id


def request_wfh(employee, actor=None, **fields):
    wfh = WFHRequest.objects.create(
        employee=employee, status=WFHRequest.Status.PENDING, created_by=actor, updated_by=actor, **fields
    )
    # Notify the manager (if any) + all HR admins.
    approvers = set()
    if employee.manager:
        approvers.add(employee.manager.user)
    approvers.update(users_with(Perm.WORKPLACE_MANAGE))
    name = _employee_name(employee)
    for user in approvers:
        notify(
            user,
            "wfh_requested",
            f"{name} requested to work from home {wfh.start_date:%b %d} – {wfh.end_date:%b %d}.",
            email_subject="New WFH request",
        )
    return wfh


def decide(wfh, approve, actor=None):
    wfh.status = WFHRequest.Status.APPROVED if approve else WFHRequest.Status.REJECTED
    wfh.decided_by = actor
    wfh.decided_at = timezone.now()
    wfh.updated_by = actor
    wfh.save(update_fields=["status", "decided_by", "decided_at", "updated_by", "updated_at"])
    verb = "wfh_approved" if approve else "wfh_rejected"
    word = "approved" if approve else "declined"
    notify(
        wfh.employee.user,
        verb,
        f"Your WFH request for {wfh.start_date:%b %d} – {wfh.end_date:%b %d} was {word}.",
        email_subject=f"WFH request {word}",
    )
    return wfh


def cancel(wfh, actor=None):
    wfh.status = WFHRequest.Status.CANCELLED
    wfh.updated_by = actor
    wfh.save(update_fields=["status", "updated_by", "updated_at"])
    return wfh
