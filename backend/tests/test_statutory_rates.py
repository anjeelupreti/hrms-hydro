"""Statutory rates — configurable, effective-dated, and honest about defaults.

D14 recorded that these figures are set annually by somebody else's legislation
and must not be constants. These tests pin the three properties that makes true:
they are data, they are dated, and a shipped default is visibly a default.
"""

from decimal import Decimal

import pytest

from payroll.models import StatutoryRate
from payroll.statutory import RateCode, get_rate, seed_statutory_rates

pytestmark = pytest.mark.django_db

FY = 2082


def test_the_nepal_defaults_seed(company):
    created = seed_statutory_rates(FY)

    assert RateCode.SSF_EMPLOYEE in created
    assert get_rate(RateCode.SSF_EMPLOYEE, FY) == Decimal("11")
    assert get_rate(RateCode.SSF_EMPLOYER, FY) == Decimal("20")


def test_every_seeded_rate_is_marked_unverified(company):
    """The honest part of the design.

    Seeding sensible values makes the product usable on day one. Without this
    flag those placeholders would be indistinguishable from figures somebody
    actually checked — which is the confident-and-wrong failure the whole
    module exists to avoid.
    """
    seed_statutory_rates(FY)
    assert not StatutoryRate.objects.filter(fiscal_year=FY, is_verified=True).exists()


def test_seeding_twice_does_not_overwrite_a_verified_figure(company):
    """Re-running the seed after an accountant has entered the real number
    must not quietly put the placeholder back."""
    seed_statutory_rates(FY)
    rate = StatutoryRate.objects.get(code=RateCode.SSF_EMPLOYEE, fiscal_year=FY)
    rate.value = Decimal("11.5")
    rate.is_verified = True
    rate.source = "Finance Act 2082"
    rate.save()

    seed_statutory_rates(FY)
    rate.refresh_from_db()

    assert rate.value == Decimal("11.5")
    assert rate.is_verified is True


def test_a_rate_is_looked_up_per_fiscal_year(company):
    """Correcting this year's rate must not restate last year's payslips."""
    seed_statutory_rates(FY)
    seed_statutory_rates(FY + 1)
    newer = StatutoryRate.objects.get(code=RateCode.SSF_EMPLOYEE, fiscal_year=FY + 1)
    newer.value = Decimal("13")
    newer.save()

    assert get_rate(RateCode.SSF_EMPLOYEE, FY) == Decimal("11")
    assert get_rate(RateCode.SSF_EMPLOYEE, FY + 1) == Decimal("13")


def test_a_missing_year_falls_back_to_the_most_recent_earlier_one(company):
    """A company who has not entered next year's figures yet should keep
    computing on last year's, not silently drop to zero — which would look
    like a correct payslip with a contribution missing."""
    seed_statutory_rates(FY)
    assert get_rate(RateCode.SSF_EMPLOYEE, FY + 5) == Decimal("11")


def test_an_unconfigured_rate_returns_the_supplied_default(company):
    assert get_rate("nonexistent_rate", FY, default=Decimal("7")) == Decimal("7")
    assert get_rate("nonexistent_rate", FY) is None


def test_overtime_uses_the_rate_table_over_the_profile_default(company, payroll_setup):
    """One rate, one place. A figure held in two places is a figure that can
    disagree with itself."""
    from payroll.models import SalaryComponent
    from payroll.services import compute_payslip

    emp, run = payroll_setup["emp"], payroll_setup["run"]
    from datetime import date

    from attendance.models import OvertimeRecord
    from core.calendars import get_calendar

    fiscal_year = get_calendar("BS").fiscal_year_of(date(2026, 8, 31))
    seed_statutory_rates(fiscal_year)
    rate = StatutoryRate.objects.get(
        code=RateCode.OVERTIME_MULTIPLIER, fiscal_year=fiscal_year
    )
    rate.value = Decimal("2")  # not the 1.5 default
    rate.save()

    ot = SalaryComponent.objects.create(
        code="ot_pay", name="Overtime",
        component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.FORMULA,
        formula="overtime_hours * overtime_multiplier",
        is_active=True, order=8,
    )
    emp.salary_structures.latest("effective_from").assignments.create(component=ot, amount=None)
    OvertimeRecord.objects.create(
        employee=emp, date=date(2026, 8, 4), hours=Decimal("10"),
        status=OvertimeRecord.Status.APPROVED,
    )

    payslip = compute_payslip(run, emp)
    amount = payslip.line_items.get(component_code="ot_pay").amount

    assert amount == Decimal("20.00")  # 10h × 2, not × 1.5
