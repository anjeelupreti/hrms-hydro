"""Leave: approval chains, balance arithmetic, and the payslip contract.

**This module had no tests at all**, and it is inside v1 precisely because
payroll reads it. It decides two things people notice immediately — how much
holiday somebody has left, and whether a day off is paid — and nothing proved
either.

Written by reading the service and pinning what it does, not what it ought to
do. Where the two differ, the test says so and names the defect rather than
quietly asserting the buggy behaviour as correct.
"""

from datetime import date
from decimal import Decimal

import pytest

from accounts.models import User
from core.calendars import fiscal_year_for
from employees.models import Employee
from leave.models import (
    ApprovalAction,
    ApprovalStep,
    LeaveBalance,
    LeaveRequest,
    LeaveType,
)
from leave.services import (
    calculate_days,
    can_act_on_step,
    decide,
    get_default_chain,
    get_or_create_balance,
    submit_leave_request,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def annual(company):
    yield LeaveType.objects.create(
        name="Annual", code="annual", is_paid=True, annual_quota_days=Decimal("12")
    )


@pytest.fixture
def unpaid_type(company):
    yield LeaveType.objects.create(
        name="Unpaid", code="unpaid", is_paid=False, annual_quota_days=Decimal("0")
    )


@pytest.fixture
def staff(company, employee_user):
    yield Employee.objects.create(
        user=employee_user, employee_code="EMP-7001", date_joined=date(2020, 1, 1)
    )


@pytest.fixture
def boss(company, hr_user):
    yield Employee.objects.create(
        user=hr_user, employee_code="EMP-7000", date_joined=date(2019, 1, 1)
    )


@pytest.fixture
def company_probationer(company, admin_user):
    """Somebody whose probation has not ended by the request dates below."""
    yield Employee.objects.create(
        user=admin_user,
        employee_code="EMP-7002",
        date_joined=date(2026, 1, 1),
        probation_end_date=date(2026, 7, 1),
    )


# ── Counting days ────────────────────────────────────────────────────────


#: A Monday-to-Friday week, stated rather than assumed. These tests are about
#: the arithmetic over a range, so they pass the calendar in instead of reading
#: whichever working week the company in the database happens to have — which is
#: also what keeps them from needing a schema at all.
MON_TO_FRI = {1, 2, 3, 4, 5}


def test_a_single_day_is_one_day():
    assert calculate_days(
        date(2026, 3, 2), date(2026, 3, 2), False, working=MON_TO_FRI
    ) == Decimal("1")


def test_the_range_is_inclusive_at_both_ends():
    """Monday to Friday is five days off, not four. Off-by-one here is a day of
    somebody's holiday."""
    assert calculate_days(
        date(2026, 3, 2), date(2026, 3, 6), False, working=MON_TO_FRI
    ) == Decimal("5")


def test_a_half_day_is_half_a_day():
    assert calculate_days(
        date(2026, 3, 2), date(2026, 3, 2), True, working=MON_TO_FRI
    ) == Decimal("0.5")


def test_a_range_ignores_the_half_day_flag():
    """A fortnight with the box ticked is a fortnight.

    `half_day` means something only on a single day. Honoured on a range, a
    week off would cost half a day of balance. Ignored rather than refused: the
    dates are unambiguous and the flag is not, so the dates win and nobody gets
    an error about a form they filled in reasonably.
    """
    assert calculate_days(
        date(2026, 3, 2), date(2026, 3, 6), True, working=MON_TO_FRI
    ) == Decimal("5")


def test_the_weekend_is_not_charged_to_somebody_off_across_it():
    """Friday to Monday is two days of entitlement, not four.

    Counting calendar days charged people for the weekend the company was
    already giving them — the longer the leave, the worse the overcharge.
    """
    # Fri 6 March to Mon 9 March 2026.
    assert calculate_days(
        date(2026, 3, 6), date(2026, 3, 9), False, working=MON_TO_FRI
    ) == Decimal("2")


def test_a_holiday_inside_the_range_is_not_charged():
    """A public holiday is a day off the company gave everybody. Spending
    entitlement on it means the holiday cost the employee a day."""
    assert calculate_days(
        date(2026, 3, 2),
        date(2026, 3, 6),
        False,
        working=MON_TO_FRI,
        holidays={date(2026, 3, 4)},
    ) == Decimal("4")


def test_leave_entirely_on_non_working_days_costs_nothing():
    """The honest answer — no entitlement is being used. Not an error: they
    asked for something the calendar had already given them."""
    # Sat 7 and Sun 8 March 2026.
    assert calculate_days(
        date(2026, 3, 7), date(2026, 3, 8), False, working=MON_TO_FRI
    ) == Decimal("0")


def test_an_unconfigured_working_week_counts_every_day():
    """`None` means the company has not said. Treating that as "no day is a
    working day" would make every request free and hand out unlimited leave."""
    assert calculate_days(
        date(2026, 3, 6), date(2026, 3, 9), False, working=None
    ) == Decimal("4")


def test_a_six_day_week_charges_saturday():
    """The working week is not Monday–Friday everywhere, which is the entire
    reason `working_days` is configuration rather than a constant."""
    six_day = {1, 2, 3, 4, 5, 6}
    assert calculate_days(
        date(2026, 3, 6), date(2026, 3, 9), False, working=six_day
    ) == Decimal("3")


def test_a_half_day_on_a_holiday_costs_nothing():
    assert calculate_days(
        date(2026, 3, 4),
        date(2026, 3, 4),
        True,
        working=MON_TO_FRI,
        holidays={date(2026, 3, 4)},
    ) == Decimal("0")


def test_the_companies_own_calendar_is_used_when_none_is_given(company):
    """The real call path — `submit_leave_request` passes nothing, so the
    working week and the holiday table are read from the company."""
    from notifications.models import Holiday
    from organization.models import CompanyProfile

    profile = CompanyProfile.get_solo()
    profile.working_days = [1, 2, 3, 4, 5]
    profile.save(update_fields=["working_days"])
    Holiday.objects.create(name="A festival", date=date(2026, 3, 4))

    # Mon 2 – Mon 9: five weekdays, minus the festival, minus the weekend.
    assert calculate_days(date(2026, 3, 2), date(2026, 3, 9), False) == Decimal("5")


# ── Balances ─────────────────────────────────────────────────────────────


def test_remaining_is_allocation_plus_carry_forward_minus_used(company, staff, annual):
    balance = LeaveBalance.objects.create(
        employee=staff,
        leave_type=annual,
        year=2026,
        allocated_days=Decimal("12"),
        carried_forward_days=Decimal("3"),
        used_days=Decimal("4"),
    )
    assert balance.remaining_days == Decimal("11")


def test_a_missing_balance_is_created_from_the_types_quota(company, staff, annual):
    """Somebody with no balance row yet gets one on first request. Failing
    there would make the feature look broken on first use.

    `staff` joined in 2020, so they are here for the whole year and get the
    full quota — the proration case is covered separately below.
    """
    balance = get_or_create_balance(staff, annual, fiscal_year_for(date.today()))

    assert balance.allocated_days == Decimal("12")
    assert balance.used_days == Decimal("0")


def test_balance_is_only_spent_on_final_approval(company, staff, annual):
    """A pending request must not reserve days. Two people asking for the last
    day of leave is a conversation, not an arithmetic error."""
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 4), False, "")
    balance = get_or_create_balance(staff, annual, 2026)

    assert request.status == LeaveRequest.Status.PENDING
    assert balance.used_days == Decimal("0")


