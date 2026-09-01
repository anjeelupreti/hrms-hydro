"""What may be spent, and the two different ways of saying so.

**A cap and a budget are not the same control, and a system with only one of
them is missing the case people actually complain about.**

* A **cap** is per claim. "Nobody claims more than 25,000 for a single hotel
  stay." It is a rule about one document, checked when that document is
  submitted, and the person breaking it finds out immediately.
* A **budget** is a pool over a period. "Site Operations has 400,000 for travel
  this fiscal year." It is a rule about a running total, and the person who
  breaks it is usually not the person who spent most of it.

They are held on the same row because they are always set together — you decide
what a category is worth and what a single claim of it is worth in the same
conversation — and because two tables would mean two screens and two places for
a rule to be missing from.

**Matching is most-specific-wins.** A budget for `(department=Operations,
category=travel)` beats one for `(category=travel)`, which beats a bare
company-wide one. Anything else means a company-wide backstop silently
overriding the deliberate rule somebody wrote for one team.

**What breaching does is a policy choice, and it is a field.** Some companies
want a hard refusal, some want the claim to go through and be flagged for the
approver. Guessing either way is wrong for half of them.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db.models import Q, Sum

from core.calendars import company_calendar, fiscal_year_for


@dataclass(frozen=True)
class BudgetCheck:
    """The answer to "may this claim be submitted?", with the reasons.

    A dataclass rather than a bare bool because every caller needs the same
    three things — whether to refuse, what to say, and how much room is left —
    and a boolean makes each of them re-derive the last two.
    """

    allowed: bool
    #: True when something was exceeded but the policy is to warn, not refuse.
    warn: bool
    message: str
    budget: object | None = None
    remaining: Decimal | None = None


def period_bounds(budget, on_date):
    """The window this budget's total is measured over.

    Reads the company's own calendar rather than assuming January–December. A
    fiscal-year budget on a Bikram Sambat company runs Shrawan to Ashad, and a
    "this year's travel budget" that quietly meant the Gregorian year would be
    wrong by roughly half a year for every customer this product has.
    """
    from expenses.models import ExpenseBudget

    calendar = company_calendar()
    if budget.period == ExpenseBudget.Period.MONTHLY:
        local = calendar.from_gregorian(on_date)
        return (
            calendar.month_start(local.year, local.month),
            calendar.month_end(local.year, local.month),
        )

    year = fiscal_year_for(on_date)
    try:
        return calendar.fiscal_year_bounds(year)
    except Exception:  # noqa: BLE001 — an edge of the conversion table
        # A budget that cannot resolve its window must not block spending. The
        # cap still applies; only the pool goes unchecked, and that is the safe
        # direction to fail for a control nobody has yet breached.
        return None, None


def spent_against(budget, on_date, *, excluding=None) -> Decimal:
    """How much of this budget's pool is already committed.

    Counts approved and reimbursed claims **and pending ones**. Leaving pending
    out means three people can each be told there is room for their claim and
    the third one to be approved puts the department over — which is exactly
    the situation a budget exists to prevent, arriving one approval later.

    Rejected and cancelled claims are excluded: they were never spending.
    """
    from expenses.models import ExpenseClaim

    start, end = period_bounds(budget, on_date)
    if start is None:
        return Decimal("0")

    qs = ExpenseClaim.objects.filter(
        expense_date__gte=start,
        expense_date__lte=end,
    ).exclude(
        status__in=[ExpenseClaim.Status.REJECTED, ExpenseClaim.Status.CANCELLED]
    )
    if budget.category:
        qs = qs.filter(category=budget.category)
    if budget.department_id:
        qs = qs.filter(employee__department_id=budget.department_id)
    if budget.employee_id:
        qs = qs.filter(employee_id=budget.employee_id)
    if excluding is not None:
        qs = qs.exclude(pk=excluding)

    return qs.aggregate(total=Sum("amount"))["total"] or Decimal("0")


def applicable_budget(employee, category, on_date):
    """The one budget that governs this claim, most specific first.

    Ordered in Python rather than by a database `ORDER BY` on three nullable
    columns, because "most specific" is a count of which dimensions are set and
    SQL expresses that badly enough to be worth avoiding.
    """
    from expenses.models import ExpenseBudget

    candidates = ExpenseBudget.objects.filter(is_active=True).filter(
        Q(category="") | Q(category=category)
    ).filter(
        Q(employee__isnull=True) | Q(employee=employee)
    ).filter(
        Q(department__isnull=True) | Q(department_id=employee.department_id)
    )

    def specificity(budget):
        return (
            1 if budget.employee_id else 0,
            1 if budget.department_id else 0,
            1 if budget.category else 0,
        )

    ranked = sorted(candidates, key=specificity, reverse=True)
    return ranked[0] if ranked else None


def check(employee, *, category, amount, on_date, excluding=None) -> BudgetCheck:
    """May this claim be submitted?

    Returns an answer even when nothing applies — a company that has set no
    budgets must not have expenses refused, and `allowed=True` with an empty
    message is what "no rule here" looks like.
    """
    from expenses.models import ExpenseBudget

    budget = applicable_budget(employee, category, on_date)
    if budget is None:
        return BudgetCheck(allowed=True, warn=False, message="")

    amount = Decimal(amount)

    # The cap first: it is the cheaper check and the more specific complaint.
    if budget.per_claim_cap and amount > budget.per_claim_cap:
        message = (
            f"A single {budget.label()} claim is capped at {budget.per_claim_cap:,.2f}. "
            f"This one is {amount:,.2f}."
        )
        if budget.enforcement == ExpenseBudget.Enforcement.BLOCK:
            return BudgetCheck(False, False, message, budget, None)
        return BudgetCheck(True, True, message, budget, None)

    if not budget.amount:
        return BudgetCheck(allowed=True, warn=False, message="", budget=budget)

    spent = spent_against(budget, on_date, excluding=excluding)
    remaining = budget.amount - spent
    if amount > remaining:
        over = amount - remaining
        message = (
            f"{budget.label()} has {max(remaining, Decimal('0')):,.2f} left of "
            f"{budget.amount:,.2f} this {budget.get_period_display().lower()}. "
            f"This claim is over by {over:,.2f}."
        )
        if budget.enforcement == ExpenseBudget.Enforcement.BLOCK:
            return BudgetCheck(False, False, message, budget, remaining)
        return BudgetCheck(True, True, message, budget, remaining)

    warn_at = budget.warn_at_percent
    if warn_at and budget.amount:
        used_after = (spent + amount) / budget.amount * 100
        if used_after >= warn_at:
            return BudgetCheck(
                True,
                True,
                f"{budget.label()} will be {used_after:.0f}% used after this claim.",
                budget,
                remaining - amount,
            )

    return BudgetCheck(True, False, "", budget, remaining - amount)
