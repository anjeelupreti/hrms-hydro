"""§5.4 — finance reports.

These are read-only, so the risk is not corruption but **being quietly wrong**:
a breakdown whose parts do not sum to the whole, a variance that reports a first
run as everyone getting a 100% raise, a forecast that implies knowledge it does
not have. Each of those gets believed. So the tests are mostly about totals
reconciling and about the reports admitting what they cannot know.
"""

from decimal import Decimal

import pytest

from payroll.models import PayrollRun
from payroll.reports import (
    advances_report,
    cost_by_department,
    forecast,
    month_on_month_variance,
    render_statutory,
    salary_register,
)
from payroll.services import compute_payslip

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_pdf(monkeypatch):
    monkeypatch.setattr("payroll.tasks.generate_payslip_pdf", lambda *a, **k: None)


def _completed(run):
    run.status = PayrollRun.Status.COMPLETED
    run.recalculate_totals(save=False)
    run.save(update_fields=["status", "total_gross", "total_deductions", "total_net", "payslip_count"])
    return run


# ── Salary register ──────────────────────────────────────────────────────


def test_the_register_has_a_column_per_component_and_a_row_per_employee(
    company, payroll_setup
):
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)
    _completed(run)
    report = salary_register(run)

    codes = {c["code"] for c in report["columns"]}
    assert {"basic", "hra", "tax"} <= codes
    assert len(report["rows"]) == 1
    assert report["rows"][0]["employee_code"] == emp.employee_code


def test_the_register_totals_match_the_run(company, payroll_setup):
    """A register that does not reconcile with the run it summarises is the one
    thing finance will notice immediately."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    payslip = compute_payslip(run, emp)
    _completed(run)
    report = salary_register(run)

    assert report["totals"]["net_pay"] == payslip.net_pay
    assert report["rows"][0]["net_pay"] == payslip.net_pay


def test_earnings_come_before_deductions(company, payroll_setup):
    """So the register can be checked against a payslip by eye."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)
    _completed(run)
    report = salary_register(run)

    types = [c["type"] for c in report["columns"]]
    assert types == sorted(types, key=lambda t: t != "earning")


# ── Cost by department ───────────────────────────────────────────────────


def test_department_shares_sum_to_the_total(company, payroll_setup):
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)
    _completed(run)
    report = cost_by_department(run)

    assert sum((r["gross"] for r in report["rows"]), Decimal("0")) == report["total_gross"]


def test_an_employee_with_no_department_is_shown_not_dropped(
    company, payroll_setup, admin_user
):
    """A cost breakdown whose parts do not sum to the total is one nobody can
    trust — so "Unassigned" is a row, not an omission."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    emp.department = None
    emp.save(update_fields=["department"])
    compute_payslip(run, emp)
    _completed(run)
    report = cost_by_department(run)

    assert [r["department"] for r in report["rows"]] == ["Unassigned"]
    assert report["total_gross"] > 0


# ── Variance ─────────────────────────────────────────────────────────────


def test_a_first_run_reports_no_comparison_rather_than_a_100_percent_rise(
    company, payroll_setup
):
    """Comparing against zero would show every employee as a 100% increase —
    technically true, completely useless, and alarming."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)
    _completed(run)
    report = month_on_month_variance(run)

    assert report["previous_period"] is None
    assert report["rows"] == []


def test_variance_reports_a_change_between_two_runs(company, payroll_setup, admin_user):
    emp = payroll_setup["emp"]
    july = PayrollRun.objects.create(
        period_calendar="AD", period_year=2026, period_month=7,
        status=PayrollRun.Status.DRAFT, created_by=admin_user,
    )
    compute_payslip(july, emp)
    _completed(july)

    august = payroll_setup["run"]
    payslip = compute_payslip(august, emp)
    # Simulate a raise applied for August.
    payslip.net_pay += Decimal("5000")
    payslip.save(update_fields=["net_pay"])
    _completed(august)

    report = month_on_month_variance(august)

    # Named, not numbered — "2026-07" told a Nepali payroll officer nothing
    # about which of their months it was (D-06).
    assert report["previous_period"] == "July 2026"
    row = report["rows"][0]
    assert row["delta"] == Decimal("5000")
    assert row["change"] == "increased"


