"""B2 and B3 — the two ways a payslip could be confidently wrong.

Both bugs shared a failure mode worth naming: they produced a **finished-looking
payslip with a wrong number on it**. No exception, no warning, nothing for a
reviewer to notice. That is the only category of payroll bug that reaches a bank
transfer, so these tests assert the loud behaviour rather than the arithmetic
alone.
"""

from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from employees.models import LifecycleEvent
from payroll.models import PayrollRun, SalaryComponent
from payroll.services import (
    PayrollConfigurationError,
    compute_payslip,
    compute_proration,
    get_exit_date,
)
from payroll.tasks import _employees_payable_in

pytestmark = pytest.mark.django_db


def _leave_on(employee, last_day, *, status=LifecycleEvent.Status.APPROVED,
              event_type=LifecycleEvent.EventType.RESIGNATION):
    return LifecycleEvent.objects.create(
        employee=employee,
        event_type=event_type,
        status=status,
        effective_date=last_day,
        last_working_date=last_day,
    )


# ── B2 · the exit date closes the payable window ─────────────────────────


def test_a_leaver_is_paid_to_their_last_day_not_the_whole_month(company, payroll_setup):
    """The bug as originally reported: full month for a part month.

    August has 31 days. Leaving on the 10th is 10 payable days, not 31.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    structure = emp.salary_structures.latest("effective_from")
    _leave_on(emp, date(2026, 8, 10))

    factor, period_days, payable_days = compute_proration(run, emp, structure)

    assert period_days == 31
    assert payable_days == 10
    assert factor == Decimal(10) / Decimal(31)


def test_someone_still_employed_is_unaffected(company, payroll_setup):
    """A guard that fires on everyone is not a guard."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    structure = emp.salary_structures.latest("effective_from")
    factor, _, payable_days = compute_proration(run, emp, structure)

    assert payable_days == 31
    assert factor == Decimal("1")


def test_a_pending_resignation_does_not_stop_anyones_pay(company, payroll_setup):
    """A request is not a fact.

    Someone who has *asked* to leave is still owed a full month until the
    request is approved. Reading un-approved events would let anyone reduce
    their own colleague's pay by filing a form.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    structure = emp.salary_structures.latest("effective_from")
    _leave_on(emp, date(2026, 8, 10), status=LifecycleEvent.Status.PENDING_APPROVAL)

    _, _, payable_days = compute_proration(run, emp, structure)

    assert payable_days == 31


def test_leaving_after_the_period_ends_pays_the_full_month(company, payroll_setup):
    """An exit date in a later month must not shorten this one."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    structure = emp.salary_structures.latest("effective_from")
    _leave_on(emp, date(2026, 11, 30))

    _, _, payable_days = compute_proration(run, emp, structure)

    assert payable_days == 31


def test_the_last_working_date_wins_over_the_effective_date(company, payroll_setup):
    """For a termination with notice the two differ, and payroll owes money
    up to the last day actually worked."""
    emp = payroll_setup["emp"]
    LifecycleEvent.objects.create(
        employee=emp,
        event_type=LifecycleEvent.EventType.TERMINATION,
        status=LifecycleEvent.Status.APPROVED,
        effective_date=date(2026, 8, 1),
        last_working_date=date(2026, 8, 20),
    )
    assert get_exit_date(emp) == date(2026, 8, 20)


# ── B2 · the other direction — the leaver must still be *in* the run ─────


def test_a_leaver_marked_resigned_is_still_paid_for_the_days_they_worked(
    company, payroll_setup
):
    """The worse half of B2, and the one the original report missed.

    Selecting `employment_status=ACTIVE` asks who is employed *now*. Someone who
    left on the 10th and was marked RESIGNED on the 11th is not ACTIVE when the
    run happens on the 30th — so they were dropped from the run entirely and
    paid **nothing** for ten days of work. That is unpaid wages, not a rounding
    error.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    _leave_on(emp, date(2026, 8, 10))
    emp.employment_status = emp.EmploymentStatus.RESIGNED
    emp.save(update_fields=["employment_status"])

    payable = list(_employees_payable_in(run).values_list("id", flat=True))

    assert emp.id in payable


def test_someone_who_left_in_an_earlier_period_is_not_in_the_run(company, payroll_setup):
    """The selection has to widen without becoming 'everyone who ever worked
    here' — a former employee must not reappear on a payslip months later."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    _leave_on(emp, date(2026, 5, 31))
    emp.employment_status = emp.EmploymentStatus.RESIGNED
    emp.save(update_fields=["employment_status"])

    payable = list(_employees_payable_in(run).values_list("id", flat=True))

    assert emp.id not in payable


