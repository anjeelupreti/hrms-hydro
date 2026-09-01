"""Budgets and caps: two controls, and the difference between them.

A **cap** is per claim — one document, checked at submission. A **budget** is a
pool over a period — a running total, usually breached by somebody who is not
the person who spent most of it. A system with only one is missing the case
people actually complain about, so both are pinned here, along with the
most-specific-wins rule that decides which row governs a given claim.
"""

from datetime import date
from decimal import Decimal

import pytest

from employees.models import Department, Employee
from expenses.budgets import check
from expenses.models import ExpenseBudget, ExpenseClaim

pytestmark = pytest.mark.django_db

CLAIMS = "/api/v1/expenses/claims/"
BUDGETS = "/api/v1/expenses/budgets/"


@pytest.fixture
def ops(db):
    return Department.objects.create(name="Site Operations", code="OPS")


@pytest.fixture
def claimant(db, employee_user, company, ops):
    return Employee.objects.create(
        user=employee_user, employee_code="EMP-B1",
        date_joined=date(2024, 1, 1), primary_company=company, department=ops,
    )


# ── No rule means no refusal ─────────────────────────────────────────────


def test_a_company_with_no_budgets_refuses_nothing(claimant):
    verdict = check(
        claimant, category="travel", amount=Decimal("999999"), on_date=date.today()
    )

    assert verdict.allowed is True
    assert verdict.warn is False
    assert verdict.message == ""


# ── The cap ──────────────────────────────────────────────────────────────


def test_a_claim_over_the_per_claim_cap_is_refused(claimant):
    ExpenseBudget.objects.create(
        name="Travel", category="travel", per_claim_cap=Decimal("25000"),
        enforcement=ExpenseBudget.Enforcement.BLOCK,
    )

    verdict = check(claimant, category="travel", amount=Decimal("30000"), on_date=date.today())

    assert verdict.allowed is False
    assert "capped at 25,000.00" in verdict.message


def test_a_cap_with_no_pool_still_works(claimant):
    """`amount=0` means there is no pool — the row exists to carry a cap, which
    is a real and common way to use this."""
    ExpenseBudget.objects.create(
        name="Meals", category="meals", amount=Decimal("0"),
        per_claim_cap=Decimal("2000"), enforcement=ExpenseBudget.Enforcement.BLOCK,
    )

    under = check(claimant, category="meals", amount=Decimal("1500"), on_date=date.today())
    over = check(claimant, category="meals", amount=Decimal("2500"), on_date=date.today())

    assert under.allowed is True
    assert over.allowed is False


# ── The pool ─────────────────────────────────────────────────────────────


def test_the_pool_counts_pending_claims_too(claimant):
    """Leaving pending out means three people are each told there is room and
    the third approval puts the department over — which is the situation a
    budget exists to prevent, arriving one approval later."""
    ExpenseBudget.objects.create(
        name="Travel", category="travel", amount=Decimal("10000"),
        enforcement=ExpenseBudget.Enforcement.BLOCK,
    )
    ExpenseClaim.objects.create(
        employee=claimant, title="Bus to site", category="travel",
        amount=Decimal("8000"), expense_date=date.today(),
        status=ExpenseClaim.Status.PENDING,
    )

    verdict = check(claimant, category="travel", amount=Decimal("3000"), on_date=date.today())

    assert verdict.allowed is False
    assert "over by 1,000.00" in verdict.message


def test_a_rejected_claim_frees_its_room(claimant):
    ExpenseBudget.objects.create(
        name="Travel", category="travel", amount=Decimal("10000"),
        enforcement=ExpenseBudget.Enforcement.BLOCK,
    )
    ExpenseClaim.objects.create(
        employee=claimant, title="Refused", category="travel",
        amount=Decimal("9000"), expense_date=date.today(),
        status=ExpenseClaim.Status.REJECTED,
    )

    verdict = check(claimant, category="travel", amount=Decimal("5000"), on_date=date.today())

    assert verdict.allowed is True


def test_warn_lets_it_through_and_says_so(claimant):
    """Some companies want an over-budget claim to be a conversation, not an
    error. Guessing either way is wrong for half of them."""
    ExpenseBudget.objects.create(
        name="Travel", category="travel", amount=Decimal("1000"),
        enforcement=ExpenseBudget.Enforcement.WARN,
    )

    verdict = check(claimant, category="travel", amount=Decimal("5000"), on_date=date.today())

    assert verdict.allowed is True
    assert verdict.warn is True
    assert "over by" in verdict.message


def test_the_warning_threshold_fires_before_the_pool_runs_out(claimant):
    ExpenseBudget.objects.create(
        name="Travel", category="travel", amount=Decimal("10000"), warn_at_percent=80
    )

    verdict = check(claimant, category="travel", amount=Decimal("8500"), on_date=date.today())

    assert verdict.allowed is True
    assert verdict.warn is True
    assert "85% used" in verdict.message