def test_variance_names_joiners_and_leavers(company, payroll_setup, admin_user):
    """"Left" and "joined" are the two rows most worth looking at — a leaver
    still being paid, or somebody appearing who should not be."""
    from employees.models import Employee
    from payroll.models import SalaryComponent
    from payroll.services import _upsert_structure_version

    emp = payroll_setup["emp"]
    basic = SalaryComponent.objects.get(code="basic")
    user = type(admin_user).objects.create(
        username="newjoiner", email="newjoiner@acme.localhost", role="employee"
    )
    joiner = Employee.objects.create(
        user=user, employee_code="EMP-NEW", date_joined=emp.date_joined,
    )
    _upsert_structure_version(joiner, emp.date_joined, [(basic, Decimal("20000"))], notes="t")

    july = PayrollRun.objects.create(
        period_calendar="AD", period_year=2026, period_month=7,
        status=PayrollRun.Status.DRAFT, created_by=admin_user,
    )
    compute_payslip(july, emp)          # only the original employee
    _completed(july)

    august = payroll_setup["run"]
    compute_payslip(august, joiner)     # only the joiner
    _completed(august)

    report = month_on_month_variance(august)

    changes = {r["employee_code"]: r["change"] for r in report["rows"]}
    assert changes[emp.employee_code] == "left"
    assert changes["EMP-NEW"] == "joined"
    assert report["totals"]["joined"] == 1
    assert report["totals"]["left"] == 1


# ── Advances ─────────────────────────────────────────────────────────────


def test_advances_reports_outstanding_and_months_remaining(company, payroll_setup):
    from payroll.models import Loan

    emp = payroll_setup["emp"]
    Loan.objects.create(
        employee=emp, loan_type=Loan.LoanType.PERSONAL,
        principal_amount=Decimal("30000"), monthly_deduction=Decimal("5000"),
        outstanding_balance=Decimal("12000"), status=Loan.Status.ACTIVE,
    )
    report = advances_report()

    assert report["count"] == 1
    assert report["total_outstanding"] == Decimal("12000")
    # 12,000 at 5,000 a month is three more runs, not two.
    assert report["rows"][0]["months_remaining"] == 3


# ── Forecast ─────────────────────────────────────────────────────────────


def test_the_forecast_states_its_assumptions(company, payroll_setup):
    """A forecast that does not say what it assumes is a guess wearing a
    number's clothes."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)
    _completed(run)
    report = forecast(months=3)

    assert len(report["rows"]) == 3
    assert report["basis"] == "August 2026"
    assert any("Headcount unchanged" in a for a in report["assumptions"])


def test_the_forecast_rises_when_a_loan_finishes_repaying(company, payroll_setup):
    """The one adjustment it does make: a deduction ending raises net pay, and
    that is arithmetic rather than prediction."""
    from payroll.models import Loan

    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)
    _completed(run)
    Loan.objects.create(
        employee=emp, loan_type=Loan.LoanType.PERSONAL,
        principal_amount=Decimal("10000"), monthly_deduction=Decimal("5000"),
        outstanding_balance=Decimal("5000"), status=Loan.Status.ACTIVE,
    )
    report = forecast(months=2)

    # Clears in the first projected month, so net rises from then on.
    assert report["rows"][0]["loans_completing"] == Decimal("5000")
    assert report["rows"][1]["projected_net"] == report["rows"][0]["projected_net"]


def test_a_forecast_with_no_completed_run_says_so(company, payroll_setup):
    report = forecast(months=3)

    assert report["basis"] is None
    assert report["rows"] == []


# ── The statutory seam ───────────────────────────────────────────────────


def test_an_unregistered_statutory_format_raises(company, payroll_setup):
    """No formats are registered yet, and asking for one must say that rather
    than returning an empty file somebody then submits."""
    run = payroll_setup["run"]
    with pytest.raises(ValueError, match="none yet"):
        render_statutory(run, "etds")


# ── Through the API ──────────────────────────────────────────────────────


def test_the_reports_are_hr_only(company, payroll_setup, employee_client, hr_client):
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)
    _completed(run)
    denied = employee_client.get(f"/api/v1/payroll/runs/{run.id}/register/")
    allowed = hr_client.get(f"/api/v1/payroll/runs/{run.id}/register/")

    assert denied.status_code in (403, 404)
    assert allowed.status_code == 200
    assert allowed.data["rows"]
