from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone
from simpleeval import NameNotDefined, simple_eval

from attendance.payroll_summary import get_period_attendance
from core.calendars import company_calendar
from payroll.models import (
    Loan,
    Payslip,
    PayslipLineItem,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureAssignment,
    TaxSlab,
)
from payroll.periods import period_window
from payroll.schemes import (
    SCHEME_LABELS,
    SchemeError,
    company_schemes,
    contributions_for,
    record_contributions,
)
from payroll.statutory import RateCode, get_rate
from payroll.tax import period_income_tax


class PayrollPeriodLockedError(Exception):
    """An attempt to recompute a payslip that is no longer open to change.

    Raised at the **service** layer on purpose. The viewsets already refuse to
    re-run a non-draft run, but that only guards the one path a human clicks.
    `compute_payslip` deletes every line item before recomputing, so anything
    that reaches it — a re-delivered Celery task, a management command, a retry,
    a future feature — could otherwise rewrite a finalised or paid payslip with
    today's data. The guard belongs where the destruction happens.
    """


class PayrollConfigurationError(Exception):
    """A salary structure that cannot be evaluated as configured.

    Separate from a validation error because it surfaces at **run** time, not at
    save time: a structure can be saved perfectly well and only become
    unevaluable once a run reaches it. Raising is the whole point — the
    alternative these replaced was a silently wrong figure on a finished-looking
    payslip, which is the one failure mode payroll must never have.
    """


LOAN_REPAYMENT_COMPONENT_CODE = "loan_repayment"

TWO_PLACES = Decimal("0.01")


def _quantize(value):
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def get_active_structure(employee, on_date):
    """The structure effective on `on_date` — the latest one whose
    effective_from doesn't come after it. Structures are never edited in
    place, so this always resolves to whatever was true historically."""
    return (
        SalaryStructure.objects.filter(employee=employee, effective_from__lte=on_date)
        .order_by("-effective_from")
        .first()
    )


def compute_slab_tax(
    taxable_amount,
    fiscal_year,
    taxpayer=TaxSlab.Taxpayer.INDIVIDUAL,
    retirement_contributor=False,
):
    """Progressive slab tax: each slab only taxes the portion of income
    that falls within its own band, not the whole amount at that band's
    rate. Slabs are ordered and contiguous by convention (order 1 starts
    at 0); `max_amount=None` means the top, open-ended slab.

    Two dimensions beyond the amount, both of which change the answer:

    `taxpayer` selects the rate table. Nepal's Income Tax Act sets different
    band widths for an individual and for a couple electing joint assessment,
    so "the slabs for this year" is not a single set — filtering without it
    would silently mix both tables together and tax the same rupee twice.

    `retirement_contributor` waives any band flagged
    `waived_if_retirement_contributor`. Nepal's lowest band is a social security
    tax rather than income tax and is not charged to an employee already
    contributing to a recognised fund (SSF/PF). The band still has to be
    *traversed* — the income in it is consumed, so the bands above it start at
    the right place — it simply is not charged. Skipping the slab entirely
    instead would shift every band above it downward and overtax everyone.
    """
    slabs = list(
        TaxSlab.objects.filter(fiscal_year=fiscal_year, taxpayer=taxpayer).order_by("order")
    )
    if not slabs:
        # Refuses rather than returning zero. A run that taxes nobody looks
        # exactly like a correct run: nothing downstream can tell, the money
        # leaves, and the shortfall surfaces at filing time as the company's
        # liability. Failing open here would make a configuration gap
        # indistinguishable from a company that owes no tax.
        #
        # The ordinary way in is a fiscal year rolling over before anybody
        # enters next year's bands, so this is a routine state, not an exotic
        # one.
        #
        # `PayrollConfigurationError` is where "this payslip cannot be
        # computed" belongs: it is recorded against the employee as a
        # `PayrollError` and blocks `finalize`, so the run stops and names the
        # problem instead of reporting a clean total.
        raise PayrollConfigurationError(
            f"No tax slabs are configured for fiscal year {fiscal_year} "
            f"({taxpayer}). Income tax cannot be computed for this period — add "
            f"the bands under Payroll → Tax slabs, or remove the slab-based "
            f"component if this company does not deduct tax at source."
        )
    remaining = Decimal(taxable_amount)
    tax = Decimal("0")
    lower = Decimal("0")
    for slab in slabs:
        if remaining <= 0:
            break
        band_top = slab.max_amount if slab.max_amount is not None else lower + remaining
        band = min(band_top - lower, remaining)
        if band > 0:
            waived = retirement_contributor and slab.waived_if_retirement_contributor
            if not waived:
                tax += band * (slab.rate / Decimal("100"))
            # Consumed either way — see the docstring.
            remaining -= band
        lower = band_top
    return tax


