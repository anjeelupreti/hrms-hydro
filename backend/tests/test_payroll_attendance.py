"""B1 — attendance, leave, overtime and night shifts reaching pay.

Payroll reading attendance is the point at which two systems that were
independently correct can start producing a wrong number together. These tests
pin the seam: what counts, what deliberately does not, and that the pieces
compose rather than overwrite each other.
"""

from datetime import date
from decimal import Decimal

import pytest

from attendance.models import AttendanceLog, OvertimeRecord, Shift, ShiftAssignment
from attendance.payroll_summary import get_period_attendance
from leave.models import LeaveRequest, LeaveType
from payroll.models import SalaryComponent
from payroll.services import compute_payslip

pytestmark = pytest.mark.django_db

YEAR, MONTH = 2026, 8  # 31 days
# `get_period_attendance` takes the window rather than a year and a month
# since D-06 — it no longer derives 1-31 August itself, because that
# derivation was wrong for any company not on the Gregorian calendar.
PERIOD = (date(YEAR, MONTH, 1), date(YEAR, MONTH, 31))


def _log(employee, day, status):
    return AttendanceLog.objects.create(
        employee=employee, date=date(YEAR, MONTH, day), status=status
    )


def _leave(employee, start_day, end_day, *, paid, status=LeaveRequest.Status.APPROVED,
           half_day=False, name=None):
    type_name = name or ("Annual" if paid else "Unpaid")
    leave_type, _ = LeaveType.objects.get_or_create(
        name=type_name,
        defaults={"is_paid": paid, "code": type_name.lower()[:20]},
    )
    start = date(YEAR, MONTH, start_day)
    end = date(YEAR, MONTH, end_day)
    return LeaveRequest.objects.create(
        employee=employee, leave_type=leave_type, start_date=start, end_date=end,
        days_requested=Decimal((end - start).days + 1), status=status,
        is_paid=paid, half_day=half_day,
    )


# ── What the period summary counts ───────────────────────────────────────


def test_absences_and_half_days_are_counted(company, payroll_setup):
    emp = payroll_setup["emp"]
    _log(emp, 3, AttendanceLog.Status.ABSENT)
    _log(emp, 4, AttendanceLog.Status.ABSENT)
    _log(emp, 5, AttendanceLog.Status.HALF_DAY)
    _log(emp, 6, AttendanceLog.Status.LATE)
    _log(emp, 7, AttendanceLog.Status.PRESENT)

    summary = get_period_attendance(emp, *PERIOD)

    assert summary.absent_days == Decimal("2")
    assert summary.half_days == Decimal("1")
    assert summary.late_days == Decimal("1")
    # A half day is half a day of lost pay, and lateness on its own is not.
    assert summary.unpaid_days == Decimal("2.5")


def test_paid_leave_does_not_reduce_pay_and_unpaid_leave_does(company, payroll_setup):
    """The entire meaning of `LeaveType.is_paid`."""
    emp = payroll_setup["emp"]
    _leave(emp, 5, 7, paid=True)
    _leave(emp, 10, 11, paid=False)

    summary = get_period_attendance(emp, *PERIOD)

    assert summary.paid_leave_days == Decimal("3")
    assert summary.unpaid_leave_days == Decimal("2")
    assert summary.unpaid_days == Decimal("2")


def test_pending_leave_is_not_counted(company, payroll_setup):
    """A request is not time off. Docking pay for leave nobody approved would
    let an employee reduce their own salary by filing a form and waiting."""
    emp = payroll_setup["emp"]
    _leave(emp, 5, 9, paid=False, status=LeaveRequest.Status.PENDING)
    summary = get_period_attendance(emp, *PERIOD)

    assert summary.unpaid_leave_days == Decimal("0")


def test_leave_straddling_the_month_boundary_is_split(company, payroll_setup):
    """Only the days inside the period count.

    A request from 28 July to 3 August belongs partly to each period. Charging
    the whole thing to one of them is a visible error on somebody's payslip,
    and the direction of the error depends on which month you happen to run.
    """
    emp = payroll_setup["emp"]
    leave_type, _ = LeaveType.objects.get_or_create(
        name="Unpaid", defaults={"is_paid": False, "code": "unpaid"}
    )
    LeaveRequest.objects.create(
        employee=emp, leave_type=leave_type,
        start_date=date(YEAR, 7, 28), end_date=date(YEAR, 8, 3),
        days_requested=Decimal("7"), status=LeaveRequest.Status.APPROVED, is_paid=False,
    )
    summary = get_period_attendance(emp, *PERIOD)

    # 1, 2, 3 August — not the July half.
    assert summary.unpaid_leave_days == Decimal("3")


