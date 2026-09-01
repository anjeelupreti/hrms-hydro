"""P1.1.4 — run mechanics: proration, loans, reconciliation, idempotency.

These are the failures that reach a person's bank account. Unlike the
sandbox tests, none of these are about malice — they are about a rule that
looked right in isolation and is wrong in combination with another rule.

Where a test documents a *known limitation* rather than a guarantee, it says
so explicitly. A test that quietly encodes a bug as expected behaviour is
worse than no test.
"""

from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from employees.models import Employee
from payroll.models import Loan, PayrollRun, Payslip, SalaryComponent
from payroll.services import (
    _upsert_structure_version,
    activate_loan,
    apply_loan_repayments,
    compute_payslip,
)

pytestmark = pytest.mark.django_db


def _make_employee(code, joined, dept, desig, username):
    User = get_user_model()
    user = User.objects.create_user(username=username, email=f"{username}@t.test", password="pw")
    return Employee.objects.create(
        user=user, employee_code=code, date_joined=joined,
        department=dept, designation=desig,
    )


# ── P1.1.4c — an employee with no salary structure ───────────────────────


def test_employee_without_a_structure_gets_a_zero_payslip_not_a_crash(
    company, payroll_setup
):
    """A new joiner whose structure hasn't been set up yet must not take the
    whole run down with an exception — the other 200 payslips still need to
    compute."""
    emp = _make_employee(
        "EMP-NOSTRUCT", date(2026, 1, 1),
        payroll_setup["dept"], payroll_setup["desig"], "nostruct",
    )

    payslip = compute_payslip(payroll_setup["run"], emp)

    assert payslip.gross_earnings == Decimal("0")
    assert payslip.net_pay == Decimal("0")
    assert payslip.payable_days == 0
    assert payslip.line_items.count() == 0


# ── P1.1.4f — the payslip reconciles to its own line items ───────────────


def test_line_items_sum_to_the_stated_totals(company, payroll_setup):
    """The headline figures and the breakdown are computed in the same pass,
    but stored separately. If they ever disagree, an employee is reading a
    payslip whose rows don't add up to its own total."""
    payslip = compute_payslip(payroll_setup["run"], payroll_setup["emp"])

    earnings = sum(
        li.amount for li in payslip.line_items.filter(component_type="earning")
    )
    deductions = sum(
        li.amount for li in payslip.line_items.filter(component_type="deduction")
    )

    assert earnings == payslip.gross_earnings
    assert deductions == payslip.total_deductions
    assert payslip.gross_earnings - payslip.total_deductions == payslip.net_pay


def test_reconciliation_holds_for_a_prorated_month(company, payroll_setup):
    """Proration multiplies values mid-computation, which is exactly where a
    rounding drift between the lines and the total would appear."""
    emp = _make_employee(
        "EMP-PRORATE", date(2026, 8, 17),
        payroll_setup["dept"], payroll_setup["desig"], "prorate",
    )
    _upsert_structure_version(
        emp, date(2026, 8, 17),
        [(payroll_setup["components"]["basic"], Decimal("33333"))],
        notes="Odd figure to force rounding",
    )

    payslip = compute_payslip(payroll_setup["run"], emp)

    earnings = sum(
        li.amount for li in payslip.line_items.filter(component_type="earning")
    )
    assert earnings == payslip.gross_earnings


# ── P1.1.4g — recomputation is idempotent ────────────────────────────────


def test_recomputing_replaces_line_items_rather_than_appending(company, payroll_setup):
    """HR fixes a structure and reruns. Without this, the payslip grows a
    duplicate set of rows each time and the totals double."""
    run, emp = payroll_setup["run"], payroll_setup["emp"]

    first = compute_payslip(run, emp)
    count_after_first = first.line_items.count()
    gross_after_first = first.gross_earnings

    second = compute_payslip(run, emp)

    assert second.pk == first.pk
    assert second.line_items.count() == count_after_first
    assert second.gross_earnings == gross_after_first
    assert Payslip.objects.filter(payroll_run=run, employee=emp).count() == 1


# ── P1.1.4d-ii — loan recovery decrements and auto-closes ────────────────


def _run_covering_today(payroll_setup, admin_user):
    """A draft run whose period contains today.

    `activate_loan` writes its salary-structure version effective `date.today()`,
    so the loan's deduction only appears on a payslip whose period contains
    today. A run pinned to a fixed month passes only while the wall clock is
    inside it, and fails every day afterwards.
    """
    today = date.today()
    return PayrollRun.objects.create(
        period_calendar="AD",
        period_year=today.year,
        period_month=today.month,
        status=PayrollRun.Status.DRAFT,
        created_by=admin_user,
    )


def test_loan_repayment_decrements_the_outstanding_balance(company, payroll_setup, admin_user):
    emp = payroll_setup["emp"]
    loan = Loan.objects.create(
        employee=emp, loan_type=Loan.LoanType.PERSONAL,
        principal_amount=Decimal("10000"), monthly_deduction=Decimal("2500"),
        outstanding_balance=Decimal("10000"), status=Loan.Status.APPROVED,
        # Overwritten by `activate_loan`, which dates the loan today.
        start_date=date.today(),
    )
    activate_loan(loan)

    payslip = compute_payslip(_run_covering_today(payroll_setup, admin_user), emp)
    apply_loan_repayments(payslip)

    loan.refresh_from_db()
    assert loan.outstanding_balance == Decimal("7500")
    assert loan.status == Loan.Status.ACTIVE


