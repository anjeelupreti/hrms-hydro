"""What one day of pay is worth — and why the company decides.

Two bases are in real use and neither is derivable from anything the system
knows. A company that pays a monthly salary understood to cover the whole month
values a day at `salary / days in month`; a company that understands the salary
to buy the days it actually works values it at `salary / working days`. The
second makes every absence cost more, for the same absence. Which one applies is
a term of employment, so `CompanyProfile.pay_basis` is a setting and the engine
reads it.

August 2026 is 31 days. With a Monday-to-Friday week and no holidays it holds 21
working days, so one unpaid day costs 1/31 of the reducible pay on one basis and
1/21 on the other — about 50% more.

These tests are arithmetic on money, so they assert the figures rather than that
the code ran.
"""

from datetime import date
from decimal import Decimal

import pytest

from attendance.models import AttendanceLog
from leave.models import LeaveRequest, LeaveType
from organization.models import CompanyProfile
from payroll.models import SalaryComponent
from payroll.services import compute_payslip

pytestmark = pytest.mark.django_db

YEAR, MONTH = 2026, 8
MON_FRI = [1, 2, 3, 4, 5]
#: 1-31 August 2026 holds 21 Monday-to-Friday days.
WORKING_DAYS_IN_AUGUST = 21


@pytest.fixture
def basic_only(company, payroll_setup):
    """One reducible earning, so the arithmetic is visible.

    `payroll_setup` gives basic 50,000 plus a 40% HRA and a formula tax. HRA is
    a percentage of basic and shrinks with it, which is correct but makes the
    deduction harder to read, so those two are switched off here.
    """
    SalaryComponent.objects.filter(code__in=["hra", "tax"]).update(is_active=False)
    basic = SalaryComponent.objects.get(code="basic")
    basic.reduced_by_absence = True
    basic.save(update_fields=["reduced_by_absence"])
    yield payroll_setup


def _set_basis(basis, working_days=MON_FRI):
    profile = CompanyProfile.get_solo()
    profile.pay_basis = basis
    profile.working_days = working_days
    profile.save(update_fields=["pay_basis", "working_days"])


def _unpaid_leave(employee, start_day, end_day):
    leave_type, _ = LeaveType.objects.get_or_create(
        name="Unpaid", defaults={"is_paid": False, "code": "unpaid"}
    )
    return LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=date(YEAR, MONTH, start_day),
        end_date=date(YEAR, MONTH, end_day),
        days_requested=Decimal("1"),
        status=LeaveRequest.Status.APPROVED,
        is_paid=False,
    )


# ── The calendar basis: a day is 1/31 ────────────────────────────────────


def test_the_calendar_basis_divides_by_the_days_in_the_month(company, basic_only):
    """The salary covers the whole month, weekends included, so a day off costs
    one thirty-first of it."""
    emp, run = basic_only["emp"], basic_only["run"]
    _set_basis(CompanyProfile.PayBasis.CALENDAR)
    _unpaid_leave(emp, 4, 4)  # Tuesday 4 August 2026

    payslip = compute_payslip(run, emp)

    assert payslip.basis_days == 31
    assert payslip.unpaid_days == Decimal("1.00")
    assert payslip.day_value == Decimal("1612.90")  # 50,000 / 31
    assert payslip.absence_deduction == Decimal("1612.90")


# ── The working-day basis: a day is 1/21 ─────────────────────────────────


def test_the_working_day_basis_divides_by_the_days_worked(company, basic_only):
    """The salary buys the days the company works, so one missed costs more."""
    emp, run = basic_only["emp"], basic_only["run"]
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)
    _unpaid_leave(emp, 4, 4)

    payslip = compute_payslip(run, emp)

    assert payslip.basis_days == WORKING_DAYS_IN_AUGUST
    assert payslip.unpaid_days == Decimal("1.00")
    assert payslip.day_value == Decimal("2380.95")  # 50,000 / 21
    assert payslip.absence_deduction == Decimal("2380.95")


def test_the_same_absence_costs_more_on_the_working_day_basis(company, basic_only):
    """The whole point of the setting, stated as a comparison."""
    emp, run = basic_only["emp"], basic_only["run"]
    _unpaid_leave(emp, 4, 4)

    _set_basis(CompanyProfile.PayBasis.CALENDAR)
    calendar_pay = compute_payslip(run, emp).gross_earnings

    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)
    working_pay = compute_payslip(run, emp).gross_earnings

    assert working_pay < calendar_pay


# ── A weekend is never charged, on either basis ──────────────────────────


