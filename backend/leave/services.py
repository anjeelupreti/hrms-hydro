from datetime import timedelta
from decimal import Decimal

from django.db import transaction

from accounts.policy import Perm, can
from core.calendars import fiscal_year_for, company_calendar
from leave.models import ApprovalAction, ApprovalChain, ApprovalStep, LeaveBalance, LeaveRequest
from notifications.services import notify

#: "Nothing was passed" — distinct from `None`, which is a real value here
#: meaning *every day counts*. Without the sentinel the two collapse, and a
#: caller asking explicitly for an unrestricted week silently gets a database
#: read of whatever the company happens to have configured.
FROM_COMPANY = object()


def working_day_set():
    """The ISO weekday numbers this company actually works, or `None`.

    `None` means the company has not said, and every caller here treats that as
    "count every day". Returning an empty set instead would mean *no* day is a
    working day, which makes every leave request cost nothing and hands out
    unlimited holiday.
    """
    from organization.models import CompanyProfile

    configured = CompanyProfile.get_solo().working_days or []
    # Stored as JSON, so the values arrive as whatever was written — ints from
    # the API, but strings from a hand-edited fixture. Coerced rather than
    # trusted, because a set of strings never matches `isoweekday()` and the
    # failure is silent: every day looks like a weekend.
    days = set()
    for value in configured:
        try:
            days.add(int(value))
        except (TypeError, ValueError):
            continue
    return days or None


def holidays_between(start_date, end_date):
    """Company holidays falling in a range, as a set of dates."""
    from notifications.models import Holiday

    return set(
        Holiday.objects.filter(date__gte=start_date, date__lte=end_date).values_list(
            "date", flat=True
        )
    )


def is_working_day(day, working=None, holidays=frozenset()):
    if day in holidays:
        return False
    if working is None:
        return True
    return day.isoweekday() in working


def calculate_days(start_date, end_date, half_day, *, working=FROM_COMPANY, holidays=FROM_COMPANY):
    """How many days a request costs.

    **Weekends and holidays are not charged.** Somebody off from Friday to
    Monday spends two days of entitlement, not four: the company does not
    charge them for the weekend it was already giving them, nor for a public
    holiday landing mid-leave.

    Which days those are comes from `CompanyProfile.working_days` and the
    `Holiday` table, both per-company. Neither is hardcoded, because the working
    week is not Monday–Friday everywhere and the festivals move year to year.

    `half_day` only means anything on a single day — a fortnight with the box
    ticked is a fortnight. Ignored rather than refused: the dates are
    unambiguous and the flag is not, so the dates win.

    A request lying entirely on non-working days costs nothing. That is the
    honest answer — no entitlement is being used — rather than an error, since
    the person has asked for something the calendar already gave them.

    **The calendar can be passed in.** Left out it is read from the company,
    which is what every real caller wants. Supplying it keeps this function
    pure arithmetic over a range, so the counting can be tested against a
    stated working week rather than whatever the database holds. `working=None`
    means every day counts; an empty set would mean none do.
    """
    # Checked before `working` is reassigned: the question is whether the
    # caller supplied a week, not what that week contains. `None` is a real
    # value here, so the two cannot be told apart afterwards.
    week_was_given = working is not FROM_COMPANY
    if not week_was_given:
        working = working_day_set()
    if holidays is FROM_COMPANY:
        # A caller who stated the working week and said nothing about holidays
        # is describing a calendar in full, so there are none. Querying anyway
        # would put a database read inside what they asked to be arithmetic.
        holidays = frozenset() if week_was_given else holidays_between(start_date, end_date)

    if half_day and start_date == end_date:
        return Decimal("0.5") if is_working_day(start_date, working, holidays) else Decimal("0")

    count = 0
    day = start_date
    while day <= end_date:
        if is_working_day(day, working, holidays):
            count += 1
        day += timedelta(days=1)
    return Decimal(count)