def _eval_formula(formula, context, component_code=""):
    """Evaluate a component's formula against the components computed so far.

    **Failures are translated, and that is the point (D‑12).** Both calc types
    already refuse an unresolved base rather than paying zero — but they refused
    in different currencies. `PERCENTAGE_OF` raises `PayrollConfigurationError`,
    which `compute_employee_payslip` catches and records against the employee,
    so the run reports who failed and `finalize` blocks until it is fixed. A
    formula raised `simpleeval`'s own `NameNotDefined`, which that handler does
    not catch — so it escaped the task, failed the chord, and left the whole run
    stuck at PROCESSING with the reason visible only in Sentry, where the person
    who can fix a salary structure is not looking.

    That is the same failure the comment beside the handler says was fixed, and
    it was still live down this path. Failing loudly is not enough on its own;
    it has to fail somewhere the right person is looking.
    """
    numeric_context = {code: float(value) for code, value in context.items()}
    try:
        result = simple_eval(formula, names=numeric_context)
    except NameNotDefined as exc:
        # `exc.name` is the identifier simpleeval could not resolve, which is
        # exactly the component somebody needs to look at.
        missing = getattr(exc, "name", None) or "a component"
        raise PayrollConfigurationError(
            f"Component '{component_code}' has formula “{formula}”, which refers to "
            f"'{missing}' — that is either not a component on this structure, or "
            f"has a higher `order` so it has not been calculated yet."
        ) from exc
    # **Nothing else is caught, deliberately.** The first version of this wrapped
    # every exception, which broke the sandbox tests and deserved to: simpleeval
    # also raises for `__class__` access, `__import__`, exponentiation bombs and
    # string-multiplication bombs. Those are the sandbox refusing an attack, not
    # a finance lead mistyping a component name.
    #
    # Flattening them into "could not evaluate" would file an attempted escape
    # as a configuration hint, hand its text to HR as advice, and mark the run
    # merely unfinished rather than compromised. A security refusal has to stay
    # distinguishable from a typo, so those propagate untouched.
    return _quantize(Decimal(str(result)))


def _night_allowance_rate(employee, payroll_run):
    """The per-night amount for whichever night shift the employee was on.

    Returns 0 when they were not on one, so a formula referencing
    `night_allowance` is safe for every employee rather than only the ones
    working nights — a formula that raises for day staff would make the
    component unusable company-wide.
    """
    from attendance.models import ShiftAssignment

    period_start, period_end, period_days = period_window(payroll_run)

    assignment = (
        ShiftAssignment.objects.filter(
            employee=employee, shift__is_night_shift=True, start_date__lte=period_end
        )
        .exclude(end_date__lt=period_start)
        .select_related("shift")
        .order_by("-start_date")
        .first()
    )
    return assignment.shift.night_allowance if assignment else Decimal("0")