def test_leave_across_a_weekend_charges_only_the_working_days(company, basic_only):
    """Friday to Monday is two working days. Charging four would take pay for
    the weekend the company was already giving them — and at a rate that had
    already excluded weekends, which takes it twice."""
    emp, run = basic_only["emp"], basic_only["run"]
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)
    _unpaid_leave(emp, 7, 10)  # Fri 7 to Mon 10 August 2026

    payslip = compute_payslip(run, emp)

    assert payslip.unpaid_days == Decimal("2.00")
    assert payslip.absence_deduction == Decimal("4761.90")  # 2 * 50,000/21


def test_the_calendar_basis_also_skips_the_weekend(company, basic_only):
    """**Only the divisor changes between the two bases.** Which days are
    charged does not — a day the company does not work cannot be a day of work
    missed, however you value a day.

    Charging calendar days here priced the same absence differently depending on
    how the request was written: Friday off and Monday off as two requests cost
    2/31, the same two days as one "Friday to Monday" request cost 4/31 because
    the weekend fell inside the span. Identical work missed, different pay,
    decided by paperwork.
    """
    emp, run = basic_only["emp"], basic_only["run"]
    _set_basis(CompanyProfile.PayBasis.CALENDAR)
    _unpaid_leave(emp, 7, 10)  # Fri 7 to Mon 10 August 2026

    payslip = compute_payslip(run, emp)

    assert payslip.basis_days == 31            # still valued at 1/31
    assert payslip.unpaid_days == Decimal("2.00")   # but only 2 days missed
    assert payslip.absence_deduction == Decimal("3225.81")  # 2 * 50,000/31


def test_a_public_holiday_is_never_charged_on_either_basis(company, basic_only):
    """A public holiday is a day the company gave everybody. Charging leave that
    spans one bills somebody for a day off the company handed them."""
    from notifications.models import Holiday

    emp, run = basic_only["emp"], basic_only["run"]
    Holiday.objects.create(name="A festival", date=date(YEAR, MONTH, 11))
    _set_basis(CompanyProfile.PayBasis.CALENDAR)
    _unpaid_leave(emp, 10, 12)  # Mon 10 to Wed 12, holiday on Tue 11

    payslip = compute_payslip(run, emp)

    assert payslip.unpaid_days == Decimal("2.00")


def test_a_holiday_shrinks_the_working_day_divisor(company, basic_only):
    """On the working-day basis the holiday leaves the divisor too, so the
    remaining days are each worth slightly more. 21 working days less one
    holiday is 20."""
    from notifications.models import Holiday

    emp, run = basic_only["emp"], basic_only["run"]
    Holiday.objects.create(name="A festival", date=date(YEAR, MONTH, 11))
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)

    payslip = compute_payslip(run, emp)

    assert payslip.basis_days == 20
    assert payslip.day_value == Decimal("2500.00")  # 50,000 / 20


def test_a_five_day_leave_with_four_holidays_in_it_costs_one_day(company, basic_only):
    """The case stated plainly: five days of unpaid leave, four of them public
    holidays, costs one day of pay.

    A holiday inside a leave span is a day the company had already given
    everybody. Charging it bills somebody for taking a day off they were never
    going to work — and does it while the company is closed.

    Monday 10 to Friday 14 August 2026 is five working days. With Tuesday to
    Friday declared holidays, only the Monday is chargeable.
    """
    from notifications.models import Holiday

    emp, run = basic_only["emp"], basic_only["run"]
    for day in (11, 12, 13, 14):
        Holiday.objects.create(name=f"Festival day {day}", date=date(YEAR, MONTH, day))
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)
    _unpaid_leave(emp, 10, 14)

    payslip = compute_payslip(run, emp)

    assert payslip.unpaid_days == Decimal("1.00")
    # The four holidays leave the divisor as well, so each remaining working day
    # is worth proportionately more: 21 working days less 4 is 17.
    assert payslip.basis_days == 17
    assert payslip.day_value == Decimal("2941.18")          # 50,000 / 17
    assert payslip.absence_deduction == Decimal("2941.18")


def test_the_same_five_day_leave_on_the_calendar_basis(company, basic_only):
    """Still one day charged — the basis changes the rate, not the count."""
    from notifications.models import Holiday

    emp, run = basic_only["emp"], basic_only["run"]
    for day in (11, 12, 13, 14):
        Holiday.objects.create(name=f"Festival day {day}", date=date(YEAR, MONTH, day))
    _set_basis(CompanyProfile.PayBasis.CALENDAR)
    _unpaid_leave(emp, 10, 14)

    payslip = compute_payslip(run, emp)

    assert payslip.unpaid_days == Decimal("1.00")
    assert payslip.basis_days == 31
    assert payslip.absence_deduction == Decimal("1612.90")  # 50,000 / 31