def test_a_half_day_leave_request_counts_as_half(company, payroll_setup):
    emp = payroll_setup["emp"]
    _leave(emp, 12, 12, paid=False, half_day=True)
    summary = get_period_attendance(emp, *PERIOD)

    assert summary.unpaid_leave_days == Decimal("0.5")


# ── Overtime ─────────────────────────────────────────────────────────────


def test_only_approved_overtime_reaches_payroll(company, payroll_setup):
    """Staying late is not authorised overtime.

    If pending and rejected rows counted, every unapproved claim would become a
    cost the company never agreed to — and the approval step would be theatre.
    """
    emp = payroll_setup["emp"]
    OvertimeRecord.objects.create(
        employee=emp, date=date(YEAR, MONTH, 4), hours=Decimal("3"),
        status=OvertimeRecord.Status.APPROVED,
    )
    OvertimeRecord.objects.create(
        employee=emp, date=date(YEAR, MONTH, 5), hours=Decimal("5"),
        status=OvertimeRecord.Status.PENDING,
    )
    OvertimeRecord.objects.create(
        employee=emp, date=date(YEAR, MONTH, 6), hours=Decimal("8"),
        status=OvertimeRecord.Status.REJECTED,
    )
    summary = get_period_attendance(emp, *PERIOD)

    assert summary.overtime_hours == Decimal("3")


def test_overtime_outside_the_period_is_excluded(company, payroll_setup):
    emp = payroll_setup["emp"]
    OvertimeRecord.objects.create(
        employee=emp, date=date(YEAR, 7, 31), hours=Decimal("4"),
        status=OvertimeRecord.Status.APPROVED,
    )
    summary = get_period_attendance(emp, *PERIOD)

    assert summary.overtime_hours == Decimal("0")


# ── Night shifts ─────────────────────────────────────────────────────────


def test_night_allowance_is_earned_per_night_actually_worked(company, payroll_setup):
    """Rostered is not the same as worked.

    Somebody assigned to nights who was absent has not earned the allowance,
    so this counts attendance rows rather than assigned calendar days.
    """
    emp = payroll_setup["emp"]
    shift = Shift.objects.create(
        name="Night", start_time="22:00", end_time="06:00",
        is_night_shift=True, night_allowance=Decimal("500"),
    )
    ShiftAssignment.objects.create(
        employee=emp, shift=shift, start_date=date(YEAR, MONTH, 1)
    )
    _log(emp, 2, AttendanceLog.Status.PRESENT)
    _log(emp, 3, AttendanceLog.Status.LATE)      # late is still worked
    _log(emp, 4, AttendanceLog.Status.ABSENT)    # not worked
    summary = get_period_attendance(emp, *PERIOD)

    assert summary.night_shifts == 2


def test_a_day_shift_earns_no_night_allowance(company, payroll_setup):
    emp = payroll_setup["emp"]
    shift = Shift.objects.create(
        name="Day", start_time="09:00", end_time="17:00",
        is_night_shift=False, night_allowance=Decimal("500"),
    )
    ShiftAssignment.objects.create(
        employee=emp, shift=shift, start_date=date(YEAR, MONTH, 1)
    )
    _log(emp, 2, AttendanceLog.Status.PRESENT)
    summary = get_period_attendance(emp, *PERIOD)

    assert summary.night_shifts == 0


# ── Reaching the payslip ─────────────────────────────────────────────────