def get_exit_date(employee):
    """The employee's last working day, or None if they have not left.

    Read from the approved resignation/termination `LifecycleEvent` rather than
    from a field on `Employee`, because that is where the date already lives and
    where it has been through approval. `last_working_date` is preferred over
    `effective_date`: for a termination with notice they are different dates,
    and the one payroll owes money up to is the last day actually worked.

    Only APPROVED and APPLIED events count. A pending resignation is a request,
    not a fact, and must not stop anybody's salary.
    """
    from employees.models import LifecycleEvent

    event = (
        LifecycleEvent.objects.filter(
            employee=employee,
            event_type__in=[
                LifecycleEvent.EventType.RESIGNATION,
                LifecycleEvent.EventType.TERMINATION,
            ],
            status__in=[LifecycleEvent.Status.APPROVED, LifecycleEvent.Status.APPLIED],
        )
        .order_by("effective_date")
        .first()
    )
    if event is None:
        return None
    return event.last_working_date or event.effective_date


def compute_proration(payroll_run, employee, structure):
    """How much of the month `employee` is actually payable, by calendar
    days. Returns (factor, period_days, payable_days).

    The payable window starts on the latest of (month start,
    structure.effective_from, date_joined) and ends on the earliest of
    (month end, exit date). So a structure effective on the 31st of a
    31-day month pays 1/31, a mid-month joiner pays from their join date,
    and a mid-month leaver pays to their last working day. `factor` is
    capped to [0, 1].

    **The window closes on the exit date, not on month end.** Employment
    status cannot stand in for it, because it gives the wrong answer in both
    directions: a person who left on the 10th is still ACTIVE until somebody
    updates the record, and draws the whole month; once it is updated they are
    excluded altogether and draw nothing — including for the days they did
    work, which is unpaid wages rather than a rounding error.

    This half only holds because `run_payroll` selects anyone active *during
    the period* rather than anyone active *today*. The two are correct only
    together.
    """
    period_start, period_end, period_days = period_window(payroll_run)

    window_start = max(period_start, structure.effective_from, employee.date_joined)

    exit_date = get_exit_date(employee)
    window_end = min(period_end, exit_date) if exit_date else period_end

    payable_days = (window_end - window_start).days + 1
    payable_days = max(0, min(payable_days, period_days))
    factor = Decimal(payable_days) / Decimal(period_days)
    return factor, period_days, payable_days


def _lateness_penalty(late_days):
    """Days of pay lost to lateness, per the company's rule.

    Silent when no policy row exists, matching how the rest of the attendance
    policy treats absence of configuration — a company who has never opened the
    screen keeps computing exactly what they computed before.
    """
    from attendance.policy import AttendancePolicy

    policy = AttendancePolicy.objects.first()
    if policy is None:
        return Decimal("0")
    return policy.lateness_penalty_days(late_days)


def _basic_for(structure):
    """The `basic` assignment on a structure, or zero.

    **Contributions are a percentage of basic, never of gross** — every row of
    the statutory rate registry says so, and passing gross would silently
    inflate every contribution by the allowances. Read from the structure
    rather than from the running context because contributions are needed
    *before* the component loop: tax depends on them.

    Falls back to zero rather than raising: a structure with no component coded
    `basic` is a company who named theirs something else, and refusing to run
    payroll over a naming choice would be worse than contributing nothing —
    which is also what happens today, so it is not a regression.
    """
    for assignment in structure.assignments.select_related("component"):
        if assignment.component.code == "basic":
            return assignment.amount or assignment.component.amount or Decimal("0")
    return Decimal("0")


