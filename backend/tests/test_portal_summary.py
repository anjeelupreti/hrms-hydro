"""§9 — the self-service portal's aggregate.

Every fact here was already reachable; what did not exist was a single answer.
So the tests are about the two properties an aggregate must have and a
collection of endpoints does not: it is **scoped to the caller with no id to
tamper with**, and its figures are **bounded by the fiscal year** the company
actually uses rather than a calendar year.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from accounts.portal import portal_summary
from attendance.models import AttendanceLog, OvertimeRecord, RegularisationRequest
from leave.models import LeaveBalance, LeaveRequest, LeaveType

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_pdf(monkeypatch):
    monkeypatch.setattr("payroll.tasks.generate_payslip_pdf", lambda *a, **k: None)


# ── It is about the caller, and nobody else ──────────────────────────────


def test_the_endpoint_takes_no_employee_parameter(company, payroll_setup, admin_client):
    """The subject is whoever is calling.

    There is no id in the request to change, which is the only reliable way to
    keep a self-service surface self-service.
    """
    emp = payroll_setup["emp"]
    response = admin_client.get("/api/v1/accounts/portal/summary/?employee=999999")

    assert response.status_code == 200
    assert response.data["me"]["employee_code"] == emp.employee_code


def test_an_account_with_no_employee_record_gets_a_clear_answer(company, hr_client):
    """An HR admin who is not themselves an employee is a real configuration,
    and saying so beats an empty portal that looks broken."""
    response = hr_client.get("/api/v1/accounts/portal/summary/")

    assert response.status_code == 404
    assert response.data["code"] == "no_employee_record"


def test_it_is_refused_without_a_session(company, api_client):
    response = api_client.get("/api/v1/accounts/portal/summary/")

    assert response.status_code in (401, 403)


# ── The fiscal year, not the calendar year ───────────────────────────────


def test_the_default_fiscal_year_is_the_companies_own(company, payroll_setup):
    """Nepal's year runs Shrawan→Ashad. Reporting a leave balance or an
    attendance rate against January→December would be wrong for the company
    this is built for."""
    summary = portal_summary(payroll_setup["emp"])

    label = summary["fiscal_year"]["label"]
    assert "/" in label  # 2083/84, not "2026"
    start, end = summary["fiscal_year"]["start"], summary["fiscal_year"]["end"]
    assert start < end
    # A Shrawan→Ashad year does not begin in January.
    assert start.month != 1


def test_an_explicit_fiscal_year_is_honoured(company, payroll_setup, admin_client):
    response = admin_client.get("/api/v1/accounts/portal/summary/?fiscal_year=2082")

    assert response.status_code == 200
    assert response.data["fiscal_year"]["year"] == 2082
    assert response.data["fiscal_year"]["label"].startswith("2082")


def test_a_nonsense_fiscal_year_is_rejected(company, payroll_setup, admin_client):
    response = admin_client.get("/api/v1/accounts/portal/summary/?fiscal_year=last")

    assert response.status_code == 400


# ── Attendance ───────────────────────────────────────────────────────────


def test_lateness_counts_as_attended_but_not_as_punctual(company, payroll_setup):
    """Somebody who arrived at 09:20 was at work. An attendance rate that says
    otherwise misrepresents them — but punctuality is a different question, and
    conflating the two hides both.
    """
    emp = payroll_setup["emp"]
    summary = portal_summary(emp)
    start = summary["fiscal_year"]["start"]
    for offset, status_value in enumerate([
        AttendanceLog.Status.PRESENT,
        AttendanceLog.Status.PRESENT,
        AttendanceLog.Status.LATE,
        AttendanceLog.Status.ABSENT,
    ]):
        AttendanceLog.objects.create(
            employee=emp, date=start + timedelta(days=offset), status=status_value
        )
    summary = portal_summary(emp)

    block = summary["attendance"]
    assert block["days_logged"] == 4
    assert block["attendance_rate"] == 75.0    # three of four were at work
    assert block["punctuality_rate"] == 50.0   # two of four were on time


def test_attendance_rates_are_none_rather_than_zero_when_nothing_is_logged(
    company, payroll_setup
):
    """Zero percent attendance and no records are different facts, and showing
    the first for the second accuses somebody of never turning up."""
    summary = portal_summary(payroll_setup["emp"])

    assert summary["attendance"]["days_logged"] == 0
    assert summary["attendance"]["attendance_rate"] is None


# ── Leave ────────────────────────────────────────────────────────────────


def test_leave_balances_report_remaining_per_type(company, payroll_setup):
    emp = payroll_setup["emp"]
    summary = portal_summary(emp)
    year = summary["fiscal_year"]["year"]
    annual, _ = LeaveType.objects.get_or_create(
        name="Annual", defaults={"is_paid": True, "code": "annual"}
    )
    LeaveBalance.objects.create(
        employee=emp, leave_type=annual, year=year,
        allocated_days=Decimal("12"), carried_forward_days=Decimal("3"),
        used_days=Decimal("5"),
    )
    summary = portal_summary(emp)

    row = summary["leave"]["balances"][0]
    assert row["remaining"] == Decimal("10")     # 12 + 3 − 5
    assert summary["leave"]["total_remaining"] == Decimal("10")


def test_paid_and_unpaid_leave_are_counted_separately(company, payroll_setup):
    """The distinction that decides whether a day costs money."""
    emp = payroll_setup["emp"]
    summary = portal_summary(emp)
    start = summary["fiscal_year"]["start"]
    paid, _ = LeaveType.objects.get_or_create(
        name="Annual", defaults={"is_paid": True, "code": "annual"}
    )
    unpaid, _ = LeaveType.objects.get_or_create(
        name="Unpaid", defaults={"is_paid": False, "code": "unpaid"}
    )
    for leave_type, is_paid, days in ((paid, True, 2), (unpaid, False, 3)):
        LeaveRequest.objects.create(
            employee=emp, leave_type=leave_type,
            start_date=start + timedelta(days=1),
            end_date=start + timedelta(days=days),
            days_requested=Decimal(days), status=LeaveRequest.Status.APPROVED,
            is_paid=is_paid,
        )
    summary = portal_summary(emp)

    assert summary["leave"]["taken_paid_days"] == Decimal("2")
    assert summary["leave"]["taken_unpaid_days"] == Decimal("3")


def test_pending_leave_is_not_counted_as_taken(company, payroll_setup):
    emp = payroll_setup["emp"]
    summary = portal_summary(emp)
    start = summary["fiscal_year"]["start"]
    unpaid, _ = LeaveType.objects.get_or_create(
        name="Unpaid", defaults={"is_paid": False, "code": "unpaid"}
    )
    LeaveRequest.objects.create(
        employee=emp, leave_type=unpaid,
        start_date=start + timedelta(days=1), end_date=start + timedelta(days=2),
        days_requested=Decimal("2"), status=LeaveRequest.Status.PENDING, is_paid=False,
    )
    summary = portal_summary(emp)

    assert summary["leave"]["taken_unpaid_days"] == Decimal("0")
    assert summary["leave"]["pending_requests"] == 1


# ── "Is anything of mine stuck?" ─────────────────────────────────────────


def test_pending_requests_are_totalled_across_every_kind(company, payroll_setup):
    """The question no single existing page answers."""
    emp = payroll_setup["emp"]
    RegularisationRequest.objects.create(
        employee=emp, date=date.today(), requested_status="present", reason="Badge failed."
    )
    OvertimeRecord.objects.create(
        employee=emp, date=date.today(), hours=Decimal("2"),
        status=OvertimeRecord.Status.PENDING,
    )
    summary = portal_summary(emp)

    assert summary["requests"]["pending"]["regularisation"] == 1
    assert summary["requests"]["pending"]["overtime"] == 1
    assert summary["requests"]["total_pending"] == 2


# ── Identity ─────────────────────────────────────────────────────────────


def test_tenure_is_reported_in_years_and_days(company, payroll_setup):
    """"1 year, 214 days" is how anybody actually says it — a decimal is not."""
    emp = payroll_setup["emp"]
    emp.date_joined = date.today() - timedelta(days=400)
    emp.save(update_fields=["date_joined"])
    summary = portal_summary(emp)

    assert summary["me"]["tenure_years"] == 1
    assert summary["me"]["tenure_days"] == 400


def test_pay_reports_the_latest_payslip_and_the_year_to_date(company, payroll_setup):
    from payroll.models import Payslip
    from payroll.services import compute_payslip

    emp, run = payroll_setup["emp"], payroll_setup["run"]
    payslip = compute_payslip(run, emp)
    payslip.status = Payslip.Status.FINALIZED
    payslip.save(update_fields=["status"])
    summary = portal_summary(emp)

    assert summary["pay"]["latest"]["period"] == "August 2026"
    assert summary["pay"]["latest"]["net_pay"] == payslip.net_pay


def test_the_year_to_date_counts_a_bikram_sambat_run(company, payroll_setup):
    """Year-to-date is summed through `period_window`, so a Bikram Sambat run
    counts (D-06).

    `date(period_year, period_month, 1)` on such a run is `date(2083, 5, 1)` —
    a valid Gregorian date fifty-seven years out, never inside the fiscal year
    being summed. `in_year` comes back empty and the portal tells an employee
    they have earned nothing all year, while showing them a payslip.
    """
    from payroll.models import PayrollRun, Payslip
    from payroll.services import compute_payslip

    emp = payroll_setup["emp"]
    # Shrawan 2083 — 17 July to 16 August 2026, which is inside the
    # company's current fiscal year and nowhere near year 2083.
    run = PayrollRun.objects.create(
        period_calendar="BS", period_year=2083, period_month=4
    )
    payslip = compute_payslip(run, emp)
    payslip.status = Payslip.Status.FINALIZED
    payslip.save(update_fields=["status"])
    summary = portal_summary(emp)

    assert summary["pay"]["latest"]["period"] == "Shrawan 2083"
    # The assertion that actually fails on the old code: the payslip is counted.
    assert summary["pay"]["payslip_count"] == 1
    assert summary["pay"]["gross_earned"] == payslip.gross_earnings


def test_a_draft_payslip_is_not_shown_to_the_employee(company, payroll_setup):
    """A draft is a working figure, not what somebody is being paid — showing
    it invites an argument about a number nobody has approved."""
    from payroll.services import compute_payslip

    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)          # left as DRAFT
    summary = portal_summary(emp)

    assert summary["pay"]["latest"] is None
    assert summary["pay"]["payslip_count"] == 0