def test_two_half_days_spend_one_day_of_balance(company, staff, annual, hr_user):
    """Owner's rule, and the reason halves are stored as halves rather than
    rounded at each request: two Friday afternoons is one day of holiday, and
    rounding either one up would charge two.
    """
    year = fiscal_year_for(date(2026, 3, 2))

    for day in (date(2026, 3, 2), date(2026, 3, 9)):
        request = submit_leave_request(staff, annual, day, day, True, "")
        request.refresh_from_db()
        decide(request, hr_user, ApprovalAction.Decision.APPROVED)

    assert get_or_create_balance(staff, annual, year).used_days == Decimal("1")


def test_a_half_day_leaves_a_half_day_behind(company, staff, annual, hr_user):
    """The odd half has to survive to be paired with the next one — dropping it
    is how somebody's balance quietly gains a day."""
    year = fiscal_year_for(date(2026, 3, 2))
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 2), True, "")
    request.refresh_from_db()
    decide(request, hr_user, ApprovalAction.Decision.APPROVED)

    balance = get_or_create_balance(staff, annual, year)

    assert balance.used_days == Decimal("0.5")
    assert balance.remaining_days == Decimal("11.5")


# ── A joiner's share of the year ─────────────────────────────────────────


def _joined_months_before_year_end(months, fiscal_year):
    """A join date `months` whole months before the fiscal year closes."""
    from core.calendars import company_calendar

    _, year_end = company_calendar().fiscal_year_bounds(fiscal_year)
    year = year_end.year
    month = year_end.month - months
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, min(year_end.day, 28))


