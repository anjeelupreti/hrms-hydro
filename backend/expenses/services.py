"""Expense-claim lifecycle + notifications. Mirrors the WFH/leave
approval shape: every transition notifies the affected party."""

from django.utils import timezone

from accounts.policy import Perm, users_with
from expenses.models import ExpenseClaim
from notifications.services import notify


def _notify_hr(verb, message, subject):
    for user in users_with(Perm.EXPENSES_MANAGE):
        notify(user, verb, message, email_subject=subject)


def _name(employee):
    return employee.user.get_full_name() or employee.user.get_username()


def submit_claim(claim):
    _notify_hr(
        "expense_submitted",
        f"{_name(claim.employee)} submitted an expense claim: {claim.title} ({claim.amount}).",
        "New expense claim",
    )
    return claim


def approve_claim(claim, actor=None, note=""):
    claim.status = ExpenseClaim.Status.APPROVED
    claim.decided_by = actor
    claim.decided_at = timezone.now()
    claim.decision_note = note
    claim.updated_by = actor
    claim.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_by", "updated_at"])
    notify(
        claim.employee.user,
        "expense_approved",
        f"Your expense claim \"{claim.title}\" was approved.",
        email_subject="Expense claim approved",
    )
    return claim


def reject_claim(claim, actor=None, note=""):
    claim.status = ExpenseClaim.Status.REJECTED
    claim.decided_by = actor
    claim.decided_at = timezone.now()
    claim.decision_note = note
    claim.updated_by = actor
    claim.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_by", "updated_at"])
    notify(
        claim.employee.user,
        "expense_rejected",
        f"Your expense claim \"{claim.title}\" was rejected."
        + (f" Note: {note}" if note else ""),
        email_subject="Expense claim rejected",
    )
    return claim


def reimburse_claim(claim, actor=None, reference=""):
    """Marks an approved claim reimbursed — a manual record that payment
    happened outside the system (same principle as payroll disbursement)."""
    claim.status = ExpenseClaim.Status.REIMBURSED
    claim.reimbursed_at = timezone.now()
    claim.reimbursement_reference = reference
    claim.updated_by = actor
    claim.save(update_fields=["status", "reimbursed_at", "reimbursement_reference", "updated_by", "updated_at"])
    notify(
        claim.employee.user,
        "expense_reimbursed",
        f"Your expense claim \"{claim.title}\" ({claim.amount}) has been marked reimbursed.",
        email_subject="Expense reimbursed",
    )
    return claim


def cancel_claim(claim, actor=None):
    claim.status = ExpenseClaim.Status.CANCELLED
    claim.updated_by = actor
    claim.save(update_fields=["status", "updated_by", "updated_at"])
    return claim