@transaction.atomic
def compute_payslip(payroll_run, employee):
    """Recomputes (or first-computes) one employee's payslip for a run.
    Idempotent by design — reruns (e.g. after fixing a salary structure)
    replace all line items rather than appending duplicates."""
    period_start, period_end, period_days = period_window(payroll_run)
    structure = get_active_structure(employee, period_end)

    # Two locks, checked before anything is destroyed. `update_or_create` below
    # resets the status to DRAFT and the next line deletes every line item, so
    # by the time either has run the evidence is already gone.
    if payroll_run.is_locked:
        raise PayrollPeriodLockedError(
            f"Payroll period {payroll_run.period_label} "
            f"is locked and cannot be recomputed."
        )

    # Belt and braces: a run can be unlocked while an individual payslip has
    # already been finalised or paid. Recomputing that one would restate money
    # the employee has received, using data that has moved on since.
    existing = Payslip.objects.filter(payroll_run=payroll_run, employee=employee).first()
    if existing is not None and existing.status != Payslip.Status.DRAFT:
        raise PayrollPeriodLockedError(
            f"Payslip for {employee.employee_code} is "
            f"{existing.get_status_display().lower()} and cannot be recomputed."
        )

    payslip, _ = Payslip.objects.update_or_create(
        payroll_run=payroll_run,
        employee=employee,
        defaults={"status": Payslip.Status.DRAFT},
    )
    payslip.line_items.all().delete()

    if structure is None:
        payslip.gross_earnings = Decimal("0")
        payslip.total_deductions = Decimal("0")
        payslip.net_pay = Decimal("0")
        payslip.period_days = period_days
        payslip.payable_days = 0
        payslip.unpaid_days = Decimal("0")
        payslip.day_value = Decimal("0")
        payslip.absence_deduction = Decimal("0")
        payslip.save(update_fields=[
            "gross_earnings", "total_deductions", "net_pay",
            "period_days", "payable_days",
            "unpaid_days", "day_value", "absence_deduction",
            "status", "updated_at",
        ])
        return payslip

    # Proration factor for the month. FLAT earnings are scaled by it;
    # percentage/formula/slab components read from `context` and so scale
    # automatically. FLAT deductions (loans, fixed obligations) are left
    # whole on purpose — a shortened month doesn't shrink a fixed debt.
    from organization.models import CompanyProfile

    company = CompanyProfile.get_solo()
    if company.payroll_prorate:
        factor, period_days, payable_days = compute_proration(payroll_run, employee, structure)
    else:
        factor, payable_days = Decimal("1"), period_days

    # B1. What attendance says about this period, as a single read.
    #
    # This is *multiplicative with* `factor`, not a replacement for it: the two
    # answer different questions. `factor` is how much of the month the employee
    # was employed at all (join date, exit date, structure start); absence is
    # how much of that employment they were actually paid for. Someone who
    # joined on the 15th and then took three days of unpaid leave has both
    # applied, and collapsing them into one number would lose that.
    # ── What one day of pay is worth ─────────────────────────────────────
    #
    # Two bases, and the company chooses (`CompanyProfile.pay_basis`). Both are
    # in real use and neither is derivable — which one a company means is a term
    # of employment, so the engine reads it rather than deciding.
    #
    #   calendar      — divide by the days in the month. The salary covers the
    #                   whole month including weekends, so a day off costs
    #                   1/30. Weekends cost nothing because they were never
    #                   counted as working in the first place.
    #   working_days  — divide by the days the company works. The salary buys
    #                   those 22 days, so one missed costs 1/22 — a bigger
    #                   deduction for the same absence, deliberately.
    #
    # **Only the divisor changes.** Which days are *charged* does not: a day the
    # company does not work cannot be a day of work missed, and that is true
    # however you value a day. So weekends and public holidays are never
    # charged on either basis, and the two settings differ solely in what one
    # missed day is worth.
    #
    # The alternative — charging calendar days on the calendar basis — priced
    # the same absence differently depending on how the request was written.
    # Friday off and Monday off as two requests cost 2/31; the same two days
    # as one "Friday to Monday" request cost 4/31, because the weekend fell
    # inside the span. Identical work missed, different pay, decided by
    # paperwork. It also charged people for public holidays.
    on_working_basis = company.pay_basis == CompanyProfile.PayBasis.WORKING_DAYS
    attendance = get_period_attendance(
        employee, period_start, period_end, working_only=True
    )
    basis_days = attendance.working_days if on_working_basis else period_days

    if basis_days <= 0:
        # A period with no working days at all — a shutdown month, or a
        # working week nobody configured sensibly. Nothing can be priced per
        # day, so nothing is deducted; the alternative is a division by zero
        # that takes payroll down for everybody.
        unpaid_days = Decimal("0")
        attendance_factor = Decimal("1")
    else:
        # D‑05. Lateness becomes money only where a company has said it should
        # and said by how much — the rule ships off, because inventing a default
        # would dock pay under something nobody agreed to.
        #
        # Added to unpaid days rather than deducted separately so it is priced
        # by the same `day_value` as every other absence: two ways of valuing a
        # day is how a payslip stops adding up.
        lateness_days = _lateness_penalty(attendance.late_days)
        unpaid_days = min(
            attendance.unpaid_days + lateness_days, Decimal(basis_days)
        )
        attendance_factor = (Decimal(basis_days) - unpaid_days) / Decimal(basis_days)

    # Statutory rates are effective-dated by fiscal year, so the lookup needs
    # to know which fiscal year this period falls in — and *whose* fiscal
    # year. This read "BS" until 18 Aug, which is the hardcoded Nepal rule
    # §2.3 names this file over: a company on a January–December year had
    # their rates looked up against a year they do not use.
    calendar = company_calendar()
    fiscal_year = calendar.fiscal_year_of(period_end)

    # Everything attendance knows, exposed to formula components by name, so a
    # company writes their own overtime and night-shift rules as data rather
    # than waiting for us to ship a component type for each. This is the same
    # argument as TaxSlab: the engine supplies figures, the company supplies
    # policy.
    context = {
        "period_days": Decimal(period_days),
        # The divisor actually used, so a company writing their own formula can
        # price a day the same way the engine did rather than assuming one.
        "basis_days": Decimal(basis_days),
        "working_days": Decimal(attendance.working_days),
        "payable_days": Decimal(payable_days),
        "absent_days": attendance.absent_days,
        "half_days": attendance.half_days,
        "late_days": attendance.late_days,
        "paid_leave_days": attendance.paid_leave_days,
        "unpaid_leave_days": attendance.unpaid_leave_days,
        "unpaid_days": unpaid_days,
        "overtime_hours": attendance.overtime_hours,
        # From the statutory rate table, not `CompanyProfile`: every other
        # legislated figure lives there and is effective-dated, and a rate in
        # two places is a rate that can disagree with itself. Falls back to the
        # profile's value so a company seeded before the table existed keeps
        # computing the same overtime.
        "overtime_multiplier": get_rate(
            RateCode.OVERTIME_MULTIPLIER, fiscal_year, default=company.overtime_multiplier
        ),
        "night_shifts": Decimal(attendance.night_shifts),
        "night_allowance": _night_allowance_rate(employee, payroll_run),
    }
    # ── Scheme contributions, computed before the loop ───────────────────
    #
    # Tax depends on these — the employee side relieves taxable income — so
    # they cannot be worked out after the components have been priced.
    #
    # The base is **basic**, not gross: every row of the rate registry says so,
    # and it is the single easiest figure to get wrong here. Basic comes from
    # the structure rather than from `context`, because `context` is not
    # populated until the loop below runs.
    try:
        scheme_rows = contributions_for(
            employee, _basic_for(structure), fiscal_year, profile=company
        )
    except SchemeError as exc:
        # Translated rather than allowed to escape — the D‑12 lesson. A refusal
        # the task's handler does not recognise fails the chord and leaves the
        # run stuck at PROCESSING with the reason only in Sentry, where the
        # person who can retire a duplicate component is not looking. As a
        # `PayrollConfigurationError` it lands in the run's error list against
        # this employee, and `finalize` refuses while it stands.
        raise PayrollConfigurationError(str(exc)) from exc
    scheme_config = company_schemes(company)
    #: Employee side only. The employer's share is not the employee's income,
    #: so it neither reduces net pay nor earns relief.
    employee_contribution = sum(
        (row["employee_amount"] for row in scheme_rows), Decimal("0")
    )

    gross = Decimal("0")
    deductions = Decimal("0")
    #: Earnings the company marked taxable. Kept separate from `gross` because
    #: they are different questions, and conflating them is what made the
    #: `taxable` flag decorative.
    taxable_earnings = Decimal("0")
    line_items = []
    #: What the absence-reducible earnings would have come to with nobody
    #: absent. Kept so the payslip can *show* its arithmetic — "62,500 ÷ 22
    #: working days × 1 unpaid day = 2,840 deducted" — rather than presenting a
    #: net figure and asking somebody to trust it. A deduction nobody can
    #: reproduce is the one that generates the email to HR.
    reducible_full = Decimal("0")

    assignments = (
        structure.assignments.select_related("component", "component__percentage_of")
        .filter(component__is_active=True)
        .order_by("component__order")
    )
    for assignment in assignments:
        component = assignment.component
        if component.calc_type == SalaryComponent.CalcType.FLAT:
            value = assignment.amount if assignment.amount is not None else component.amount
            # Prorate flat *earnings* by days payable; flat deductions stay whole.
            if component.component_type == SalaryComponent.ComponentType.EARNING:
                value = value * factor
                # Absence reduces only components the company marked. Basic
                # usually is; a fixed transport allowance usually is not. The
                # flag defaults off, so a structure written before this existed
                # keeps paying exactly what it paid.
                if component.reduced_by_absence:
                    reducible_full += value
                    value = value * attendance_factor
        elif component.calc_type == SalaryComponent.CalcType.PERCENTAGE_OF:
            rate = assignment.amount if assignment.amount is not None else component.amount
            base_code = component.percentage_of.code if component.percentage_of else None
            # Both ways of failing to resolve a base raise rather than
            # defaulting to zero. A zero here is a payslip that looks finished
            # and is wrong, and nothing downstream can tell it from a component
            # that genuinely evaluates to nothing.
            #
            #   - No base configured at all, so `base_code` is None.
            #   - A base that exists but has not been computed yet, because
            #     `component.order` puts it after this one. Percentage-of reads
            #     the running context, so ordering *is* the dependency graph.
            if base_code is None:
                raise PayrollConfigurationError(
                    f"Component '{component.code}' is percentage-of but has no base component set."
                )
            if base_code not in context:
                raise PayrollConfigurationError(
                    f"Component '{component.code}' is a percentage of '{base_code}', "
                    f"which has not been calculated yet — give '{base_code}' a lower "
                    f"`order` than '{component.code}'."
                )
            base_value = context[base_code]
            value = base_value * (rate / Decimal("100"))
        elif component.calc_type == SalaryComponent.CalcType.FORMULA:
            value = _eval_formula(component.formula, context, component.code)
        else:  # SLAB_BASED
            # Annualised, because the bands are annual figures. Applying
            # them to one month's pay under-deducts by roughly three quarters
            # — see `payroll/tax.py`.
            #
            # The base is *taxable* earnings rather than gross, which is what
            # gives `SalaryComponent.taxable` its effect.
            value = period_income_tax(
                taxable_earnings,
                fiscal_year,
                period_contribution=employee_contribution,
                scheme=scheme_config["retirement"],
                taxpayer=employee.tax_election or None,
            )

        value = _quantize(value)
        context[component.code] = value

        line_items.append(
            PayslipLineItem(
                payslip=payslip,
                component=component,
                component_code=component.code,
                component_name=component.name,
                component_type=component.component_type,
                amount=value,
            )
        )
        if component.component_type == SalaryComponent.ComponentType.EARNING:
            gross += value
            # **`taxable` finally means something.** The flag has been on the
            # model since the beginning, the seed sets it, and no code read it —
            # so every earning was taxed regardless of what the company said. A
            # company treating a per-day meal allowance as non-taxable had no
            # way to express it.
            if component.taxable:
                taxable_earnings += value
        else:
            deductions += value

    # ── Contributions become real deductions ─────────────────────────────
    #
    # 🔒 **This is where SSF actually reduces net pay.** Recording a
    # contribution without deducting it would leave the year-to-date figure
    # claiming money had gone to the fund while the employee was paid it — two
    # records of one event, disagreeing.
    #
    # They are line items rather than a lump subtracted from the total, because
    # an employee has to be able to see the 11% on their payslip. A deduction
    # nobody can find is the one that generates the email to HR.
    #
    # Employee side only. The employer's 20% is a company liability, not
    # something taken from this person's pay — it lives on `ContributionRecord`
    # and appears nowhere in these totals.
    for row in scheme_rows:
        if row["employee_amount"] <= 0:
            continue
        amount = _quantize(row["employee_amount"])
        line_items.append(
            PayslipLineItem(
                payslip=payslip,
                component=None,
                component_code=row["scheme"],
                component_name=SCHEME_LABELS.get(row["scheme"], row["scheme"]),
                component_type=SalaryComponent.ComponentType.DEDUCTION,
                amount=amount,
            )
        )
        deductions += amount

    PayslipLineItem.objects.bulk_create(line_items)

    # The audited record, per scheme, keyed on the scheme rather than on a
    # company-named component — see `payroll/schemes.py`.
    record_contributions(payslip, scheme_rows, fiscal_year)

    payslip.gross_earnings = gross
    payslip.total_deductions = deductions
    payslip.net_pay = gross - deductions
    payslip.period_days = period_days
    payslip.payable_days = payable_days
    # The absence arithmetic, so the payslip can show its working. `day_value`
    # is one day of the reducible earnings at whichever basis was in force;
    # multiply by `unpaid_days` and you get `absence_deduction`, which is the
    # number somebody will want to check.
    payslip.pay_basis = company.pay_basis
    payslip.basis_days = basis_days
    payslip.unpaid_days = unpaid_days
    payslip.day_value = (
        (reducible_full / Decimal(basis_days)).quantize(Decimal("0.01"))
        if basis_days > 0
        else Decimal("0")
    )
    payslip.absence_deduction = (reducible_full - reducible_full * attendance_factor).quantize(
        Decimal("0.01")
    )
    # Snapshotted from the same `attendance` this payslip was priced against,
    # so the hours shown always belong to the money shown. Neither figure
    # affects pay — that is `unpaid_days`, above.
    payslip.days_attended = attendance.days_attended
    payslip.hours_worked = attendance.hours_worked
    payslip.save(update_fields=[
        "gross_earnings", "total_deductions", "net_pay",
        "period_days", "payable_days", "days_attended", "hours_worked",
        "pay_basis", "basis_days", "unpaid_days", "day_value", "absence_deduction",
        "status", "updated_at",
    ])
    return payslip


