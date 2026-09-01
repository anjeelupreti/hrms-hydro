"""What a payroll period looks like from attendance's side.

**One function, one shape, one place.** Payroll needs to know how many days
someone was absent, how much unpaid leave they took, how many approved overtime
hours they worked and how many night shifts they covered. Each of those has a
different source and a different set of edge cases, and computing them inline in
`compute_payslip` would put four subtle questions inside a function that already
answers a fifth.

Everything here is **read-only and derived**. Nothing in this module writes, so
running payroll twice cannot change what attendance says happened.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal


@dataclass(frozen=True)
class PeriodAttendance:
    """Attendance and leave for one employee over one payroll period.

    Days are `Decimal`, not `int`, because a half day is genuinely half a day
    and rounding it at this stage would move money.
    """

    period_days: int
    #: Days in the period the company actually works — the period minus its
    #: weekends and public holidays. Equal to `period_days` when the company has
    #: not configured a working week, so a company that never set one keeps
    #: exactly the arithmetic it had.
    working_days: int
    absent_days: Decimal
    half_days: Decimal
    late_days: Decimal
    paid_leave_days: Decimal
    unpaid_leave_days: Decimal
    overtime_hours: Decimal
    night_shifts: int

    # ── Reflection, not deduction ────────────────────────────────────────
    #
    # People clock out for a hundred reasons and most of them are nobody's
    # business — a bank, a school run, a client across town. Docking pay by the
    # hour would turn every one of those into an argument, so hours worked
    # never touch the money. Only three things do: absence, unpaid leave, and a
    # half day. That is `unpaid_days` above and it is deliberately short.
    #
    # These four are here so the payslip can *show* somebody their month
    # without charging them for it.
    days_attended: int = 0
    hours_worked: Decimal = Decimal("0")
    #: Days worked below half the rostered shift. This is what makes a half
    #: day, and above it the shortfall is excused rather than measured.
    short_days: Decimal = Decimal("0")

    @property
    def average_hours_per_day(self) -> Decimal:
        """Across days actually attended, not across the period.

        Dividing by period days would mix a short month, a holiday and a
        resignation into the same figure and produce a number that means
        nothing — somebody who worked eight hours on each of the four days they
        were in did not average one hour a day.
        """
        if not self.days_attended:
            return Decimal("0")
        return (self.hours_worked / Decimal(self.days_attended)).quantize(Decimal("0.01"))

    @property
    def unpaid_days(self) -> Decimal:
        """Total days that should not be paid.

        Absence and unpaid leave both land here; a half day counts as half.
        Paid leave deliberately does not — that is the entire meaning of the
        `is_paid` flag on the leave type.
        """
        return self.absent_days + self.unpaid_leave_days + (self.half_days / Decimal("2"))


def _overlap_days(start, end, period_start, period_end, countable=None) -> Decimal:
    """Days of [start, end] that fall inside the period, inclusive.

    Leave requests routinely straddle a month boundary — a request from the
    28th to the 3rd belongs partly to each period, and charging the whole thing
    to one of them is a visible error on somebody's payslip.

    `countable`, when given, is the set of dates that may be charged at all —
    the period's working days. Leave taken across a weekend then costs what the
    leave ledger charged for it rather than the calendar span, so the days
    deducted from somebody's pay and the days deducted from their balance are
    the same days.
    """
    lo = max(start, period_start)
    hi = min(end, period_end)
    if hi < lo:
        return Decimal("0")
    if countable is None:
        return Decimal((hi - lo).days + 1)
    days = 0
    day = lo
    while day <= hi:
        if day in countable:
            days += 1
        day += timedelta(days=1)
    return Decimal(days)


def _rostered_seconds(employee, period_start: date, period_end: date) -> int:
    """How long the working day is, for the shift this person is actually on.

    Returns 0 when nobody has rostered them, and 0 means "do not infer half
    days". A company that has not set up shifts has not told us what a full day
    is, and guessing eight hours would start docking pay on an assumption they
    never made.

    A night shift wraps midnight, so the end time is the smaller number —
    subtracting naively gives a negative day.
    """
    from attendance.models import ShiftAssignment

    assignment = (
        ShiftAssignment.objects.filter(employee=employee, start_date__lte=period_end)
        .exclude(end_date__lt=period_start)
        .select_related("shift")
        .order_by("-start_date")
        .first()
    )
    if assignment is None:
        return 0
    shift = assignment.shift
    start = shift.start_time.hour * 3600 + shift.start_time.minute * 60
    end = shift.end_time.hour * 3600 + shift.end_time.minute * 60
    return end - start if end > start else (86400 - start) + end


def get_period_attendance(
    employee, period_start: date, period_end: date, *, working_only: bool = False
) -> PeriodAttendance:
    """Summarise one employee's period. Never raises on missing data.

    A company that has not adopted attendance yet must still be able to run
    payroll: absent everything, this returns zeros, and a structure with no
    attendance-driven components pays exactly what it always did.

    **Takes the window, not a year and a month.** Deriving 1–31 August from two
    numbers with `monthrange` is both a fifth copy of that derivation and, on a
    Bikram Sambat company, the wrong month — payroll would prorate over one
    window and count absences over another. The caller owns the period; this
    only reads it (D‑06).

    **`working_only` restricts what may be charged to days the company works.**
    Payroll passes it on both pay bases, because a day the company does not work
    cannot be a day of work missed — that is true whether a day is valued at
    `salary / 31` or `salary / 21`. The pay basis decides the *divisor*, not
    which days count, and `working_days` is reported so the caller can use
    whichever it means.

    Left off, every day in a span counts. That is the raw calendar reading, kept
    for callers that genuinely want it.
    """
    # Imported here rather than at module scope: attendance is imported by
    # payroll, and leave imports employees, so a top-level import would close
    # a cycle at startup.
    from attendance.models import AttendanceLog, OvertimeRecord, ShiftAssignment
    from leave.models import LeaveRequest
    from leave.services import holidays_between, is_working_day, working_day_set

    period_days = (period_end - period_start).days + 1

    # The period's working days, as a set of dates. Built once: it is needed to
    # size the divisor and, on the working-day basis, to decide which days may
    # be charged at all.
    working_week = working_day_set()
    holidays = holidays_between(period_start, period_end)
    working_dates = set()
    cursor = period_start
    while cursor <= period_end:
        if is_working_day(cursor, working_week, holidays):
            working_dates.add(cursor)
        cursor += timedelta(days=1)
    countable = working_dates if working_only else None

    logs = AttendanceLog.objects.filter(
        employee=employee, date__gte=period_start, date__lte=period_end
    )
    counts = {status: Decimal("0") for status in ("absent", "half_day", "late")}
    for log_date, status in logs.values_list("date", "status"):
        if status not in counts:
            continue
        # An absence recorded on a day the company does not work cannot cost
        # anybody money on the working-day basis — the divisor never counted
        # that day, so charging for it takes pay for a day nobody was bought.
        if countable is not None and log_date not in countable:
            continue
        counts[status] += 1

    # Only APPROVED leave counts. A pending request is a request — treating it
    # as taken would dock pay for time off nobody has agreed to yet, and a
    # rejected one obviously must not.
    paid_leave = Decimal("0")
    unpaid_leave = Decimal("0")
    leave_requests = LeaveRequest.objects.filter(
        employee=employee,
        status=LeaveRequest.Status.APPROVED,
        start_date__lte=period_end,
        end_date__gte=period_start,
    ).select_related("leave_type")
    for request in leave_requests:
        days = _overlap_days(
            request.start_date, request.end_date, period_start, period_end, countable
        )
        if request.half_day:
            days = days / Decimal("2")
        # `is_paid` is read from the request, not the type: it was snapshotted
        # when the request was made (probation, for one, can make an otherwise
        # paid type unpaid), and re-deriving it from the type now would apply
        # today's policy to a decision taken months ago.
        if request.is_paid:
            paid_leave += days
        else:
            unpaid_leave += days

    overtime_hours = Decimal("0")
    for hours in OvertimeRecord.objects.filter(
        employee=employee,
        status=OvertimeRecord.Status.APPROVED,
        date__gte=period_start,
        date__lte=period_end,
    ).values_list("hours", flat=True):
        overtime_hours += hours

    # A night shift is only paid when it was actually worked, so this counts
    # attendance rows rather than assigned days — somebody rostered onto nights
    # who was absent all month has not earned the allowance.
    night_shifts = 0
    night_assignments = ShiftAssignment.objects.filter(
        employee=employee,
        shift__is_night_shift=True,
        start_date__lte=period_end,
    ).exclude(end_date__lt=period_start)
    if night_assignments.exists():
        worked_dates = set(
            logs.filter(
                status__in=[AttendanceLog.Status.PRESENT, AttendanceLog.Status.LATE]
            ).values_list("date", flat=True)
        )
        for assignment in night_assignments:
            window_start = max(assignment.start_date, period_start)
            window_end = min(assignment.end_date or period_end, period_end)
            night_shifts += sum(
                1 for worked in worked_dates if window_start <= worked <= window_end
            )

    # ── Hours actually worked, and what counts as half a day ─────────────
    #
    # Worked time is the sum of *closed* sessions, never last-out minus
    # first-in: somebody who went out for four hours in the middle worked five
    # hours, and the day row's two columns call that nine.
    #
    # A half day is a day worked below half the rostered shift. Above that the
    # shortfall is excused and never priced — people clock out for reasons that
    # are not the payroll engine's business, and charging by the hour turns
    # each of them into an argument.
    #
    # **Derived, not stored.** This does not write `HALF_DAY` back onto the
    # log. Payroll re-running must not rewrite what attendance says happened,
    # and a status somebody set by hand stays theirs — a day is a half day if
    # HR marked it *or* the hours fall short, counted once either way.
    shift_seconds = _rostered_seconds(employee, period_start, period_end)
    days_attended = 0
    worked_seconds = 0
    short_days = Decimal("0")
    marked_half = {
        d for d, s in logs.values_list("date", "status") if s == AttendanceLog.Status.HALF_DAY
    }
    for log in logs.prefetch_related("sessions"):
        day_seconds = sum(
            int((s.check_out_time - s.check_in_time).total_seconds())
            for s in log.sessions.all()
            if s.check_out_time
        )
        if day_seconds <= 0:
            continue
        days_attended += 1
        worked_seconds += day_seconds
        # `days_attended` and `hours_worked` count every day actually worked,
        # Saturdays included — they are reflection and never touch pay. A short
        # day is different: it becomes half a day of deduction, so on the
        # working-day basis it is only chargeable on a day the divisor counted.
        chargeable = countable is None or log.date in countable
        if (
            chargeable
            and shift_seconds
            and day_seconds < shift_seconds / 2
            and log.date not in marked_half
        ):
            short_days += 1

    return PeriodAttendance(
        period_days=period_days,
        working_days=len(working_dates),
        absent_days=counts["absent"],
        # Marked by hand plus fallen short by the clock, each day once.
        half_days=counts["half_day"] + short_days,
        late_days=counts["late"],
        paid_leave_days=paid_leave,
        unpaid_leave_days=unpaid_leave,
        overtime_hours=overtime_hours,
        night_shifts=night_shifts,
        days_attended=days_attended,
        hours_worked=(Decimal(worked_seconds) / Decimal("3600")).quantize(Decimal("0.01")),
        short_days=short_days,
    )
