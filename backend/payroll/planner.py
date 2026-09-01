"""What an employee's tax will come to, and what saving more would do to it.

**Why this can exist now and could not before.** A planner needs three things
the engine did not have until this week: tax computed over a *year* rather than
a month, retirement contributions that actually reduce taxable income, and a
relief rule that knows it is the least of three. With per-period tax and no
relief, "how much would contributing more save me?" had the answer "nothing",
which is both wrong and useless.

**It projects; it does not promise.** Every figure here is *this month,
repeated* — a raise, a bonus or three months of unpaid leave all make it wrong,
and the response says which month it was built from so somebody can judge that
for themselves. A planner that presents a projection as a settlement is worse
than no planner, because people make decisions on it.

**The optimum is the point where relief stops.** Contributions are deductible
only up to the least of the actual amount, a share of income, and a ceiling —
so past a certain figure another rupee into CIT saves no tax at all. That
number is the single most useful thing this produces, and it is why the whole
thing is worth building rather than printing a tax figure.
"""

from __future__ import annotations

from decimal import Decimal

from payroll.tax import PERIODS_PER_YEAR, period_income_tax, retirement_relief


def _latest_basis(employee):
    """The most recent computed month, as the basis for projecting the year.

    Read from a payslip rather than re-derived from the salary structure. The
    structure is an input; the payslip is what the engine made of it — proration,
    absence, allowances and all. Re-deriving it here would be a second
    implementation of `compute_payslip`, free to disagree with the first.

    Drafts are included here, unlike everywhere else: a draft is the best
    available picture of the month in progress, and this is a projection rather
    than a record. The response says which month it used.
    """
    from payroll.models import Payslip, SalaryComponent

    payslip = (
        Payslip.objects.filter(employee=employee)
        .select_related("payroll_run")
        .order_by("-payroll_run__period_year", "-payroll_run__period_month")
        .first()
    )
    if payslip is None:
        return None

    taxable = Decimal("0")
    codes = set(
        SalaryComponent.objects.filter(taxable=True).values_list("code", flat=True)
    )
    for item in payslip.line_items.all():
        if item.component_type == SalaryComponent.ComponentType.EARNING and (
            item.component_code in codes
        ):
            taxable += item.amount

    return {"payslip": payslip, "taxable": taxable}


def projection(employee, fiscal_year, extra_monthly_cit=Decimal("0")):
    """This year's tax, and what another `extra_monthly_cit` a month would do.

    Returns the projection with and without the extra contribution, plus the
    point past which more saves nothing.
    """
    from organization.models import CompanyProfile
    from payroll.schemes import company_schemes, contributions_for

    basis = _latest_basis(employee)
    if basis is None:
        # Nothing computed yet, so there is nothing honest to project from.
        # Said plainly rather than projected from a salary structure that has
        # never been run — a confident figure from an untested structure is the
        # thing this module is trying not to produce.
        return {"available": False, "reason": "no_payslip"}

    profile = CompanyProfile.get_solo()
    config = company_schemes(profile)
    scheme = config["retirement"]

    rows = contributions_for(employee, _basic_of(basis["payslip"]), fiscal_year, profile=profile)
    monthly_contribution = sum((r["employee_amount"] for r in rows), Decimal("0"))

    taxable = basis["taxable"]
    annual_income = taxable * PERIODS_PER_YEAR

    def at(extra):
        contribution = monthly_contribution + Decimal(extra)
        tax = period_income_tax(
            taxable,
            fiscal_year,
            period_contribution=contribution,
            scheme=scheme,
            taxpayer=employee.tax_election or None,
        )
        annual_contribution = contribution * PERIODS_PER_YEAR
        return {
            "monthly_contribution": contribution,
            "annual_contribution": annual_contribution,
            "relief": retirement_relief(
                annual_contribution, annual_income, fiscal_year, scheme
            ),
            "monthly_tax": tax,
            "annual_tax": tax * PERIODS_PER_YEAR,
        }

    current = at(Decimal("0"))
    proposed = at(extra_monthly_cit)

    return {
        "available": True,
        "fiscal_year": fiscal_year,
        # Named so somebody can judge whether the projection is fair — this
        # month repeated is wrong the moment there is a bonus or a raise.
        "based_on": {
            "period_year": basis["payslip"].payroll_run.period_year,
            "period_month": basis["payslip"].payroll_run.period_month,
            "is_draft": basis["payslip"].status == basis["payslip"].Status.DRAFT,
        },
        "monthly_taxable": taxable,
        "annual_taxable": annual_income,
        "offers_cit": config["offers_cit"],
        "current": current,
        "proposed": proposed,
        "annual_tax_saved": current["annual_tax"] - proposed["annual_tax"],
        "optimum_monthly_cit": _optimum(
            monthly_contribution, annual_income, fiscal_year, scheme
        ),
    }


def _basic_of(payslip):
    """The basic on a computed payslip — the base every contribution is a
    percentage of."""
    for item in payslip.line_items.all():
        if item.component_code == "basic":
            return item.amount
    return Decimal("0")


def _optimum(monthly_contribution, annual_income, fiscal_year, scheme):
    """The most somebody can usefully add per month before relief runs out.

    **The single most useful number here.** Relief is capped, so past a point
    another rupee into CIT reduces take-home pay and saves nothing — and
    nothing in the interface would otherwise tell somebody that. Returns the
    *additional* monthly amount, which is what a person is deciding.

    Zero when the cap is already reached, which is itself the answer.
    """
    ceiling = _relief_cap(annual_income, fiscal_year, scheme)
    if ceiling is None:
        return None
    already = Decimal(monthly_contribution) * PERIODS_PER_YEAR
    headroom = ceiling - already
    if headroom <= 0:
        return Decimal("0")
    return (headroom / PERIODS_PER_YEAR).quantize(Decimal("0.01"))


def _relief_cap(annual_income, fiscal_year, scheme):
    """The binding limit — the lesser of the ceiling and the income share.

    Found by asking `retirement_relief` for the relief on an amount large
    enough that the contribution itself can never be the binding term. That
    keeps the least-of-three rule in **one** place: re-deriving the comparison
    here is how the planner and the payslip would come to disagree, which is
    the failure this codebase has had three times.
    """
    absurd = Decimal(annual_income) * 10 + Decimal("10000000")
    cap = retirement_relief(absurd, annual_income, fiscal_year, scheme)
    return cap if cap > 0 else None