def test_a_full_year_gets_the_full_quota(company, annual):
    """The ordinary case must stay ordinary."""
    from leave.services import allocation_for

    fiscal = fiscal_year_for(date.today())
    veteran = Employee.objects.create(
        user=User.objects.create_user(username="vet", email="vet@acme.com", password="x"),
        employee_code="EMP-7100",
        date_joined=date(2015, 1, 1),
    )

    assert allocation_for(annual, veteran, fiscal) == Decimal("12")


def test_half_a_year_gets_half_the_quota(company, annual):
    """Owner's rule: hired six months before the year ends, the paid leave is
    halved."""
    from leave.services import allocation_for

    fiscal = fiscal_year_for(date.today())
    joiner = Employee.objects.create(
        user=User.objects.create_user(username="half", email="half@acme.com", password="x"),
        employee_code="EMP-7101",
        date_joined=_joined_months_before_year_end(6, fiscal),
    )

    assert allocation_for(annual, joiner, fiscal) == Decimal("6")


def test_a_small_quota_and_a_late_joiner_come_to_nothing(company):
    """🔒 The owner's worked example: four days a year, hired one month before
    the year ends, is **zero** — not 0.33.

    Floored rather than rounded on purpose. Rounding hands out a day nobody
    accrued, and a balance reading `0.3` is a number no HR officer can act on.
    """
    from leave.services import allocation_for

    short = LeaveType.objects.create(
        name="Sick", code="sick", is_paid=True, annual_quota_days=Decimal("4")
    )
    fiscal = fiscal_year_for(date.today())
    joiner = Employee.objects.create(
        user=User.objects.create_user(username="late", email="late@acme.com", password="x"),
        employee_code="EMP-7102",
        date_joined=_joined_months_before_year_end(1, fiscal),
    )

    assert allocation_for(short, joiner, fiscal) == Decimal("0")


def test_the_allocation_is_always_whole_days(company):
    """Whole days only, at every fraction of a year — the rule is arithmetic,
    not a special case for the example that prompted it."""
    from leave.services import allocation_for

    short = LeaveType.objects.create(
        name="Casual", code="casual", is_paid=True, annual_quota_days=Decimal("7")
    )
    fiscal = fiscal_year_for(date.today())

    for months in range(1, 12):
        joiner = Employee.objects.create(
            user=User.objects.create_user(
                username=f"j{months}", email=f"j{months}@acme.com", password="x"
            ),
            employee_code=f"EMP-72{months:02d}",
            date_joined=_joined_months_before_year_end(months, fiscal),
        )
        allocation = allocation_for(short, joiner, fiscal)
        assert allocation == allocation.to_integral_value(), (
            f"{months} months gave {allocation}, which is not a whole day"
        )


def test_a_new_joiners_first_balance_is_prorated(company, annual):
    """End to end: the row created on their first request already carries the
    reduced allocation, so nobody has to remember to adjust it."""
    fiscal = fiscal_year_for(date.today())
    joiner = Employee.objects.create(
        user=User.objects.create_user(username="fresh", email="fresh@acme.com", password="x"),
        employee_code="EMP-7300",
        date_joined=_joined_months_before_year_end(3, fiscal),
    )

    balance = get_or_create_balance(joiner, annual, fiscal)

    assert balance.allocated_days == Decimal("3")


# ── The approval chain ───────────────────────────────────────────────────


def test_the_default_chain_is_manager_then_hr(company):
    chain = get_default_chain()
    roles = list(chain.steps.order_by("sequence").values_list("approver_role", flat=True))

    assert roles == [ApprovalStep.ApproverRole.MANAGER, ApprovalStep.ApproverRole.HR_ADMIN]


