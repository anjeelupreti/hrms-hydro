"""Leaving, as the mirror of arriving.

An approved resignation stopped the pay and closed the login, and did nothing
else: no checklist, no prompt to collect the laptop, no statement of what was
still owed either way. Hiring instantiated a checklist automatically; leaving
instantiated nothing — the two halves of one lifecycle held to different
standards.

The tests worth having here are about **what must still work when things are
missing** (no template, no assets) and about the boundary this module refuses
to cross: it lists what is outstanding and never computes a settlement.
"""

from datetime import date
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from checklists.models import Checklist, ChecklistTemplate, ChecklistTemplateItem, Kind
from employees.models import Employee, LifecycleApprovalAction, LifecycleEvent
from employees.offboarding import outstanding_items, start_offboarding
from employees.services import decide, submit_lifecycle_event

pytestmark = pytest.mark.django_db


def _client(company, user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def leaver(company, employee_user):
    yield Employee.objects.create(
        user=employee_user, employee_code="EMP-3001", date_joined=date(2024, 1, 1)
    )


@pytest.fixture
def offboarding_template(company):
    template = ChecklistTemplate.objects.create(
        name="Standard exit", kind=Kind.OFFBOARDING, is_active=True
    )
    for order, title in enumerate(
        ["Return laptop", "Revoke building access", "Exit interview"], start=1
    ):
        ChecklistTemplateItem.objects.create(template=template, title=title, order=order)
    yield template


def _resign(employee, actor):
    event = submit_lifecycle_event(
        employee,
        LifecycleEvent.EventType.RESIGNATION,
        actor,
        effective_date=date.today(),
    )
    decide(event, actor, LifecycleApprovalAction.Decision.APPROVED)
    return event


# ── The mirror ───────────────────────────────────────────────────────────


def test_resigning_starts_the_offboarding_checklist(company, leaver, hr_user, offboarding_template):
    """Hiring does this automatically. Leaving now does too — that symmetry is
    the whole point of the change."""
    _resign(leaver, hr_user)

    checklist = Checklist.objects.filter(employee=leaver, kind=Kind.OFFBOARDING).first()
    assert checklist is not None
    assert checklist.tasks.count() == 3


def test_termination_starts_it_too(company, leaver, hr_user, offboarding_template):
    """Both ways of leaving need the laptop back."""
    event = submit_lifecycle_event(
        leaver,
        LifecycleEvent.EventType.TERMINATION,
        hr_user,
        effective_date=date.today(),
    )
    decide(event, hr_user, LifecycleApprovalAction.Decision.APPROVED)

    assert Checklist.objects.filter(employee=leaver, kind=Kind.OFFBOARDING).exists()


def test_a_promotion_does_not_start_one(company, leaver, hr_user, offboarding_template):
    """A guard that fires on every lifecycle event is not a guard."""
    event = submit_lifecycle_event(
        leaver,
        LifecycleEvent.EventType.PROMOTION,
        hr_user,
        effective_date=date.today(),
    )
    decide(event, hr_user, LifecycleApprovalAction.Decision.APPROVED)

    assert not Checklist.objects.filter(employee=leaver, kind=Kind.OFFBOARDING).exists()


def test_a_missing_template_does_not_block_the_resignation(company, leaver, hr_user):
    """🔒 A company that never configured offboarding must still be able to accept
    somebody's resignation. Failing the lifecycle event over a missing checklist
    is the tail wagging the dog — the same silence hiring already has."""
    _resign(leaver, hr_user)

    leaver.user.refresh_from_db()
    assert leaver.user.is_active is False  # the resignation still applied
    assert not Checklist.objects.filter(employee=leaver, kind=Kind.OFFBOARDING).exists()


def test_starting_offboarding_twice_makes_one_checklist(company, leaver, hr_user, offboarding_template):
    """Lifecycle events can be re-applied, and two exit checklists is two
    people chasing the same laptop."""
    start_offboarding(leaver, actor=hr_user)
    start_offboarding(leaver, actor=hr_user)

    assert Checklist.objects.filter(employee=leaver, kind=Kind.OFFBOARDING).count() == 1


# ── What is still open ───────────────────────────────────────────────────


def test_an_employee_with_nothing_outstanding_is_clear(company, leaver):
    summary = outstanding_items(leaver)

    assert summary["is_clear"] is True
    assert summary["assets_out"] == []


def test_an_unreturned_asset_shows_up(company, leaver):
    """The single most-forgotten thing about an exit."""
    from assets.models import Asset

    Asset.objects.create(
        name="MacBook Pro",
        asset_tag="LAP-001",
        status=Asset.Status.ASSIGNED,
        assigned_to=leaver,
    )
    summary = outstanding_items(leaver)

    assert summary["is_clear"] is False
    assert summary["assets_out"][0]["asset_tag"] == "LAP-001"


def test_an_active_loan_shows_up_with_its_balance(company, leaver):
    """Money they owe the company, which is the half an exit interview forgets
    until the last payslip is already out."""
    from payroll.models import Loan

    Loan.objects.create(
        employee=leaver,
        loan_type=Loan.LoanType.PERSONAL,
        principal_amount=Decimal("100000"),
        monthly_deduction=Decimal("5000"),
        outstanding_balance=Decimal("35000"),
        status=Loan.Status.ACTIVE,
    )
    summary = outstanding_items(leaver)

    assert summary["is_clear"] is False
    assert summary["loan_total"] == Decimal("35000")


def test_an_approved_but_unpaid_expense_shows_up(company, leaver):
    """Money the *company* owes *them* — the direction people forget entirely."""
    from expenses.models import ExpenseClaim

    ExpenseClaim.objects.create(
        employee=leaver,
        title="Client taxi",
        amount=Decimal("2500"),
        status=ExpenseClaim.Status.APPROVED,
        expense_date=date.today(),
    )
    summary = outstanding_items(leaver)

    assert summary["is_clear"] is False
    assert summary["expense_total"] == Decimal("2500")


def test_a_reimbursed_expense_does_not(company, leaver):
    """Already settled is not outstanding, and a statement that lists paid
    claims teaches people to ignore it."""
    from expenses.models import ExpenseClaim

    ExpenseClaim.objects.create(
        employee=leaver,
        title="Already paid",
        amount=Decimal("500"),
        status=ExpenseClaim.Status.REIMBURSED,
        expense_date=date.today(),
    )
    summary = outstanding_items(leaver)

    assert summary["is_clear"] is True


def test_the_summary_is_not_a_settlement(company, leaver):
    """🔒 The boundary this module refuses to cross.

    Payroll owns money. A second place that adds up somebody's last payment is
    a second answer to a question that must have exactly one — so this reports
    what is open and never a net figure.
    """
    summary = outstanding_items(leaver)

    assert "net_payable" not in summary
    assert "final_settlement" not in summary


# ── Who may see it ───────────────────────────────────────────────────────


def test_hr_can_read_the_exit_summary(company, leaver, hr_user):
    response = _client(company, hr_user).get(
        f"/api/v1/employees/employees/{leaver.pk}/offboarding-summary/"
    )

    assert response.status_code == 200
    assert "is_clear" in response.data


def test_somebody_can_read_their_own(company, leaver, employee_user):
    """Knowing what you still owe on the way out is the leaver's business too."""
    response = _client(company, employee_user).get(
        f"/api/v1/employees/employees/{leaver.pk}/offboarding-summary/"
    )

    assert response.status_code == 200


def test_a_colleague_cannot(company, leaver):
    """🔒 Somebody else's outstanding loan is not company gossip."""
    from accounts.models import User

    nosy = User.objects.create_user(
        username="nosy2", email="nosy2@acme.com", password="x", role=User.Role.EMPLOYEE
    )
    Employee.objects.create(user=nosy, employee_code="EMP-3002", date_joined=date(2026, 1, 1))

    response = _client(company, nosy).get(
        f"/api/v1/employees/employees/{leaver.pk}/offboarding-summary/"
    )

    assert response.status_code == 403
