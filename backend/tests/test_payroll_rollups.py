"""§5.3 — run totals, and a failed employee that neither hangs nor vanishes.

The error tests carry the weight here. The previous behaviour — let the
exception fail the chord — was defended as safe, and it was: a partial run
could never be reported as done. What it was not is *useful*. These pin the
replacement, whose whole risk is that recording an error instead of raising
makes a broken run finalisable.
"""

from decimal import Decimal

import pytest

from payroll.models import PayrollError, PayrollRun, SalaryComponent
from payroll.services import _upsert_structure_version, compute_payslip
from payroll.tasks import finalize_payroll_run, process_payslip

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_pdf(monkeypatch):
    """Stub PDF rendering.

    WeasyPrint needs native GTK/Pango libraries that are not present on Windows
    (see payroll/README.md). `finalize` regenerates payslip PDFs, and with
    Celery eager in tests that runs inline, so an environment gap would fail
    tests about payroll arithmetic. The figures are the payroll result; the PDF
    is a rendering of them, which is the same separation `process_payslip`
    already makes.
    """
    monkeypatch.setattr("payroll.tasks.generate_payslip_pdf", lambda *a, **k: None)
    monkeypatch.setattr("payroll.pdf.generate_payslip_pdf", lambda *a, **k: None)


# ── Rollups ──────────────────────────────────────────────────────────────


def test_totals_are_derived_from_the_payslips(company, payroll_setup):
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    payslip = compute_payslip(run, emp)
    run.recalculate_totals()
    run.refresh_from_db()

    assert run.payslip_count == 1
    assert run.total_gross == payslip.gross_earnings
    assert run.total_deductions == payslip.total_deductions
    assert run.total_net == payslip.net_pay


def test_recalculating_is_idempotent(company, payroll_setup):
    """Recomputed wholesale rather than adjusted, so it is self-healing —
    running it twice must not double anything."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)
    run.recalculate_totals()
    first = run.total_net
    run.recalculate_totals()
    run.refresh_from_db()

    assert run.total_net == first


def test_held_payslips_still_count_toward_the_period_total(company, payroll_setup):
    """What is *due* and what is *disbursed* are different questions.

    Excluding held payslips would make the run's total drop when somebody
    places a hold, which would misreport what the month actually costs.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    payslip = compute_payslip(run, emp)
    payslip.is_held = True
    payslip.save(update_fields=["is_held"])
    run.recalculate_totals()
    run.refresh_from_db()

    assert run.payslip_count == 1
    assert run.total_net == payslip.net_pay


def test_an_empty_run_totals_zero_rather_than_none(company, payroll_setup, admin_user):
    """`Sum` over nothing is NULL, and a null total would render as a blank
    where a reader expects a number."""
    empty = PayrollRun.objects.create(
        period_calendar="AD", period_year=2027, period_month=3,
        status=PayrollRun.Status.DRAFT, created_by=admin_user,
    )
    empty.recalculate_totals()
    empty.refresh_from_db()

    assert empty.payslip_count == 0
    assert empty.total_net == Decimal("0")


# ── Errors ───────────────────────────────────────────────────────────────


def _break_the_structure(emp):
    """A percentage-of component with no base — B3's configuration error."""
    orphan = SalaryComponent.objects.create(
        code="broken_pct", name="Broken %",
        component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.PERCENTAGE_OF,
        percentage_of=None, amount=Decimal("10"), is_active=True, order=9,
    )
    structure = emp.salary_structures.latest("effective_from")
    structure.assignments.create(component=orphan, amount=Decimal("10"))


def test_a_failing_employee_is_recorded_not_raised(company, payroll_setup):
    """The behaviour change. Raising failed the chord and left the run stuck at
    PROCESSING, which told HR nothing about who failed or why."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    _break_the_structure(emp)

    result = process_payslip(run.id, emp.id)
    error = PayrollError.objects.get(payroll_run=run, employee=emp)

    assert result is None  # did not raise
    assert error.error_type == "PayrollConfigurationError"
    assert "no base component" in error.message


def test_a_run_with_errors_cannot_be_finalized(company, payroll_setup, hr_client):
    """The guard that makes recording errors safe rather than merely permissive.

    Finalising locks the period, so approving a run that is missing somebody's
    payslip would freeze the gap in place.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    _break_the_structure(emp)
    process_payslip(run.id, emp.id)
    run.status = PayrollRun.Status.COMPLETED
    run.save(update_fields=["status"])

    response = hr_client.post(f"/api/v1/payroll/runs/{run.id}/finalize/", {}, format="json")
    run.refresh_from_db()

    assert response.status_code == 409
    assert response.data["code"] == "payroll_errors_unresolved"
    # Named, not just counted — "3 errors" sends HR looking for which three.
    assert response.data["errors"][0]["employee_code"] == emp.employee_code
    # And the period stayed open.
    assert run.locked_at is None


