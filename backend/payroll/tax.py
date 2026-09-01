"""Income tax for one pay period — annualised, relieved, and per the right table.

**Slab bands are annual figures, so tax is computed annually and divided back
down.** Project the period's taxable pay across the year, apply the published
bands, then take this period's share. Applied to one month's income instead,
somebody on 60,000 a month sits inside the lowest band every month and pays
~1%, where 720,000 a year reaches the 20% band — an under-deduction of roughly
three quarters. And a run that under-taxes looks exactly like a correct one:
the shortfall surfaces at filing, as the company's liability.

Computing it annually is also what lets the stored table match the Finance Act
line for line, which is the only way anybody can verify it.

**Three inputs the arithmetic needs and a naive call omits.** `taxpayer` selects
the couple table; `retirement_contributor` exempts a fund contributor from a
band they do not pay; and the base is `gross_taxable`, so a contribution
actually reduces taxable income. Miss any one and the figure is quietly wrong
in the payer's favour or ours.

**What stays configuration.** Every figure — the bands, the relief ceilings, the
share of income — is a `StatutoryRate` or a `TaxSlab`, effective-dated per
fiscal year, shipping `is_verified=False`. This module owns the *shape* of the
arithmetic and none of the numbers (§2.3).
"""

from __future__ import annotations

from decimal import Decimal

from payroll.statutory import RateCode, get_rate

#: Payroll runs on a calendar month — `PayrollRun` is keyed by period_year and
#: period_month — so a year is twelve periods. Named rather than inlined
#: because it appears on both sides of the annualise/divide pair, and the two
#: silently disagreeing would be a very quiet bug.
PERIODS_PER_YEAR = 12


def retirement_relief(annual_contribution, annual_assessable, fiscal_year, scheme=None):
    """The deductible retirement contribution — **the least of three.**

    1. What was actually contributed;
    2. a share of assessable income;
    3. an absolute ceiling.

    🔒 **One shared allowance across every scheme, not one each.** SSF, PF and
    CIT contributions are added together before this is applied, so somebody
    already paying 11% into SSF may get little or no further relief from CIT.
    Treating them as independent allowances is the over-relief the register
    warned about — and it is the natural mistake, because they are three
    separate deductions on the payslip.

    **The ceiling depends on the scheme.** It is set higher for SSF contributors
    than for PF and CIT, so "the ceiling" was never a single figure and cannot
    be a single row.

    Returns zero when nothing was contributed, which keeps this safe to call
    unconditionally.
    """
    if annual_contribution <= 0:
        return Decimal("0")

    from payroll.schemes import Scheme

    ceiling_code = (
        RateCode.RETIREMENT_RELIEF_CEILING_SSF
        if scheme == Scheme.SSF
        else RateCode.RETIREMENT_RELIEF_CEILING
    )
    ceiling = get_rate(ceiling_code, fiscal_year)
    fraction = get_rate(RateCode.RETIREMENT_RELIEF_FRACTION, fiscal_year)

    candidates = [Decimal(annual_contribution)]
    if fraction is not None:
        candidates.append(Decimal(annual_assessable) * Decimal(fraction) / Decimal("100"))
    if ceiling is not None:
        candidates.append(Decimal(ceiling))

    # An unconfigured ceiling or fraction drops out of the comparison rather
    # than being treated as zero. Zero would silently relieve nothing, which is
    # the confident-and-wrong shape: the payslip would look ordinary and the
    # employee would simply be over-taxed.
    return max(Decimal("0"), min(candidates))


def period_income_tax(
    period_taxable,
    fiscal_year,
    *,
    period_contribution=Decimal("0"),
    scheme=None,
    taxpayer=None,
    periods=PERIODS_PER_YEAR,
):
    """This period's income tax.

    `period_taxable` is the period's **taxable** earnings — not gross. Which
    components count is the company's decision, carried by
    `SalaryComponent.taxable`, a flag that existed and was read by nothing.

    `period_contribution` is the employee side only. The employer's share is
    not the employee's income, so it neither adds to what is taxed nor earns
    relief.

    **Contributing to a fund waives the lowest band**, which is a social
    security tax rather than income tax. The band is still traversed, so the
    bands above start in the right place — skipping it outright would shift
    every higher band down and overtax every contributor.
    """
    from payroll.models import TaxSlab
    from payroll.services import compute_slab_tax

    taxpayer = taxpayer or TaxSlab.Taxpayer.INDIVIDUAL
    periods = Decimal(periods)

    annual_income = Decimal(period_taxable) * periods
    annual_contribution = Decimal(period_contribution) * periods

    relief = retirement_relief(annual_contribution, annual_income, fiscal_year, scheme)
    assessable = max(Decimal("0"), annual_income - relief)

    annual_tax = compute_slab_tax(
        assessable,
        fiscal_year,
        taxpayer=taxpayer,
        # Contributing at all is what waives the band — the amount is irrelevant.
        retirement_contributor=annual_contribution > 0,
    )
    return annual_tax / periods