@transaction.atomic
def set_payslip_line_items(payslip, items, actor=None):
    """Replace a DRAFT payslip's line items with an HR-edited set and
    recompute the totals from them. This is the manual-override path: HR
    previews the auto-computed draft, tweaks amounts or adds one-off
    adjustment lines, and saves. Callers must guarantee the payslip is
    still DRAFT — a finalized payslip is immutable (see the viewset).

    Edited lines carry no SalaryComponent FK (component=None); their
    identity survives only as the snapshot code/name/type, which is all a
    payslip ever needs to display or reprint. Day counts are left as the
    computation set them."""
    payslip.line_items.all().delete()
    gross = Decimal("0")
    deductions = Decimal("0")
    objs = []
    for item in items:
        amount = _quantize(item["amount"])
        component_type = item["component_type"]
        objs.append(
            PayslipLineItem(
                payslip=payslip,
                component=None,
                component_code=item.get("component_code") or "adjustment",
                component_name=item["component_name"],
                component_type=component_type,
                amount=amount,
            )
        )
        if component_type == SalaryComponent.ComponentType.EARNING:
            gross += amount
        else:
            deductions += amount
    PayslipLineItem.objects.bulk_create(objs)

    payslip.gross_earnings = gross
    payslip.total_deductions = deductions
    payslip.net_pay = gross - deductions
    payslip.updated_by = actor
    payslip.save(update_fields=[
        "gross_earnings", "total_deductions", "net_pay", "updated_by", "updated_at",
    ])
    return payslip


