import logging
from datetime import date

from celery import chord, shared_task
from django.db.models import Q

from core.calendars import company_calendar
from employees.models import Employee
from notifications.services import notify
from payroll.models import PayrollError, PayrollRun, Payslip
from payroll.pdf import generate_payslip_pdf
from payroll.periods import period_window
from payroll.services import (
    PayrollConfigurationError,
    PayrollPeriodLockedError,
    apply_loan_repayments,
    compute_payslip,
)

logger = logging.getLogger(__name__)


def _employees_payable_in(payroll_run):
    """Everyone owed money for this period — active *during it*, not *now*.

    **B2, the half that `compute_proration` cannot fix on its own.** Selecting
    `employment_status=ACTIVE` asks who is employed at the moment the run
    happens, which is the wrong question: a person who left on the 10th and was
    marked RESIGNED on the 11th is not ACTIVE when payroll runs on the 30th, so
    they were dropped from the run entirely and paid **nothing** for the ten
    days they worked.

    The right question is who was employed *at any point in the period*. That is
    everyone currently active, plus anyone who left on or after the period
    started — their part-month is then prorated by `compute_proration`.

    Someone who left in an *earlier* period is still excluded, because their
    exit date precedes this period's start and the window closes empty.
    """
    from employees.models import LifecycleEvent

    # Through `period_window` (D‑06), never `date(period_year, period_month, 1)`.
    # On a Bikram Sambat run the latter is `date(2083, 5, 1)` — a valid
    # Gregorian date fifty-seven years out, which no leaver's exit date can
    # reach, so the "employed during the period" test silently degrades to
    # "active today".
    period_start, _period_end, _days = period_window(payroll_run)

    active = Q(employment_status=Employee.EmploymentStatus.ACTIVE)
    # A leaver whose last day falls on or after this period opened. Both date
    # fields are checked because `last_working_date` is optional and
    # `effective_date` is the fallback `get_exit_date` uses.
    left_during_or_after = Q(
        lifecycle_events__event_type__in=[
            LifecycleEvent.EventType.RESIGNATION,
            LifecycleEvent.EventType.TERMINATION,
        ],
        lifecycle_events__status__in=[
            LifecycleEvent.Status.APPROVED,
            LifecycleEvent.Status.APPLIED,
        ],
    ) & (
        Q(lifecycle_events__last_working_date__gte=period_start)
        | Q(lifecycle_events__last_working_date__isnull=True,
            lifecycle_events__effective_date__gte=period_start)
    )

    # distinct(): the lifecycle join multiplies rows for anyone with more than
    # one event, and a duplicated employee id is a duplicated payslip.
    return Employee.objects.filter(active | left_during_or_after).distinct()


@shared_task
def process_payslip(payroll_run_id, employee_id):
    """One employee's slice of a PayrollRun — kept as its own task so a
    single employee's failure (bad formula, missing structure) doesn't
    roll back or block the rest of the run.

    PDF rendering failure must NOT fail this task: the payslip's figures
    (compute_payslip, already committed) are the actual payroll result;
    the PDF is a rendering of them. Coupling the two means an
    environment-level PDF problem (e.g. WeasyPrint's native GTK/Pango
    libraries missing) would leave the whole run stuck at PROCESSING
    forever via the chord in run_payroll, even though every figure was
    computed correctly. Same principle as core.email.safe_send_mail:
    don't let a non-critical side effect break the critical path.
    """
    payroll_run = PayrollRun.objects.get(pk=payroll_run_id)
    employee = Employee.objects.get(pk=employee_id)
    try:
        payslip = compute_payslip(payroll_run, employee)
    except PayrollConfigurationError as exc:
        # Recorded against the employee rather than raised. Raising failed the
        # chord and left the whole run stuck at PROCESSING, which told HR
        # nothing about who failed or why — and surfaced only in Sentry, where
        # the person who can fix a salary structure is not looking.
        #
        # `finalize` refuses while any error is unresolved, so nothing is
        # silently reported as done; the run just says what went wrong.
        PayrollError.objects.update_or_create(
            payroll_run=payroll_run,
            employee=employee,
            defaults={
                "error_type": type(exc).__name__,
                "message": str(exc),
                # Re-running after a fix must clear the previous resolution,
                # or a stale "resolved" would let a still-broken run finalise.
                "resolved_at": None,
                "resolved_by": None,
            },
        )
        logger.warning(
            "Payroll error for employee %s in run %s: %s", employee_id, payroll_run_id, exc
        )
        return None
    except PayrollPeriodLockedError:
        # Not an error worth retrying or alerting on: this is the lock doing
        # its job. Celery delivers at least once, so a duplicate delivery
        # arriving after the run was finalised lands here, and the correct
        # outcome is that nothing happens. Logged at info because a *storm* of
        # these would still be worth noticing.
        logger.info(
            "Skipped payslip for employee %s — payroll run %s is locked.",
            employee_id,
            payroll_run_id,
        )
        return None

    # This employee computed cleanly, so any error from a previous attempt is
    # stale. Leaving it would block `finalize` forever after a fix — the run
    # would be correct and still refuse to close.
    PayrollError.objects.filter(payroll_run=payroll_run, employee=employee).delete()

    apply_loan_repayments(payslip)
    try:
        generate_payslip_pdf(payslip)
    except Exception:
        logger.exception(
            "Payslip PDF generation failed for payslip %s — figures are still computed; "
            "retry via PayslipViewSet.regenerate_pdf.",
            payslip.id,
        )
    return payslip.id