def test_a_request_with_a_manager_waits_at_step_one(company, staff, boss, annual):
    staff.manager = boss
    staff.save(update_fields=["manager"])
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 2), False, "")

    assert request.current_step == 1
    assert request.status == LeaveRequest.Status.PENDING


def test_a_request_with_no_manager_skips_straight_past_step_one(company, staff, annual):
    """Nobody can approve a step that resolves to nobody, and stalling forever
    is worse than skipping."""
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 2), False, "")
    request.refresh_from_db()

    assert request.current_step == 2


def test_the_auto_skip_says_why_it_skipped(company, staff, annual):
    """A skipped step is still a decision.

    An automatic skip writes an approval row. Without one, a request from
    somebody with no manager advances past step one with nothing recorded
    anywhere and "who approved this?" has no answer. The actor is **null** —
    the honest way to say the system did it, rather than attributing it to
    whoever happened to be nearby.
    """
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 2), False, "")
    action = request.actions.filter(step_sequence=1).first()

    assert action is not None, "the skip left no trace"
    assert action.actor is None
    assert "no manager" in action.comment.lower()


def test_a_normal_approval_is_still_attributed_to_a_person(company, staff, boss, annual, hr_user):
    """The null actor means "the system"; it must not start meaning "anyone"."""
    staff.manager = boss
    staff.save(update_fields=["manager"])
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 2), False, "")
    decide(request, boss.user, ApprovalAction.Decision.APPROVED)

    assert request.actions.filter(actor=boss.user).exists()


def test_both_steps_must_approve_before_the_balance_moves(company, staff, boss, annual, hr_user):
    staff.manager = boss
    staff.save(update_fields=["manager"])
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 3), False, "")

    year = fiscal_year_for(date(2026, 3, 2))

    decide(request, boss.user, ApprovalAction.Decision.APPROVED)
    request.refresh_from_db()
    assert request.status == LeaveRequest.Status.PENDING
    assert request.current_step == 2
    assert get_or_create_balance(staff, annual, year).used_days == Decimal("0")

    decide(request, hr_user, ApprovalAction.Decision.APPROVED)
    request.refresh_from_db()
    assert request.status == LeaveRequest.Status.APPROVED
    assert get_or_create_balance(staff, annual, year).used_days == Decimal("2")


def test_a_rejection_ends_it_immediately(company, staff, annual, hr_user):
    """No second opinion, and no balance spent."""
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 3), False, "")
    decide(request, hr_user, ApprovalAction.Decision.REJECTED, comment="Too short notice")
    request.refresh_from_db()

    assert request.status == LeaveRequest.Status.REJECTED
    assert get_or_create_balance(staff, annual, 2026).used_days == Decimal("0")


def test_every_decision_is_recorded_with_who_and_why(company, staff, annual, hr_user):
    """Append-only, because "who approved this in March" gets asked."""
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 2), False, "")
    decide(request, hr_user, ApprovalAction.Decision.REJECTED, comment="Clashes with the audit")

    action = request.actions.first()
    assert action.actor_id == hr_user.id
    assert action.decision == ApprovalAction.Decision.REJECTED
    assert "audit" in action.comment


# ── Who may decide ───────────────────────────────────────────────────────


def test_the_manager_step_resolves_to_that_employees_manager(company, staff, boss, annual, hr_user):
    staff.manager = boss
    staff.save(update_fields=["manager"])
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 2), False, "")
    step = ApprovalStep.objects.get(sequence=1, chain=get_default_chain())

    assert can_act_on_step(boss.user, request, step) is True
    assert can_act_on_step(staff.user, request, step) is False


def test_the_hr_step_resolves_to_anybody_holding_the_capability(company, staff, annual, hr_user):
    """Not one fixed person — an HR step that named an individual would stall
    every time that individual took leave themselves."""
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 2), False, "")
    step = ApprovalStep.objects.get(sequence=2, chain=get_default_chain())

    assert can_act_on_step(hr_user, request, step) is True
    assert can_act_on_step(staff.user, request, step) is False


# ── The contract with payroll ────────────────────────────────────────────