def _get_or_create_loan_repayment_component():
    component, _ = SalaryComponent.objects.get_or_create(
        code=LOAN_REPAYMENT_COMPONENT_CODE,
        defaults={
            "name": "Loan Repayment",
            "component_type": SalaryComponent.ComponentType.DEDUCTION,
            "calc_type": SalaryComponent.CalcType.FLAT,
            "taxable": False,
            "is_active": True,
            "order": 999,
        },
    )
    return component


@transaction.atomic
def _upsert_structure_version(employee, effective_from, assignment_pairs, notes, actor=None):
    """Creates (or, if one already exists for this employee/date, replaces
    the assignments of) the structure version effective on that date.

    Structures are still never edited in place *across different dates* —
    but two same-day operations (e.g. a loan activating and another
    closing on the same calendar day) would otherwise collide on the
    (employee, effective_from) unique constraint, since both want to
    "create a new version effective today". Upserting collapses same-day
    changes into one row instead of raising — there's no history lost
    that mattered, since no payroll run has consumed a same-day
    intermediate version yet.
    """
    structure, created = SalaryStructure.objects.get_or_create(
        employee=employee,
        effective_from=effective_from,
        defaults={"notes": notes, "created_by": actor, "updated_by": actor},
    )
    if not created:
        structure.notes = notes
        structure.updated_by = actor
        structure.save(update_fields=["notes", "updated_by", "updated_at"])
        structure.assignments.all().delete()

    SalaryStructureAssignment.objects.bulk_create(
        SalaryStructureAssignment(structure=structure, component=component, amount=amount)
        for component, amount in assignment_pairs
    )
    return structure


