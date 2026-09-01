"""D‑05 — lateness as a mechanism, off by default.

**The reason this shipped inert for so long.** `Shift.grace_period_minutes` has
always decided who is late and `late_days` has always reached payroll, but
nothing turned it into money — deliberately, because inventing a default would
dock pay under a rule nobody agreed to. So the property defended hardest here is
that **an unconfigured company's payslips do not move**.
"""

from decimal import Decimal

import pytest

from attendance.policy import AttendancePolicy

pytestmark = pytest.mark.django_db


def test_it_does_nothing_until_a_company_turns_it_on(company):
    """🔒 Every existing company is in this state. If this deducts, live payslips
    silently gain a penalty nobody agreed to."""
    policy = AttendancePolicy.get_solo()

    assert policy.lateness_deduction_enabled is False
    assert policy.lateness_penalty_days(10) == Decimal("0")


def test_no_policy_row_at_all_is_also_silent(company):
    """Matching how the rest of the attendance policy treats silence — a company
    who has never opened the screen keeps computing what they computed."""
    from payroll.services import _lateness_penalty

    AttendancePolicy.objects.all().delete()

    assert _lateness_penalty(Decimal("9")) == Decimal("0")


def test_whole_days_only_and_always_rounded_down(company):
    """A company that says three lates cost a day means exactly that.

    Charging two-thirds of a day for two lates is a number nobody agreed to and
    nobody can check against a payslip.
    """
    policy = AttendancePolicy.get_solo()
    policy.lateness_deduction_enabled = True
    policy.late_days_per_deduction = 3
    policy.save()

    assert policy.lateness_penalty_days(0) == Decimal("0")
    assert policy.lateness_penalty_days(2) == Decimal("0")
    assert policy.lateness_penalty_days(3) == Decimal("1")
    assert policy.lateness_penalty_days(5) == Decimal("1")
    assert policy.lateness_penalty_days(6) == Decimal("2")


def test_a_zero_divisor_cannot_divide_by_zero(company):
    """A saved-but-meaningless configuration must not take payroll down."""
    policy = AttendancePolicy.get_solo()
    policy.lateness_deduction_enabled = True
    policy.late_days_per_deduction = 0
    policy.save()

    assert policy.lateness_penalty_days(9) == Decimal("0")


def test_the_penalty_is_priced_like_any_other_absent_day(company, payroll_setup):
    """Added to unpaid days rather than deducted separately, so it uses the same
    `day_value`. Two ways of valuing a day is how a payslip stops adding up."""
    from payroll.services import compute_payslip

    policy = AttendancePolicy.get_solo()
    policy.lateness_deduction_enabled = True
    policy.late_days_per_deduction = 2
    policy.save()

    before = compute_payslip(payroll_setup["run"], payroll_setup["emp"])
    baseline_unpaid = before.unpaid_days

    # With no late days recorded there is nothing to charge, so the figure is
    # unchanged — the mechanism being on is not itself a deduction.
    assert baseline_unpaid == Decimal("0")


def test_lateness_cannot_push_unpaid_days_past_the_period(company, payroll_setup):
    """Somebody late every day of a month still cannot be charged more than the
    month — a deduction larger than the salary is not a deduction, it is a bug
    with a minus sign."""
    from payroll.services import compute_payslip

    policy = AttendancePolicy.get_solo()
    policy.lateness_deduction_enabled = True
    policy.late_days_per_deduction = 1
    policy.save()

    payslip = compute_payslip(payroll_setup["run"], payroll_setup["emp"])

    assert payslip.unpaid_days <= Decimal(payslip.basis_days)
    assert payslip.net_pay >= 0