def test_the_leave_ledger_charges_the_same_one_day(company, basic_only):
    """The pay deduction and the leave record have to agree about what was
    taken. Two systems disagreeing about the same absence is how somebody ends
    up querying their payslip."""
    from leave.services import calculate_days
    from notifications.models import Holiday

    for day in (11, 12, 13, 14):
        Holiday.objects.create(name=f"Festival day {day}", date=date(YEAR, MONTH, day))
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)

    charged = calculate_days(date(YEAR, MONTH, 10), date(YEAR, MONTH, 14), False)

    assert charged == Decimal("1")


def test_a_leave_entirely_inside_a_holiday_run_costs_nothing(company, basic_only):
    """Nothing was missed, so nothing is deducted."""
    from notifications.models import Holiday

    emp, run = basic_only["emp"], basic_only["run"]
    for day in (11, 12, 13):
        Holiday.objects.create(name=f"Festival day {day}", date=date(YEAR, MONTH, day))
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)
    _unpaid_leave(emp, 11, 13)

    payslip = compute_payslip(run, emp)

    assert payslip.unpaid_days == Decimal("0.00")
    assert payslip.gross_earnings == Decimal("50000.00")


def test_an_absence_recorded_on_a_weekend_is_not_charged(company, basic_only):
    """Somebody marked absent on a Saturday has not missed a day the divisor
    ever counted."""
    emp, run = basic_only["emp"], basic_only["run"]
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)
    AttendanceLog.objects.create(  # Saturday 8 August 2026
        employee=emp, date=date(YEAR, MONTH, 8), status=AttendanceLog.Status.ABSENT
    )

    payslip = compute_payslip(run, emp)

    assert payslip.unpaid_days == Decimal("0.00")
    assert payslip.gross_earnings == Decimal("50000.00")


# ── The arithmetic is recorded, not just applied ─────────────────────────


def test_the_payslip_can_reproduce_its_own_deduction(company, basic_only):
    """Every number needed to redo the sum is on the payslip. A deduction
    nobody can reproduce is the one that generates the email to HR."""
    emp, run = basic_only["emp"], basic_only["run"]
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)
    _unpaid_leave(emp, 4, 4)

    payslip = compute_payslip(run, emp)

    assert payslip.day_value * payslip.unpaid_days == payslip.absence_deduction


def test_the_basis_is_snapshotted_onto_the_payslip(company, basic_only):
    """`pay_basis` is a setting somebody can change on a Tuesday. A payslip
    issued on Monday has to keep explaining itself in the terms it was actually
    computed under."""
    emp, run = basic_only["emp"], basic_only["run"]
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)
    payslip = compute_payslip(run, emp)
    assert payslip.pay_basis == CompanyProfile.PayBasis.WORKING_DAYS

    _set_basis(CompanyProfile.PayBasis.CALENDAR)
    payslip.refresh_from_db()

    assert payslip.pay_basis == CompanyProfile.PayBasis.WORKING_DAYS


def test_nobody_absent_means_no_deduction_and_a_full_month(company, basic_only):
    emp, run = basic_only["emp"], basic_only["run"]
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)
    payslip = compute_payslip(run, emp)

    assert payslip.unpaid_days == Decimal("0.00")
    assert payslip.absence_deduction == Decimal("0.00")
    assert payslip.gross_earnings == Decimal("50000.00")


def test_a_half_day_costs_half_a_day(company, basic_only):
    emp, run = basic_only["emp"], basic_only["run"]
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS)
    AttendanceLog.objects.create(  # Tuesday 4 August 2026
        employee=emp, date=date(YEAR, MONTH, 4), status=AttendanceLog.Status.HALF_DAY
    )

    payslip = compute_payslip(run, emp)

    assert payslip.unpaid_days == Decimal("0.50")
    assert payslip.absence_deduction == Decimal("1190.48")  # half of 50,000/21


# ── Failing safe ─────────────────────────────────────────────────────────


def test_an_unconfigured_working_week_falls_back_to_every_day(company, basic_only):
    """A company on the working-day basis that has not said which days it works
    has not described a month of zero working days — it has said nothing. The
    divisor is every day, which is the arithmetic it had before the setting
    existed, rather than a division by zero that takes payroll down."""
    emp, run = basic_only["emp"], basic_only["run"]
    _set_basis(CompanyProfile.PayBasis.WORKING_DAYS, working_days=[])
    _unpaid_leave(emp, 4, 4)

    payslip = compute_payslip(run, emp)

    assert payslip.basis_days == 31
    assert payslip.absence_deduction == Decimal("1612.90")