def allocation_for(leave_type, employee, fiscal_year):
    """A joiner's share of the year's paid leave.

    Somebody who arrives with two months of the year left has not earned a full
    year's holiday, so the quota is scaled by the months they are actually here
    for and **floored to whole days**: four days a year, joining one month
    before the year ends, is zero — not 0.33.

    Floored rather than rounded, deliberately. Rounding hands out a day nobody
    accrued, and a leave balance that reads `0.3` is a number no HR officer can
    act on. Whole days only, and the first full year restores the full quota.
    """
    quota = leave_type.annual_quota_days or Decimal("0")
    joined = getattr(employee, "date_joined", None)
    if joined is None or quota <= 0:
        return quota

    try:
        _, year_end = company_calendar().fiscal_year_bounds(fiscal_year)
    except Exception:  # noqa: BLE001 — an edge of the conversion table
        return quota

    if joined >= year_end:
        return Decimal("0")

    months_left = (year_end.year - joined.year) * 12 + (year_end.month - joined.month)
    if months_left >= 12:
        return quota  # here for the whole year

    months_left = max(months_left, 0)
    return Decimal(int(quota * months_left / 12))


def get_or_create_balance(employee, leave_type, year):
    balance, created = LeaveBalance.objects.get_or_create(
        employee=employee,
        leave_type=leave_type,
        year=year,
        defaults={"allocated_days": allocation_for(leave_type, employee, year)},
    )
    return balance


def get_default_chain():
    """The company-wide default approval chain. Seeded by a data migration
    for the company; falls back to creating one on the fly if somehow
    missing, so this never hard-fails a leave request."""
    chain = ApprovalChain.objects.filter(is_active=True).first()
    if chain:
        return chain
    chain = ApprovalChain.objects.create(name="Standard Leave Approval")
    ApprovalStep.objects.create(chain=chain, sequence=1, approver_role=ApprovalStep.ApproverRole.MANAGER)
    ApprovalStep.objects.create(chain=chain, sequence=2, approver_role=ApprovalStep.ApproverRole.HR_ADMIN)
    return chain


def effective_chain(leave_request):
    """The steps this request actually has to pass, in order.

    **A configured chain cannot say "each of their supervisors".** The chain is
    one row per step and the number of supervisors varies per person — two here,
    four there — so `SUPERVISOR` is expanded here, at the point the request is
    made, into one step per supervisor in the order that person's chain gives
    them. Everything else passes through unchanged.

    Returns `(sequence, role, employee_or_none)` triples. The employee is set
    only for a supervisor step: `MANAGER` resolves against the requester and
    `HR_ADMIN` is a capability rather than a named person, so neither has one.

    Resolved live rather than copied onto the request. That is the weaker
    choice — somebody's supervisors changing mid-request changes who is asked —
    and it is the one that matches the rest of this module, where `MANAGER`
    has always resolved the same way. Copying the chain at submission is the
    right fix and belongs with a stored per-request chain, not here.
    """
    supervisors = [
        link.supervisor
        for link in leave_request.employee.supervisor_links.select_related("supervisor__user").all()
    ]

    steps = []
    sequence = 1
    for step in get_default_chain().steps.all():
        role = step.approver_role
        # **`MANAGER` means "the people who sign this person off", and that is
        # the supervisors when there are any.** Expanding it here rather than
        # re-seeding the chain as `SUPERVISOR` is deliberate: every existing
        # installation already has `MANAGER` seeded, so a migration would be
        # needed to change them and an installation that missed it would keep
        # routing leave past the supervisors entirely. Somebody with no
        # supervisors still goes to their manager, exactly as before.
        if role in (ApprovalStep.ApproverRole.SUPERVISOR, ApprovalStep.ApproverRole.MANAGER):
            if supervisors:
                for supervisor in supervisors:
                    steps.append((sequence, ApprovalStep.ApproverRole.SUPERVISOR, supervisor))
                    sequence += 1
                continue
            # No supervisors. A `SUPERVISOR` step with nobody in it is skipped
            # rather than turned into a manager step it was not configured as.
            if role == ApprovalStep.ApproverRole.SUPERVISOR:
                continue
        steps.append((sequence, role, None))
        sequence += 1
    return steps