def test_fixing_the_structure_and_re_running_clears_the_error(company, payroll_setup, hr_client):
    """Without this the run would be correct and still refuse to close —
    a stale error blocking finalise forever is worse than the original bug.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    _break_the_structure(emp)
    process_payslip(run.id, emp.id)
    assert PayrollError.objects.filter(payroll_run=run).exists()

    # HR fixes it: drop the broken component from the structure.
    structure = emp.salary_structures.latest("effective_from")
    structure.assignments.filter(component__code="broken_pct").delete()

    process_payslip(run.id, emp.id)

    assert not PayrollError.objects.filter(payroll_run=run).exists()

    run.status = PayrollRun.Status.COMPLETED
    run.save(update_fields=["status"])
    response = hr_client.post(f"/api/v1/payroll/runs/{run.id}/finalize/", {}, format="json")

    assert response.status_code == 200


def test_one_employees_failure_does_not_stop_the_others(company, payroll_setup, admin_user):
    """The original reason each employee is its own task, now actually true:
    before, one failure took the whole run down with it."""
    from employees.models import Employee

    emp, run = payroll_setup["emp"], payroll_setup["run"]
    healthy_user = type(admin_user).objects.create(
        username="healthy", email="healthy@acme.localhost", role="employee"
    )
    healthy = Employee.objects.create(
        user=healthy_user, employee_code="EMP-777",
        date_joined=emp.date_joined, department=emp.department, designation=emp.designation,
    )
    basic = SalaryComponent.objects.get(code="basic")
    _upsert_structure_version(healthy, emp.date_joined, [(basic, Decimal("40000"))], notes="test")

    _break_the_structure(emp)

    process_payslip(run.id, emp.id)
    process_payslip(run.id, healthy.id)

    finalize_payroll_run(run.id)
    run.refresh_from_db()
    # Counted inside the company context: outside it the query runs against
    # the public schema, where the table does not exist.
    error_count = PayrollError.objects.filter(payroll_run=run).count()

    # The healthy employee was paid, the run completed, and the failure is
    # visible rather than silent.
    assert run.status == PayrollRun.Status.COMPLETED
    assert run.payslip_count == 1
    assert error_count == 1


def test_stats_reports_median_as_well_as_average(company, payroll_setup, hr_client, admin_user):
    """Median *and* average, because payroll distributions are skewed and
    either number alone can mislead about what a typical person earns."""
    from employees.models import Employee

    emp, run = payroll_setup["emp"], payroll_setup["run"]
    basic = SalaryComponent.objects.get(code="basic")
    for index, salary in enumerate(("20000", "300000"), start=1):
        user = type(admin_user).objects.create(
            username=f"peer{index}", email=f"peer{index}@acme.localhost", role="employee"
        )
        peer = Employee.objects.create(
            user=user, employee_code=f"EMP-90{index}",
            date_joined=emp.date_joined, department=emp.department,
            designation=emp.designation,
        )
        _upsert_structure_version(peer, emp.date_joined, [(basic, Decimal(salary))], notes="test")
        compute_payslip(run, peer)

    compute_payslip(run, emp)
    run.recalculate_totals()

    response = hr_client.get(f"/api/v1/payroll/runs/{run.id}/stats/")

    assert response.status_code == 200
    body = response.data
    assert body["payslip_count"] == 3
    # The 300,000 outlier drags the mean above the middle earner — which is
    # exactly why both figures are reported.
    assert body["median_net"] < body["average_net"]
    assert body["lowest_net"] < body["median_net"] < body["highest_net"]


# ── Unverified statutory figures block finalisation ──────────────────────


def test_a_run_cannot_be_finalized_on_unverified_statutory_figures(
    company, payroll_setup, hr_client
):
    """`is_verified` separates a figure somebody checked against the Finance Act
    from one that shipped as a default, and finalising a run on unverified
    numbers locks the period irreversibly.

    Blocked with no override: finalising has no undo, and an override would be
    taken every time by whoever is in a hurry, which on payroll day is
    everybody.
    """
    from core.calendars import fiscal_year_for
    from payroll.models import StatutoryRate
    from payroll.periods import period_window

    run = payroll_setup["run"]
    period_start, _end, _days = period_window(run)
    year = fiscal_year_for(period_start)
    StatutoryRate.objects.create(
        code="ssf_employee",
        fiscal_year=year,
        value=11,
        label="SSF employee contribution",
        is_verified=False,
    )
    run.status = PayrollRun.Status.COMPLETED
    run.save(update_fields=["status"])

    response = hr_client.post(f"/api/v1/payroll/runs/{run.id}/finalize/", {}, format="json")
    run.refresh_from_db()

    assert response.status_code == 409
    assert response.data["code"] == "statutory_unverified"
    # Named, not counted — "7 unverified figures" sends somebody hunting.
    assert any(f["code"] == "ssf_employee" for f in response.data["figures"])
    # And the period stayed open.
    assert run.locked_at is None


def test_verifying_the_figures_lets_the_run_close(company, payroll_setup, hr_client):
    """The other half, and the one that matters: a guard that cannot be
    satisfied is an outage, not a safeguard."""
    from core.calendars import fiscal_year_for
    from payroll.models import StatutoryRate
    from payroll.periods import period_window

    run = payroll_setup["run"]
    period_start, _end, _days = period_window(run)
    year = fiscal_year_for(period_start)
    rate = StatutoryRate.objects.create(
        code="ssf_employee",
        fiscal_year=year,
        value=11,
        label="SSF employee contribution",
        is_verified=False,
    )
    run.status = PayrollRun.Status.COMPLETED
    run.save(update_fields=["status"])

    blocked = hr_client.post(f"/api/v1/payroll/runs/{run.id}/finalize/", {}, format="json")
    assert blocked.status_code == 409, "guard must fire before we prove it lifts"

    rate.is_verified = True
    rate.save(update_fields=["is_verified"])

    response = hr_client.post(f"/api/v1/payroll/runs/{run.id}/finalize/", {}, format="json")
    run.refresh_from_db()

    assert response.status_code == 200, response.data
    assert run.locked_at is not None
