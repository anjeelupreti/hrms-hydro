from datetime import datetime, timedelta

from django.db.models import Q
from django.utils import timezone

from attendance.models import AttendanceLog, ShiftAssignment


def compute_check_in_status(employee, on_date, check_in_dt):
    """PRESENT, or LATE past the applicable start time plus its grace period.

    **Which start time applies — D24, settled 25 August.** An assigned `Shift`
    wins, because a night-shift worker must be judged against their night
    shift. Where there is none, the **company's opening hours** apply: most
    staff are never assigned a shift at all, they simply come in when the office
    opens, and judging lateness only for shift workers is a rule nobody would
    recognise as fair.

    **A company with no opening hours set is never late**, which keeps this
    additive: a company that has not answered the question behaves exactly as it
    did before the field existed. "No opinion" and "nine o'clock" are different
    answers, and a default would invent a schedule and then dock pay under it.
    """
    assignment = (
        ShiftAssignment.objects.filter(employee=employee, start_date__lte=on_date)
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=on_date))
        .select_related("shift")
        .order_by("-start_date")
        .first()
    )

    if assignment:
        start_time = assignment.shift.start_time
        grace = assignment.shift.grace_period_minutes
    else:
        start_time, grace = _office_hours()
        if start_time is None:
            return AttendanceLog.Status.PRESENT

    threshold = (
        datetime.combine(on_date, start_time) + timedelta(minutes=grace)
    ).time()
    if timezone.localtime(check_in_dt).time() > threshold:
        return AttendanceLog.Status.LATE
    return AttendanceLog.Status.PRESENT


def _office_hours():
    """The company's opening time and tolerance, or `(None, 0)` if unset.

    Read defensively: a missing profile mid-provisioning must not make clocking
    in fail. Nobody being marked late is the safe direction — the unsafe one is
    marking somebody late against a time that was never configured.
    """
    try:
        from organization.models import CompanyProfile

        profile = CompanyProfile.objects.first()
        if profile is None or profile.office_start_time is None:
            return None, 0
        return profile.office_start_time, profile.office_grace_period_minutes
    except Exception:  # noqa: BLE001 — see the docstring
        return None, 0


def compute_overtime(employee, on_date, check_in_dt, check_out_dt):
    """
    Returns the number of overtime/comp-off minutes. Overtime is calculated 
    as the total time worked minus the shift duration.
    If the employee has no shift on this day (e.g. weekend/holiday), 
    the entire duration is returned as comp-off minutes.
    """
    if not check_in_dt or not check_out_dt:
        return 0
        
    duration = check_out_dt - check_in_dt
    duration_minutes = duration.total_seconds() / 60
    
    assignment = (
        ShiftAssignment.objects.filter(employee=employee, start_date__lte=on_date)
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=on_date))
        .select_related("shift")
        .order_by("-start_date")
        .first()
    )
    
    if not assignment:
        # No shift assigned = day off. All worked time is comp-off.
        return int(max(0, duration_minutes))
        
    shift = assignment.shift
    start = datetime.combine(on_date, shift.start_time)
    end = datetime.combine(on_date, shift.end_time)
    if end < start:
        end += timedelta(days=1)
        
    shift_duration_minutes = (end - start).total_seconds() / 60
    
    overtime = duration_minutes - shift_duration_minutes
    if overtime > 0:
        return int(overtime)
    return 0