def can_act_on_step(user, leave_request, step):
    """Whether `user` is the resolved approver for this step. MANAGER
    resolves to the requester's manager specifically; HR_ADMIN resolves
    to *any* HR admin or superuser, not one fixed person."""
    if step is None:
        return False
    # Accepts either the resolved `(sequence, role, employee)` this module now
    # passes around, or a bare `ApprovalStep` — which is what a caller holding
    # a configured chain row has, and what the tests document. Normalising here
    # rather than at each call site keeps the one public predicate usable from
    # both.
    if isinstance(step, ApprovalStep):
        role, supervisor = step.approver_role, None
    else:
        _sequence, role, supervisor = step
    if role == ApprovalStep.ApproverRole.HR_ADMIN:
        # HR_ADMIN resolves to a capability, not to a named person: anyone
        # holding `leave.approve` is the approver for this step.
        return can(user, Perm.LEAVE_APPROVE)
    if role == ApprovalStep.ApproverRole.MANAGER:
        manager = leave_request.employee.manager
        return manager is not None and manager.user_id == user.id
    if role == ApprovalStep.ApproverRole.SUPERVISOR:
        # A named person, and only that person. The whole point of an ordered
        # chain is that supervisor two cannot sign before supervisor one.
        return supervisor is not None and supervisor.user_id == user.id
    return False


def _current_step(leave_request):
    """The step the request is sitting on, as a `(sequence, role, employee)`.

    Was a lookup into `ApprovalChain.steps` by sequence, which cannot work once
    a step expands into several — the sequence numbers a request moves through
    are no longer the sequence numbers stored on the chain.
    """
    for step in effective_chain(leave_request):
        if step[0] == leave_request.current_step:
            return step
    return None


@transaction.atomic
def submit_leave_request(employee, leave_type, start_date, end_date, half_day, reason):
    days = calculate_days(start_date, end_date, half_day)
    # Fiscal year, not `start_date.year`. An entitlement runs Shrawan→Ashad,
    # and the portal reads the fiscal year — keying the write on the Gregorian
    # one addresses a different row entirely, so the balance somebody can see
    # never moves when their leave is approved. See core.calendars.
    balance = get_or_create_balance(employee, leave_type, fiscal_year_for(start_date))
    # Whether *this leave type* draws from a tracked quota is independent
    # of whether *this employee* gets paid for it — probation affects
    # payroll treatment (is_paid), not whether the balance still applies
    # (per the decision that probation leave still deducts from balance).
    exceeds = leave_type.is_paid and days > balance.remaining_days
    is_paid = leave_type.is_paid and not employee.is_on_probation(start_date)

    request = LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=start_date,
        end_date=end_date,
        half_day=half_day,
        days_requested=days,
        reason=reason,
        is_paid=is_paid,
        exceeds_balance=exceeds,
        created_by=employee.user,
        updated_by=employee.user,
    )

    step = _current_step(request)
    _notify_approvers_for_step(request, step)
    return request


