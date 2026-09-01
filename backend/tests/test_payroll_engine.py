from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from employees.models import Employee
from payroll.models import Loan
from payroll.services import _upsert_structure_version, activate_loan, compute_payslip

pytestmark = pytest.mark.django_db


def test_compute_payslip_full_month(company, payroll_setup):
    run = payroll_setup["run"]
    emp = payroll_setup["emp"]
        
    payslip = compute_payslip(run, emp)
        
    # August 2026 has 31 days
    assert payslip.period_days == 31
    assert payslip.payable_days == 31
        
    # Basic: 50000, HRA: 40% of Basic = 20000. Gross = 70000
    # Tax: basic * 0.1 = 5000. Net = 65000
    assert payslip.gross_earnings == Decimal("70000.00")
    assert payslip.total_deductions == Decimal("5000.00")
    assert payslip.net_pay == Decimal("65000.00")


def test_compute_payslip_mid_month_joiner(company, payroll_setup, admin_user):
    run = payroll_setup["run"]
    dept = payroll_setup["dept"]
    desig = payroll_setup["desig"]
    basic = payroll_setup["components"]["basic"]
        
    User = get_user_model()
    user2 = User.objects.create_user(username="midjoiner", email="mid@test.com", password="pwd")
    # Joined on August 16
    emp2 = Employee.objects.create(
        user=user2,
        employee_code="EMP-002",
        date_joined=date(2026, 8, 16),
        department=dept,
        designation=desig,
    )
    _upsert_structure_version(emp2, date(2026, 8, 16), [(basic, Decimal("62000"))], notes="Initial")
        
    # Proration: 16th to 31st = 16 days out of 31.
    # factor = 16 / 31
    # basic = 62000 * (16 / 31) = 32000
        
    payslip = compute_payslip(run, emp2)
    assert payslip.payable_days == 16
    assert payslip.gross_earnings == Decimal("32000.00")


def test_loan_deduction_is_not_prorated(company, payroll_setup, admin_user):
    run = payroll_setup["run"]
    dept = payroll_setup["dept"]
    desig = payroll_setup["desig"]
    basic = payroll_setup["components"]["basic"]

    # Joined mid-month, so their pay is prorated
    User = get_user_model()
    user3 = User.objects.create_user(username="loanuser", email="loan@test.com", password="pwd")
    emp = Employee.objects.create(
        user=user3,
        employee_code="EMP-LOAN",
        date_joined=date(2026, 8, 16),
        department=dept,
        designation=desig,
    )
        
    # Give them a base salary
    _upsert_structure_version(emp, date(2026, 8, 16), [(basic, Decimal("31000"))], notes="New")
        
    # Give employee a loan
    loan = Loan.objects.create(
        employee=emp,
        loan_type=Loan.LoanType.OFFICE,
        principal_amount=Decimal("10000"),
        monthly_deduction=Decimal("1000"),
        status=Loan.Status.APPROVED,
    )
        
    # We need to mock date.today() in activate_loan if it runs "today" which could be before Aug 16,
    # but actually, if today is before Aug 16, activate_loan creates a structure on "today".
    # Then when compute_payslip runs for period_end (Aug 31), the active structure is the Aug 16 one!
    # So activate_loan's changes would be lost if we don't mock today.
    # Instead, let's just create the loan component manually for testing the engine,
    # or use patch.
    from unittest.mock import patch
    with patch('payroll.services.date') as mock_date:
        mock_date.today.return_value = date(2026, 8, 16)
        activate_loan(loan)

    # Now 16 days payable. factor = 16/31. Basic = 31000 * 16/31 = 16000
    # Loan deduction = 1000 (flat deductions are NOT prorated)
    # Deductions = 1000
        
    payslip = compute_payslip(run, emp)
    assert payslip.payable_days == 16
        
    loan_item = payslip.line_items.filter(component_code="loan_repayment").first()
    assert loan_item is not None
    assert loan_item.amount == Decimal("1000.00")
        
    assert payslip.total_deductions == Decimal("1000.00")