def test_an_employee_with_several_events_is_listed_once(company, payroll_setup):
    """The lifecycle join multiplies rows, and a duplicated id is a duplicated
    payslip — which is a real second payment, not a display bug."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    LifecycleEvent.objects.create(
        employee=emp, event_type=LifecycleEvent.EventType.PROMOTION,
        status=LifecycleEvent.Status.APPLIED, effective_date=date(2026, 3, 1),
    )
    _leave_on(emp, date(2026, 8, 10))

    payable = list(_employees_payable_in(run).values_list("id", flat=True))

    assert payable.count(emp.id) == 1


# ── B3 · an unresolved percentage base must raise ────────────────────────


def test_a_percentage_component_with_no_base_raises(company, payroll_setup, admin_user):
    """Raises rather than paying zero.

    `context.get(None, 0)` is a lookup that can never hit, so a defaulting read
    lets the component contribute nothing to a payslip that looks finished.
    """
    emp = payroll_setup["emp"]
    orphan = SalaryComponent.objects.create(
        code="bonus_pct", name="Bonus %",
        component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.PERCENTAGE_OF,
        percentage_of=None, amount=Decimal("10"), is_active=True, order=9,
    )
    structure = emp.salary_structures.latest("effective_from")
    structure.assignments.create(component=orphan, amount=Decimal("10"))

    run = PayrollRun.objects.create(
        period_calendar="AD", period_year=2026, period_month=9,
        status=PayrollRun.Status.DRAFT, created_by=admin_user,
    )
    with pytest.raises(PayrollConfigurationError, match="no base component"):
        compute_payslip(run, emp)


def test_a_percentage_of_a_component_calculated_later_raises(company, payroll_setup, admin_user):
    """Ordering *is* the dependency graph.

    Percentage-of reads the running context, so a base with a higher `order`
    has not been computed yet. That used to resolve to zero rather than
    complain, making a misordered structure indistinguishable from a correct
    one paying nothing.
    """
    emp = payroll_setup["emp"]
    late_base = SalaryComponent.objects.create(
        code="late_base", name="Late base",
        component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.FLAT,
        amount=Decimal("1000"), is_active=True, order=20,
    )
    too_early = SalaryComponent.objects.create(
        code="too_early", name="Too early",
        component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.PERCENTAGE_OF,
        percentage_of=late_base, amount=Decimal("10"), is_active=True, order=10,
    )
    structure = emp.salary_structures.latest("effective_from")
    structure.assignments.create(component=late_base, amount=Decimal("1000"))
    structure.assignments.create(component=too_early, amount=Decimal("10"))

    run = PayrollRun.objects.create(
        period_calendar="AD", period_year=2026, period_month=10,
        status=PayrollRun.Status.DRAFT, created_by=admin_user,
    )
    with pytest.raises(PayrollConfigurationError, match="has not been calculated yet"):
        compute_payslip(run, emp)


def test_a_correctly_ordered_percentage_still_works(company, payroll_setup):
    """The fixture's HRA is 40% of basic, ordered after it.

    Without this, the two tests above would pass just as well against a change
    that broke percentage-of entirely.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    payslip = compute_payslip(run, emp)
    hra = payslip.line_items.get(component_code="hra")

    assert hra.amount == Decimal("20000.00")  # 40% of 50,000, full month


# ── Period lock ──────────────────────────────────────────────────────────
#
# The viewsets already refuse to re-run a non-draft run. These cover the paths
# that do not go through a viewset, which is where the money actually is: a
# re-delivered Celery task, a management command, a retry.


def test_a_locked_run_cannot_be_recomputed(company, payroll_setup):
    """The lock is checked before anything is destroyed.

    `compute_payslip` deletes every line item before recomputing, so a guard
    that ran afterwards would be checking a payslip it had already emptied.
    """
    from payroll.services import PayrollPeriodLockedError

    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)
    run.locked_at = timezone.now()
    run.save(update_fields=["locked_at"])

    with pytest.raises(PayrollPeriodLockedError, match="is locked"):
        compute_payslip(run, emp)


def test_a_locked_run_keeps_its_figures(company, payroll_setup):
    """The point of the lock, stated as money rather than as an exception.

    A recompute after finalisation would use *today's* attendance and salary
    data, not what the run was approved on.
    """
    from payroll.services import PayrollPeriodLockedError

    emp, run = payroll_setup["emp"], payroll_setup["run"]
    original = compute_payslip(run, emp).net_pay
    run.locked_at = timezone.now()
    run.save(update_fields=["locked_at"])

    with pytest.raises(PayrollPeriodLockedError):
        compute_payslip(run, emp)

    run.refresh_from_db()
    assert run.payslips.get(employee=emp).net_pay == original


def test_a_paid_payslip_cannot_be_recomputed_even_on_an_unlocked_run(company, payroll_setup):
    """Belt and braces, and not hypothetical.

    A run can be reopened while an individual payslip has already been marked
    paid. Recomputing that one restates money the employee has received.
    """
    from payroll.models import Payslip
    from payroll.services import PayrollPeriodLockedError

    emp, run = payroll_setup["emp"], payroll_setup["run"]
    payslip = compute_payslip(run, emp)
    payslip.status = Payslip.Status.PAID
    payslip.save(update_fields=["status"])

    assert not run.is_locked
    with pytest.raises(PayrollPeriodLockedError, match="cannot be recomputed"):
        compute_payslip(run, emp)


def test_a_draft_payslip_on_an_unlocked_run_still_recomputes(company, payroll_setup):
    """A lock that never lets go is not a lock.

    Re-running a draft is the normal correction workflow — HR fixes a
    structure and runs the period again before finalising.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    first = compute_payslip(run, emp)
    assert first.status == "draft"
    second = compute_payslip(run, emp)  # must not raise

    assert second.id == first.id


def test_the_locked_task_skips_quietly_rather_than_failing_the_worker(company, payroll_setup):
    """A duplicate Celery delivery after finalisation is not an error.

    Celery delivers at least once. If the lock propagated out of the task, a
    perfectly normal re-delivery would show up as a failed payroll task and
    send someone looking for a problem that does not exist.
    """
    from payroll.tasks import process_payslip

    emp, run = payroll_setup["emp"], payroll_setup["run"]
    compute_payslip(run, emp)
    run.locked_at = timezone.now()
    run.save(update_fields=["locked_at"])

    assert process_payslip(run.id, emp.id) is None