def activate_loan(loan, actor=None):
    """Wires the loan's monthly deduction into the employee's salary
    structure by creating (or amending, if one already exists for today —
    see _upsert_structure_version) a new effective-dated version that
    carries over every existing assignment plus the loan deduction."""
    component = _get_or_create_loan_repayment_component()
    today = date.today()
    current = get_active_structure(loan.employee, today)

    pairs = []
    if current:
        pairs = [
            (assignment.component, assignment.amount)
            for assignment in current.assignments.exclude(component=component)
        ]
    pairs.append((component, loan.monthly_deduction))
    _upsert_structure_version(loan.employee, today, pairs, notes=f"Loan #{loan.id} activated", actor=actor)

    loan.status = Loan.Status.ACTIVE
    loan.start_date = today
    loan.outstanding_balance = loan.principal_amount
    loan.salary_component = component
    loan.updated_by = actor
    loan.save(update_fields=["status", "start_date", "outstanding_balance", "salary_component", "updated_by", "updated_at"])
    return loan


def close_loan_deduction(loan, actor=None):
    """Removes the loan's deduction from the employee's salary structure —
    mirrors activate_loan, same same-day-safe upsert."""
    today = date.today()
    current = get_active_structure(loan.employee, today)
    if current is None:
        return
    pairs = [
        (assignment.component, assignment.amount)
        for assignment in current.assignments.exclude(component_id=loan.salary_component_id)
    ]
    _upsert_structure_version(loan.employee, today, pairs, notes=f"Loan #{loan.id} closed", actor=actor)


def apply_loan_repayments(payslip):
    """Called after a payslip is computed: for each of the employee's
    ACTIVE loans, find how much was actually deducted this period (the
    PayslipLineItem for the loan's component) and decrement the
    outstanding balance by that amount, auto-closing the loan and
    removing its deduction once the balance reaches zero."""
    active_loans = Loan.objects.filter(employee=payslip.employee, status=Loan.Status.ACTIVE)
    for loan in active_loans:
        line_item = payslip.line_items.filter(component_id=loan.salary_component_id).first()
        if line_item is None:
            continue
        deducted = min(line_item.amount, loan.outstanding_balance)
        loan.outstanding_balance = loan.outstanding_balance - deducted
        if loan.outstanding_balance <= 0:
            loan.outstanding_balance = Decimal("0")
            loan.status = Loan.Status.CLOSED
            loan.closed_at = timezone.now()
            loan.save(update_fields=["outstanding_balance", "status", "closed_at", "updated_at"])
            close_loan_deduction(loan)
        else:
            loan.save(update_fields=["outstanding_balance", "updated_at"])