def test_an_unpaid_leave_type_produces_unpaid_leave(company, staff, unpaid_type):
    """This flag is what reaches the payslip as a deduction."""
    request = submit_leave_request(
        staff, unpaid_type, date(2026, 3, 2), date(2026, 3, 3), False, ""
    )

    assert request.is_paid is False


def test_probation_makes_otherwise_paid_leave_unpaid(company, company_probationer, annual):
    request = submit_leave_request(
        company_probationer, annual, date(2026, 3, 2), date(2026, 3, 2), False, ""
    )

    assert request.is_paid is False


def test_probation_leave_still_draws_down_the_balance(company, company_probationer, annual, hr_user):
    """Two separate questions: whether the day is paid, and whether it counts
    against an entitlement. Probation changes the first, not the second."""
    request = submit_leave_request(
        company_probationer, annual, date(2026, 3, 2), date(2026, 3, 2), False, ""
    )
    request.refresh_from_db()
    decide(request, hr_user, ApprovalAction.Decision.APPROVED)

    year = fiscal_year_for(date(2026, 3, 2))
    assert get_or_create_balance(company_probationer, annual, year).used_days == Decimal("1")


def test_the_paid_flag_is_frozen_at_submission(company, company_probationer, annual, hr_user):
    """Probation ending between request and approval must not retroactively
    change what somebody was told when they asked."""
    request = submit_leave_request(
        company_probationer, annual, date(2026, 3, 2), date(2026, 3, 2), False, ""
    )
    company_probationer.probation_end_date = date(2020, 1, 1)
    company_probationer.save(update_fields=["probation_end_date"])
    request.refresh_from_db()

    assert request.is_paid is False


# ── Going over ───────────────────────────────────────────────────────────


def test_exceeding_the_balance_is_flagged_not_refused(company, staff, annual):
    """**O3, settled this way deliberately.** Refusing pushes the request into
    an unpaid-leave form keyed by hand, which is worse: the same absence,
    recorded somewhere nobody is looking. Flagged, and the approver decides."""
    request = submit_leave_request(staff, annual, date(2026, 3, 1), date(2026, 3, 31), False, "")

    assert request.exceeds_balance is True
    assert request.status == LeaveRequest.Status.PENDING


def test_an_unpaid_type_never_counts_as_exceeding(company, staff, unpaid_type):
    """There is no quota to exceed."""
    request = submit_leave_request(
        staff, unpaid_type, date(2026, 3, 1), date(2026, 3, 31), False, ""
    )

    assert request.exceeds_balance is False


# ── The fiscal-year defect ───────────────────────────────────────────────


def test_the_balance_spent_is_the_balance_the_portal_shows(company, staff, annual, hr_user):
    """🔒 **One balance row, written and read the same way.**

    The write must key on the same fiscal year the read does. Keyed on
    `start_date.year` — Gregorian, 2026 — while `accounts/portal.py` reads on
    the **BS fiscal year**, the two address different rows: approving leave
    decrements a balance the employee's own portal never shows, and the
    portal's figure never moves however much leave is taken.

    Neither module was wrong alone; they were two answers to one question. The
    fix is `core.calendars.fiscal_year_for` — one function, no second opinion.
    """
    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 3), False, "")
    request.refresh_from_db()
    decide(request, hr_user, ApprovalAction.Decision.APPROVED)

    fiscal = fiscal_year_for(date(2026, 3, 2))
    spent = LeaveBalance.objects.get(employee=staff, leave_type=annual, year=fiscal)

    assert spent.used_days == Decimal("2")
    # And nothing stranded under the Gregorian year.
    assert not LeaveBalance.objects.filter(employee=staff, year=2026).exclude(
        year=fiscal
    ).exists()


def test_the_portal_and_leave_agree_on_the_year(company, staff, annual, hr_user):
    """The regression test for the whole class of bug: both sides asked
    independently, and the answers must match."""
    from accounts.portal import portal_summary

    request = submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 3), False, "")
    request.refresh_from_db()
    decide(request, hr_user, ApprovalAction.Decision.APPROVED)

    summary = portal_summary(staff, fiscal_year_for(date(2026, 3, 2)))
    annual_line = next(
        (b for b in summary["leave"]["balances"] if b["leave_type"] == annual.name), None
    )

    assert annual_line is not None, "the portal cannot see the balance leave just spent"
    assert Decimal(str(annual_line["used"])) == Decimal("2")