def test_loan_auto_closes_when_the_balance_reaches_zero(company, payroll_setup, admin_user):
    """The final instalment must close the loan and stop the deduction —
    otherwise it keeps deducting forever, which is the worst kind of payroll
    bug because the money is real and the employee has to notice it."""
    emp = payroll_setup["emp"]
    loan = Loan.objects.create(
        employee=emp, loan_type=Loan.LoanType.PERSONAL,
        principal_amount=Decimal("2500"), monthly_deduction=Decimal("2500"),
        outstanding_balance=Decimal("2500"), status=Loan.Status.APPROVED,
        # Overwritten by `activate_loan`, which dates the loan today.
        start_date=date.today(),
    )
    activate_loan(loan)

    payslip = compute_payslip(_run_covering_today(payroll_setup, admin_user), emp)
    apply_loan_repayments(payslip)

    loan.refresh_from_db()
    assert loan.outstanding_balance == Decimal("0")
    assert loan.status == Loan.Status.CLOSED
    assert loan.closed_at is not None


def test_repayment_never_exceeds_the_outstanding_balance(company, payroll_setup, admin_user):
    """Deduction of 2,500 against a 1,000 balance must take 1,000, not 2,500,
    and must not drive the balance negative."""
    emp = payroll_setup["emp"]
    loan = Loan.objects.create(
        employee=emp, loan_type=Loan.LoanType.PERSONAL,
        principal_amount=Decimal("10000"), monthly_deduction=Decimal("2500"),
        outstanding_balance=Decimal("10000"), status=Loan.Status.APPROVED,
        # Overwritten by `activate_loan`, which dates the loan today.
        start_date=date.today(),
    )
    activate_loan(loan)
    # activate_loan resets outstanding_balance to principal_amount, so the
    # near-final balance has to be set *after* activation, not before.
    loan.outstanding_balance = Decimal("1000")
    loan.save(update_fields=["outstanding_balance"])

    payslip = compute_payslip(_run_covering_today(payroll_setup, admin_user), emp)
    apply_loan_repayments(payslip)

    loan.refresh_from_db()
    assert loan.outstanding_balance == Decimal("0")
    assert loan.status == Loan.Status.CLOSED


def test_a_closed_loan_is_not_deducted_again(company, payroll_setup):
    """Running a second period after closure must leave the balance at zero
    rather than going negative."""
    emp = payroll_setup["emp"]
    loan = Loan.objects.create(
        employee=emp, loan_type=Loan.LoanType.PERSONAL,
        principal_amount=Decimal("2500"), monthly_deduction=Decimal("2500"),
        outstanding_balance=Decimal("2500"), status=Loan.Status.APPROVED,
        # Overwritten by `activate_loan`, which dates the loan today.
        start_date=date.today(),
    )
    activate_loan(loan)

    first = compute_payslip(payroll_setup["run"], emp)
    apply_loan_repayments(first)

    september = PayrollRun.objects.create(
        period_calendar="AD", period_year=2026, period_month=9, status=PayrollRun.Status.DRAFT,
    )
    second = compute_payslip(september, emp)
    apply_loan_repayments(second)

    loan.refresh_from_db()
    assert loan.outstanding_balance == Decimal("0")
    assert loan.status == Loan.Status.CLOSED


# ── P1.1.4b — leaver proration is a KNOWN GAP, not a guarantee ───────────


def test_a_leaver_is_paid_the_whole_month_documented_limitation(
    company, payroll_setup
):
    """`compute_proration` starts its window at max(month start, structure
    effective_from, date_joined) and always runs to month *end*. There is no
    exit-date input, so an employee who leaves on the 10th is paid for all 31
    days if they are still ACTIVE when the run executes.

    In practice `run_payroll` only includes ACTIVE employees, so the usual
    path is that a leaver is excluded entirely — which is a different wrong
    answer (paid nothing rather than paid ten days).

    This test documents the behaviour so the gap is visible; it is tracked as
    P1.1.4b. Change the assertion when exit-date proration lands.
    """
    emp = _make_employee(
        "EMP-LEAVER", date(2026, 1, 1),
        payroll_setup["dept"], payroll_setup["desig"], "leaver",
    )
    _upsert_structure_version(
        emp, date(2026, 1, 1),
        [(payroll_setup["components"]["basic"], Decimal("31000"))],
        notes="Initial",
    )
    emp.employment_status = Employee.EmploymentStatus.RESIGNED
    emp.save(update_fields=["employment_status"])

    payslip = compute_payslip(payroll_setup["run"], emp)

    # Full month, despite having resigned — the limitation being recorded.
    assert payslip.payable_days == 31
    assert payslip.gross_earnings > Decimal("0")


# ── Flat deductions are deliberately not prorated ────────────────────────


def test_flat_deductions_are_not_prorated_but_flat_earnings_are(
    company, payroll_setup
):
    """A half-month of work halves the salary but not a fixed debt. This is
    an intentional asymmetry in `compute_payslip` and worth pinning, because
    it looks like a bug to anyone reading the code for the first time."""
    fixed_fee = SalaryComponent.objects.create(
        code="union", name="Union dues",
        component_type=SalaryComponent.ComponentType.DEDUCTION,
        calc_type=SalaryComponent.CalcType.FLAT,
        amount=Decimal("1000"), is_active=True, order=10,
    )
    emp = _make_employee(
        "EMP-HALF", date(2026, 8, 17),
        payroll_setup["dept"], payroll_setup["desig"], "half",
    )
    _upsert_structure_version(
        emp, date(2026, 8, 17),
        [
            (payroll_setup["components"]["basic"], Decimal("31000")),
            (fixed_fee, Decimal("1000")),
        ],
        notes="Half month",
    )

    payslip = compute_payslip(payroll_setup["run"], emp)
    dues = payslip.line_items.get(component_code="union")

    assert payslip.payable_days == 15
    assert dues.amount == Decimal("1000.00")  # whole, not halved