@shared_task
def finalize_payroll_run(payroll_run_id):
    """Chord callback: fires once every process_payslip task has returned.
    Derives the run's totals and marks it COMPLETED so HR can review.

    **Runs whether or not every employee succeeded.** Requiring all of them
    leaves the run stuck at PROCESSING when one person has a bad structure,
    which tells HR nothing: not who failed, not why, not whether the other 199
    payslips are fine. Reporting a partial run as simply "done" would be worse
    still, so neither is the answer.

    A per-employee failure is recorded as a `PayrollError` and the task
    returns, so the chord completes and the run reports what happened.
    "Completed" here means *computed*, not *approved*: `finalize` refuses while
    any error is unresolved, so a partial run still cannot be paid."""
    payroll_run = PayrollRun.objects.get(pk=payroll_run_id)
    # Totals are derived here, once, rather than incrementally per payslip:
    # the batch is finished, so this is the only moment they can be both
    # complete and consistent with what was actually written.
    payroll_run.recalculate_totals(save=False)
    payroll_run.status = PayrollRun.Status.COMPLETED
    payroll_run.save(update_fields=[
        "status", "total_gross", "total_deductions", "total_net",
        "payslip_count", "updated_at",
    ])
    error_count = payroll_run.errors.filter(resolved_at__isnull=True).count()
    return f"payroll run {payroll_run_id} completed with {error_count} error(s)"


@shared_task
def run_payroll(payroll_run_id):
    payroll_run = PayrollRun.objects.get(pk=payroll_run_id)
    payroll_run.status = PayrollRun.Status.PROCESSING
    payroll_run.save(update_fields=["status", "updated_at"])

    employee_ids = list(_employees_payable_in(payroll_run).values_list("id", flat=True))
    if not employee_ids:
        payroll_run.status = PayrollRun.Status.COMPLETED
        payroll_run.save(update_fields=["status", "updated_at"])
        return "no active employees, nothing to process"

    header = [process_payslip.si(payroll_run_id, employee_id) for employee_id in employee_ids]
    chord(header)(finalize_payroll_run.si(payroll_run_id))
    return f"dispatched {len(employee_ids)} payslip task(s)"


@shared_task
def create_monthly_draft_run():
    """Auto-creates a DRAFT PayrollRun for the just-completed month — draft
    only, per docs/development-plan.md ("review required before disbursement"). HR
    must explicitly call the run's `run` action to trigger computation."""
    # "The month that just ended" is a question for the company's calendar, not
    # for `timedelta` (D‑06). A company on Bikram Sambat closes Shrawan on
    # 16 August, so on 17 August the Gregorian answer — July — is a month they
    # already paid, and the one they are waiting for goes uncreated.
    calendar = company_calendar()
    this_period = calendar.from_gregorian(date.today())
    period_year, period_month = this_period.year, this_period.month - 1
    if period_month == 0:
        period_year, period_month = period_year - 1, 12

    run, created = PayrollRun.objects.get_or_create(
        period_calendar=calendar.key,
        period_year=period_year,
        period_month=period_month,
        defaults={"status": PayrollRun.Status.DRAFT},
    )
    label = f"{calendar.month_name(period_month)} {period_year}"
    if created:
        from accounts.policy import Perm, users_with

        for admin in users_with(Perm.PAYROLL_RUN):
            notify(
                admin,
                "payroll_draft_created",
                f"A draft payroll run for {label} is ready for review.",
                email_subject="Payroll draft ready for review",
            )
    return f"draft run {'created' if created else 'already existed'} for {label}"



@shared_task
def regenerate_payslip_pdf(payslip_id):
    payslip = Payslip.objects.get(pk=payslip_id)
    generate_payslip_pdf(payslip)
    return f"regenerated PDF for payslip {payslip_id}"


@shared_task
def notify_payslip_finalized(payslip_id):
    payslip = Payslip.objects.select_related("employee__user", "payroll_run").get(pk=payslip_id)
    notify(
        payslip.employee.user,
        "payslip_finalized",
        f"Your payslip for {payslip.payroll_run.period_label} is ready.",
        email_subject="Your payslip is ready",
    )