# ── The annual rollover ──────────────────────────────────────────────────


def test_the_rollover_writes_the_year_requests_read(company, staff, annual):
    """🔒 The other half of the fiscal-year defect.

    The accrual task keyed on `today.year` while requests keyed on the fiscal
    year — so the rollover allocated a year's leave into rows the request path
    never looked at. Fixing only one side would have moved the bug rather than
    closed it.
    """
    from leave.tasks import apply_annual_leave_accrual

    apply_annual_leave_accrual(force=True)

    this_year = fiscal_year_for(date.today())
    balance = LeaveBalance.objects.filter(
        employee=staff, leave_type=annual, year=this_year
    ).first()

    assert balance is not None, "the rollover wrote a year nothing else reads"
    assert balance.allocated_days == Decimal("12")


def test_carry_forward_is_capped_at_the_types_limit(company, staff, annual):
    """Unused leave rolling over without a ceiling is how somebody accrues a
    year off; the cap is the point of the setting."""
    from leave.tasks import apply_annual_leave_accrual

    annual.carry_forward_allowed = True
    annual.max_carry_forward_days = Decimal("5")
    annual.save(update_fields=["carry_forward_allowed", "max_carry_forward_days"])

    this_year = fiscal_year_for(date.today())
    LeaveBalance.objects.create(
        employee=staff,
        leave_type=annual,
        year=this_year - 1,
        allocated_days=Decimal("12"),
        used_days=Decimal("0"),
    )

    apply_annual_leave_accrual(force=True)
    rolled = LeaveBalance.objects.get(employee=staff, leave_type=annual, year=this_year)

    assert rolled.carried_forward_days == Decimal("5")


def test_carry_forward_is_refused_when_the_type_forbids_it(company, staff, annual):
    from leave.tasks import apply_annual_leave_accrual

    this_year = fiscal_year_for(date.today())
    LeaveBalance.objects.create(
        employee=staff,
        leave_type=annual,
        year=this_year - 1,
        allocated_days=Decimal("12"),
        used_days=Decimal("0"),
    )

    apply_annual_leave_accrual(force=True)
    rolled = LeaveBalance.objects.get(employee=staff, leave_type=annual, year=this_year)

    assert rolled.carried_forward_days == Decimal("0")


# ── Retirement, not deletion ─────────────────────────────────────────────


def test_a_type_with_history_is_retired_rather_than_deleted(company, staff, annual):
    """`LeaveRequest.leave_type` is PROTECT, so old requests keep their name."""
    submit_leave_request(staff, annual, date(2026, 3, 2), date(2026, 3, 2), False, "")
    annual.is_active = False
    annual.save(update_fields=["is_active"])

    assert LeaveType.objects.filter(pk=annual.pk).exists()
    assert LeaveRequest.objects.filter(leave_type=annual).exists()


# ── Previewing the cost before committing to it ──────────────────────────


def test_the_form_is_told_what_a_range_will_actually_cost(company, admin_client):
    """Computed server-side, so the number shown and the number charged cannot
    disagree — a second implementation in the browser would drift the first time
    a company changed its working week."""
    from organization.models import CompanyProfile

    profile = CompanyProfile.get_solo()
    profile.working_days = [1, 2, 3, 4, 5]
    profile.save(update_fields=["working_days"])

    # Fri 6 March to Mon 9 March 2026.
    response = admin_client.get("/api/v1/leave/requests/day-count/?start=2026-03-06&end=2026-03-09")

    assert response.status_code == 200
    assert response.data["days"] == "2"
    # Stated so the form can explain the gap rather than looking like it
    # miscounted.
    assert response.data["calendar_days"] == 4


def test_a_backwards_range_is_refused(company, admin_client):
    response = admin_client.get("/api/v1/leave/requests/day-count/?start=2026-03-09&end=2026-03-06")

    assert response.status_code == 400


def test_a_malformed_date_is_refused(company, admin_client):
    response = admin_client.get("/api/v1/leave/requests/day-count/?start=friday&end=2026-03-09")

    assert response.status_code == 400
