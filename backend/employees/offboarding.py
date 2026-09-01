"""Leaving, built as the deliberate mirror of arriving.

**What existed.** An approved resignation or termination stopped the pay and
(since 17 Aug) closed the login. Nothing else happened: no checklist, no
prompt to collect the laptop, no statement of what the company still owes them
or they still owe it. Hiring instantiated an onboarding checklist automatically
and leaving instantiated nothing, so the two halves of the same lifecycle were
built to different standards.

**What this deliberately does not do.** It does not compute a final settlement.
Payroll owns money, and a second place that adds up somebody's last payment is
a second answer to a question that must only have one. What it does instead is
**list what is outstanding** — assets still out, loans still owing, expenses
still unpaid, leave not taken — so the person running the exit can see the
whole picture and act in the modules that own each part.

That distinction is the whole design: this is a *checklist and a statement*,
not a calculator.
"""

import logging
from decimal import Decimal

logger = logging.getLogger(__name__)


def start_offboarding(employee, *, event=None, actor=None):
    """Instantiate the company's offboarding template for somebody leaving.

    Mirrors `recruitment.hiring._start_onboarding`, including its silence: a
    company that has not configured offboarding should still be able to accept a
    resignation, and failing the whole lifecycle event over a missing template
    would be the tail wagging the dog.

    Idempotent — an event applied twice must not produce two checklists, and
    lifecycle events can be re-applied.
    """
    from checklists.models import Checklist, ChecklistTask, ChecklistTemplate, Kind

    existing = Checklist.objects.filter(employee=employee, kind=Kind.OFFBOARDING).first()
    if existing is not None:
        return existing

    template = (
        ChecklistTemplate.objects.filter(kind=Kind.OFFBOARDING, is_active=True)
        .prefetch_related("items")
        .first()
    )
    if template is None:
        logger.info(
            "No active offboarding template — %s is leaving without one.", employee.employee_code
        )
        return None

    checklist = Checklist.objects.create(
        employee=employee,
        kind=Kind.OFFBOARDING,
        template=template,
        title=f"Offboarding — {employee.user.get_full_name() or employee.user.get_username()}",
        created_by=actor,
        updated_by=actor,
    )
    ChecklistTask.objects.bulk_create([
        ChecklistTask(
            checklist=checklist,
            title=item.title,
            description=item.description,
            order=item.order,
        )
        for item in template.items.all()
    ])
    return checklist


def outstanding_items(employee):
    """What is still open between this person and the company.

    Read-only, and assembled from the modules that own each fact rather than
    copied into a leavers' table. A snapshot taken at resignation goes stale the
    moment somebody returns a laptop, and a stale exit statement is worse than
    none — it gets acted on.
    """
    from assets.models import Asset
    from core.calendars import fiscal_year_for
    from expenses.models import ExpenseClaim
    from leave.models import LeaveBalance
    from payroll.models import Loan

    assets = list(
        Asset.objects.filter(assigned_to=employee, status=Asset.Status.ASSIGNED)
        .values("id", "name", "asset_tag")
    )

    loans = list(
        Loan.objects.filter(employee=employee, status=Loan.Status.ACTIVE)
        .values("id", "loan_type", "outstanding_balance")
    )

    # Approved but not yet reimbursed — money the company owes them, which is
    # the half of an exit people forget until somebody chases it.
    unpaid_expenses = list(
        ExpenseClaim.objects.filter(
            employee=employee, status=ExpenseClaim.Status.APPROVED
        ).values("id", "title", "amount")
    )

    from datetime import date

    balances = [
        {
            "leave_type": b.leave_type.name,
            "remaining": b.remaining_days,
        }
        for b in LeaveBalance.objects.filter(
            employee=employee, year=fiscal_year_for(date.today())
        ).select_related("leave_type")
        if b.remaining_days > 0
    ]

    return {
        "assets_out": assets,
        "loans_outstanding": loans,
        "loan_total": sum((Decimal(str(loan["outstanding_balance"])) for loan in loans), Decimal("0")),
        "unpaid_expenses": unpaid_expenses,
        "expense_total": sum((Decimal(str(e["amount"])) for e in unpaid_expenses), Decimal("0")),
        "leave_remaining": balances,
        # One number the exit interview can be run from: is anything still open?
        "is_clear": not assets and not loans and not unpaid_expenses,
    }