def test_absence_reduces_only_the_components_marked_for_it(company, payroll_setup):
    """The per-component decision, which is the whole reason for the flag.

    Basic is reduced by a day not worked; a fixed transport allowance is not.
    A single company-wide rule forces the company to be wrong about one of them.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    basic = SalaryComponent.objects.get(code="basic")
    basic.reduced_by_absence = True
    basic.save(update_fields=["reduced_by_absence"])

    transport = SalaryComponent.objects.create(
        code="transport", name="Transport",
        component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.FLAT,
        amount=Decimal("3100"), is_active=True, order=5,
        reduced_by_absence=False,
    )
    structure = emp.salary_structures.latest("effective_from")
    structure.assignments.create(component=transport, amount=Decimal("3100"))

    _leave(emp, 5, 7, paid=False)  # 3 unpaid days of 31

    payslip = compute_payslip(run, emp)
    lines = {li.component_code: li.amount for li in payslip.line_items.all()}

    # 50,000 × 28/31
    assert lines["basic"] == Decimal("45161.29")
    # Untouched — the flag is off.
    assert lines["transport"] == Decimal("3100.00")


def test_the_absence_default_is_off_so_existing_structures_do_not_change(company, payroll_setup):
    """The migration-safety property, asserted rather than assumed.

    Every component predating this field has `reduced_by_absence=False`. If the
    default had been True, deploying this would have silently cut pay for
    everyone with an absence — the worst possible default in payroll.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    _leave(emp, 5, 9, paid=False)  # 5 unpaid days
    payslip = compute_payslip(run, emp)
    basic = payslip.line_items.get(component_code="basic")

    assert basic.amount == Decimal("50000.00")


def test_attendance_figures_are_available_to_formula_components(company, payroll_setup):
    """The 'rules as data' seam: a company writes overtime pay themselves.

    If these names were not in the context the formula would raise, so this
    also pins them as a contract — renaming one silently breaks the company
    formula that used it.
    """
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    overtime_pay = SalaryComponent.objects.create(
        code="ot_pay", name="Overtime",
        component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.FORMULA,
        formula="basic / (period_days * 8) * overtime_hours * overtime_multiplier",
        is_active=True, order=6,
    )
    night_pay = SalaryComponent.objects.create(
        code="night_pay", name="Night allowance",
        component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.FORMULA,
        formula="night_shifts * night_allowance",
        is_active=True, order=7,
    )
    structure = emp.salary_structures.latest("effective_from")
    structure.assignments.create(component=overtime_pay, amount=None)
    structure.assignments.create(component=night_pay, amount=None)

    OvertimeRecord.objects.create(
        employee=emp, date=date(YEAR, MONTH, 4), hours=Decimal("10"),
        status=OvertimeRecord.Status.APPROVED,
    )
    shift = Shift.objects.create(
        name="Night", start_time="22:00", end_time="06:00",
        is_night_shift=True, night_allowance=Decimal("400"),
    )
    ShiftAssignment.objects.create(employee=emp, shift=shift, start_date=date(YEAR, MONTH, 1))
    _log(emp, 2, AttendanceLog.Status.PRESENT)
    _log(emp, 3, AttendanceLog.Status.PRESENT)

    payslip = compute_payslip(run, emp)
    lines = {li.component_code: li.amount for li in payslip.line_items.all()}

    # 50,000 / (31 × 8) = 201.61 hourly; × 10 hours × 1.5 = 3,024.19
    assert lines["ot_pay"] == Decimal("3024.19")
    # Two nights worked × 400
    assert lines["night_pay"] == Decimal("800.00")


def test_absence_and_joining_mid_month_both_apply(company, payroll_setup, admin_user):
    """The two factors compose rather than one overwriting the other.

    They answer different questions — how much of the month you were employed,
    and how much of that you were paid for. Someone who joined partway through
    and then took unpaid leave has both, and collapsing them into a single
    number loses one.
    """

    emp = payroll_setup["emp"]
    basic = SalaryComponent.objects.get(code="basic")
    basic.reduced_by_absence = True
    basic.save(update_fields=["reduced_by_absence"])

    # Joined on the 17th: 15 of 31 days employed.
    emp.date_joined = date(YEAR, MONTH, 17)
    emp.save(update_fields=["date_joined"])
    structure = emp.salary_structures.latest("effective_from")
    structure.effective_from = date(YEAR, MONTH, 17)
    structure.save(update_fields=["effective_from"])

    _leave(emp, 20, 21, paid=False)  # 2 unpaid days

    payslip = compute_payslip(payroll_setup["run"], emp)
    basic_line = payslip.line_items.get(component_code="basic")

    # 50,000 × (15/31 employed) × (29/31 attended)
    expected = (Decimal("50000") * Decimal(15) / Decimal(31)) * (Decimal(29) / Decimal(31))
    assert abs(basic_line.amount - expected) < Decimal("0.02")