def _notify_approvers_for_step(leave_request, step):
    if step is None:
        return
    flags = []
    if leave_request.exceeds_balance:
        flags.append("exceeds remaining balance")
    if not leave_request.is_paid:
        flags.append("unpaid — probation")
    suffix = f" ({', '.join(flags)})" if flags else ""
    message = (
        f"{leave_request.employee.user.get_full_name() or leave_request.employee.employee_code} "
        f"requested {leave_request.days_requested} day(s) of {leave_request.leave_type.name} "
        f"({leave_request.start_date} to {leave_request.end_date}){suffix}."
    )
    _sequence, role, supervisor = step
    if role == ApprovalStep.ApproverRole.SUPERVISOR:
        # A named person. `notify` sends both the in-app row and the email, so
        # a supervisor who is not in the product that day still hears about it.
        notify(
            supervisor.user,
            "leave_requested",
            message,
            email_subject="Leave request awaiting your approval",
        )
    elif role == ApprovalStep.ApproverRole.MANAGER:
        manager = leave_request.employee.manager
        if manager is None:
            # No one to approve this step — auto-skip it rather than
            # stall the request forever.
            _advance_or_finalize(leave_request, auto_skip_reason="no manager assigned")
            return
        notify(manager.user, "leave_requested", message, email_subject="Leave request awaiting your approval")
    else:
        from accounts.policy import Perm, users_with

        # Whoever may approve leave, not whoever is called HR.
        for admin in users_with(Perm.LEAVE_APPROVE):
            notify(admin, "leave_requested", message, email_subject="Leave request awaiting your approval")


@transaction.atomic
def decide(leave_request, actor, decision, comment=""):
    ApprovalAction.objects.create(
        leave_request=leave_request,
        step_sequence=leave_request.current_step,
        decision=decision,
        comment=comment,
        actor=actor,
    )

    if decision == ApprovalAction.Decision.REJECTED:
        leave_request.status = LeaveRequest.Status.REJECTED
        leave_request.updated_by = actor
        leave_request.save(update_fields=["status", "updated_by", "updated_at"])
        notify(
            leave_request.employee.user,
            "leave_rejected",
            f"Your {leave_request.leave_type.name} request "
            f"({leave_request.start_date} to {leave_request.end_date}) was rejected."
            + (f" Reason: {comment}" if comment else ""),
            email_subject="Leave request rejected",
        )
        return leave_request

    _advance_or_finalize(leave_request, actor=actor)
    return leave_request


def _advance_or_finalize(leave_request, actor=None, auto_skip_reason=None):
    # The *expanded* chain, not the configured one. A `SUPERVISOR` step
    # becomes one step per supervisor, so the sequence numbers a request moves
    # through no longer match the rows on `ApprovalChain` — looking the next
    # one up there stopped the request after the first supervisor.
    next_step = next(
        (step for step in effective_chain(leave_request) if step[0] == leave_request.current_step + 1),
        None,
    )

    # A skipped step is still a decision, so it gets an approval row. Discard
    # `auto_skip_reason` instead and "who approved step one?" has no answer at
    # all for anybody without a manager. The actor is null, which is the honest
    # way to say the system did it.
    if auto_skip_reason:
        ApprovalAction.objects.create(
            leave_request=leave_request,
            step_sequence=leave_request.current_step,
            decision=ApprovalAction.Decision.APPROVED,
            comment=f"Skipped automatically — {auto_skip_reason}.",
            actor=None,
        )

    if next_step is None:
        leave_request.status = LeaveRequest.Status.APPROVED
        leave_request.updated_by = actor
        leave_request.save(update_fields=["status", "updated_by", "updated_at"])
        # Same fiscal year the request was measured against at submission —
        # spending from a different row than the one that was checked is how
        # the two ever came apart.
        balance = get_or_create_balance(
            leave_request.employee,
            leave_request.leave_type,
            fiscal_year_for(leave_request.start_date),
        )
        balance.used_days += leave_request.days_requested
        balance.updated_by = actor
        balance.save(update_fields=["used_days", "updated_by", "updated_at"])
        notify(
            leave_request.employee.user,
            "leave_approved",
            f"Your {leave_request.leave_type.name} request "
            f"({leave_request.start_date} to {leave_request.end_date}) was approved.",
            email_subject="Leave request approved",
        )
        return

    leave_request.current_step = next_step[0]
    leave_request.updated_by = actor
    leave_request.save(update_fields=["current_step", "updated_by", "updated_at"])
    _notify_approvers_for_step(leave_request, next_step)