# ── Which rule applies ───────────────────────────────────────────────────


def test_the_most_specific_budget_wins(claimant, ops):
    """A company-wide backstop must not silently override the deliberate rule
    somebody wrote for one team."""
    ExpenseBudget.objects.create(
        name="Everything", amount=Decimal("1000000"),
        enforcement=ExpenseBudget.Enforcement.WARN,
    )
    ExpenseBudget.objects.create(
        name="Ops travel", category="travel", department=ops,
        amount=Decimal("5000"), enforcement=ExpenseBudget.Enforcement.BLOCK,
    )

    verdict = check(claimant, category="travel", amount=Decimal("6000"), on_date=date.today())

    assert verdict.allowed is False
    assert verdict.budget.name == "Ops travel"


def test_a_budget_for_another_department_does_not_apply(claimant):
    other = Department.objects.create(name="Finance", code="FIN")
    ExpenseBudget.objects.create(
        name="Finance travel", category="travel", department=other,
        amount=Decimal("1"), enforcement=ExpenseBudget.Enforcement.BLOCK,
    )

    verdict = check(claimant, category="travel", amount=Decimal("50000"), on_date=date.today())

    assert verdict.allowed is True
    assert verdict.budget is None


def test_a_budget_for_all_categories_covers_one_of_them(claimant):
    ExpenseBudget.objects.create(
        name="Everything", amount=Decimal("100"),
        enforcement=ExpenseBudget.Enforcement.BLOCK,
    )

    verdict = check(claimant, category="supplies", amount=Decimal("500"), on_date=date.today())

    assert verdict.allowed is False


# ── Over the wire ────────────────────────────────────────────────────────


def test_submitting_over_a_blocking_budget_leaves_nothing_behind(employee_client, claimant):
    """A budget that only bites at approval time means somebody fills in a
    form, attaches a receipt, waits three days and is then told the money was
    never there."""
    ExpenseBudget.objects.create(
        name="Travel", category="travel", amount=Decimal("1000"),
        enforcement=ExpenseBudget.Enforcement.BLOCK,
    )

    response = employee_client.post(
        CLAIMS,
        {
            "title": "Flight to Kathmandu", "category": "travel",
            "amount": "9000", "expense_date": str(date.today()),
        },
        format="json",
    )

    assert response.status_code == 400
    assert response.data["code"] == "over_budget"
    assert ExpenseClaim.objects.count() == 0


def test_a_warned_claim_goes_through_carrying_its_warning(employee_client, claimant):
    ExpenseBudget.objects.create(
        name="Travel", category="travel", amount=Decimal("1000"),
        enforcement=ExpenseBudget.Enforcement.WARN,
    )

    response = employee_client.post(
        CLAIMS,
        {
            "title": "Flight", "category": "travel",
            "amount": "9000", "expense_date": str(date.today()),
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert "budget_warning" in response.data
    assert ExpenseClaim.objects.count() == 1


def test_the_ceiling_can_be_asked_about_before_the_form_is_filled_in(
    employee_client, claimant
):
    ExpenseBudget.objects.create(
        name="Travel", category="travel", per_claim_cap=Decimal("2000"),
        enforcement=ExpenseBudget.Enforcement.BLOCK,
    )

    response = employee_client.post(
        f"{CLAIMS}check-budget/",
        {"category": "travel", "amount": "5000", "expense_date": str(date.today())},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert response.data["allowed"] is False
    assert "capped" in response.data["message"]


def test_only_somebody_with_expenses_manage_reads_the_budgets(
    employee_client, admin_client
):
    ExpenseBudget.objects.create(name="Travel", category="travel", amount=Decimal("1000"))

    assert employee_client.get(BUDGETS).status_code == 403
    assert admin_client.get(BUDGETS).status_code == 200


def test_a_budget_reports_how_much_is_gone(admin_client, claimant):
    budget = ExpenseBudget.objects.create(
        name="Travel", category="travel", amount=Decimal("10000")
    )
    ExpenseClaim.objects.create(
        employee=claimant, title="Bus", category="travel",
        amount=Decimal("2500"), expense_date=date.today(),
        status=ExpenseClaim.Status.APPROVED,
    )

    response = admin_client.get(f"{BUDGETS}{budget.pk}/")

    assert response.data["spent"] == "2500.00"
    assert response.data["remaining"] == "7500.00"
    assert response.data["used_percent"] == 25.0


def test_two_budgets_cannot_cover_exactly_the_same_ground(admin_client):
    """Which one applies would be a tie broken by primary key, which is not a
    rule anybody wrote down."""
    from django.db.utils import IntegrityError

    ExpenseBudget.objects.create(name="A", category="travel", amount=Decimal("1"))
    with pytest.raises(IntegrityError):
        ExpenseBudget.objects.create(name="B", category="travel", amount=Decimal("2"))
