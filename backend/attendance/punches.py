"""Clocking in and out, as many times a day as the day actually has.

**What this replaces.** Check-in wrote `AttendanceLog.check_in_time` and
check-out wrote `check_out_time`, one of each per day. A second check-in was
refused with "you've already checked in today", so a lunch break could not be
recorded — the choice was to leave the break out or leave the afternoon out.

**The shape now.** The day record still exists and still carries the status,
because payroll reads it. Underneath it sits a list of sessions: in, out, in,
out. The day's worked time is the sum of the closed ones.

**Two invariants, and both exist to keep the screen honest:**

- At most one session is open at a time. Without that, a double-tap on the
  button produces two open sessions and the day's total silently doubles.
- Punching out with nothing open is refused rather than ignored, because
  somebody pressing Out expects something to have happened.
"""

from django.db import transaction
from django.db.models import Q
from datetime import timedelta

from django.utils import timezone

from attendance.models import AttendanceLog, AttendanceSession, ShiftAssignment
from attendance.policy import require
from attendance.services import compute_check_in_status


class PunchError(Exception):
    """The punch cannot be recorded as things stand."""


def open_session(employee, *, actor=None, source=None, note="", at=None, by_hr=False):
    """Start a stretch of work. Creates the day record if this is the first one.

    Returns the new `AttendanceSession`.
    """
    source = source or AttendanceLog.Source.WEB
    require(source, employee=employee, by_hr=by_hr)

    now = at or timezone.now()
    today = timezone.localdate(now)

    with transaction.atomic():
        log, created = AttendanceLog.objects.get_or_create(
            employee=employee,
            date=today,
            defaults={
                "check_in_time": now,
                "source": source,
                # Lateness is judged on the *first* punch of the day. A second
                # one after lunch is not somebody arriving late.
                "status": compute_check_in_status(employee, today, now),
                "created_by": actor,
                "updated_by": actor,
            },
        )

        if log.sessions.filter(check_out_time__isnull=True).exists():
            raise PunchError("You are already clocked in. Clock out first.")

        session = AttendanceSession.objects.create(
            log=log,
            check_in_time=now,
            source=source,
            note=note,
            created_by=actor,
            updated_by=actor,
        )

        # Keep the day record's own columns meaningful for everything that
        # still reads them — the first punch in, and the last punch out. They
        # are a summary of the sessions rather than a second source of truth.
        changed = []
        if not created and log.check_in_time is None:
            log.check_in_time = now
            changed.append("check_in_time")

        # Turning up contradicts an absence. The nightly sweep marks a day
        # absent before anybody has punched, and somebody arriving after it ran
        # would otherwise stay "absent" all day while visibly clocked in — and
        # payroll would dock them for a day they worked.
        #
        # Only from ABSENT, and only on the first punch: HALF_DAY and LATE are
        # judgements somebody made, and overwriting them here would undo an HR
        # correction the moment the person clocked back in from lunch.
        if not created and log.status == AttendanceLog.Status.ABSENT and log.sessions.count() == 1:
            log.status = compute_check_in_status(employee, today, now)
            changed.append("status")

        if changed:
            log.updated_by = actor
            log.save(update_fields=[*changed, "updated_by", "updated_at"])

    return session


def close_session(employee, *, actor=None, at=None):
    """End the open stretch. Refuses when there is nothing open."""
    now = at or timezone.now()
    today = timezone.localdate(now)

    log = AttendanceLog.objects.filter(employee=employee, date=today).first()
    if log is None:
        raise PunchError("You have not clocked in today.")

    session = log.sessions.filter(check_out_time__isnull=True).order_by("-check_in_time").first()
    if session is None:
        raise PunchError("You are not clocked in.")

    if now < session.check_in_time:
        # Possible when a device replays an old event, or a clock is wrong.
        # Refusing beats storing a negative stretch that quietly reduces the
        # day's total.
        raise PunchError("That clock-out is earlier than the clock-in it would close.")

    with transaction.atomic():
        session.check_out_time = now
        session.updated_by = actor
        session.save(update_fields=["check_out_time", "updated_by", "updated_at"])

        log.check_out_time = now
        log.updated_by = actor
        log.save(update_fields=["check_out_time", "updated_by", "updated_at"])

    return session


def close_stale_sessions(*, today=None):
    """Close any session still open from a day that has ended.

    `punch` refuses a second check-in while one is open *for that day*, but a
    session left open on Sunday stays open by itself, and the person sees a
    clock that has been running for four days.

    It matters beyond tidiness: `seconds_worked` returns 0 for an open session —
    deliberately, because a total that changes every time you read it cannot be
    summed — so that day's hours are lost entirely and payroll reads the day as
    though nobody worked it.

    **Where the clock stops is a real decision, and midnight is the wrong
    answer.** Closing at 00:00 credits somebody who forgot with fifteen hours,
    which turns a missing record into an inflated one — and an inflated one is
    harder to catch, because it looks like data. The session is closed at the
    office's own end time instead, and only falls back to end-of-day where a
    workspace has not set one.

    **Every one is flagged.** `auto_closed` marks it as the system's guess, not
    somebody's punch, so the screen can say so and a correction can be raised
    against it. A tidy 18:00 that silently looks like a real clock-out is the
    thing this must not produce.
    """
    from datetime import datetime
    from datetime import time as dt_time

    from organization.models import CompanyProfile

    today = today or timezone.localdate()

    stale = list(
        AttendanceSession.objects.filter(check_out_time__isnull=True, log__date__lt=today)
        .select_related("log")
    )
    if not stale:
        return 0

    try:
        end_of_day = CompanyProfile.get_solo().office_end_time
    except Exception:  # noqa: BLE001 — a half-set-up workspace must still sweep
        end_of_day = None

    closed = 0
    for session in stale:
        day = session.log.date
        # **The last beat first.** If the browser told us when they were still
        # there, that is when they stopped — and it is right for a late night
        # in a way a fixed office-end time never is. Somebody who worked until
        # 21:40 gets 21:40, not 18:00, and the overtime survives.
        #
        # Only where nothing was heard do we fall back to the office's own end
        # time, and then to the last moment of the day.
        if session.last_seen and session.last_seen > session.check_in_time:
            candidate = session.last_seen
        else:
            candidate = timezone.make_aware(
                datetime.combine(day, end_of_day or dt_time(23, 59))
            )
        # Never before they clocked in — a night shift starting at 22:00 must
        # not be closed at 18:00 that evening.
        if candidate <= session.check_in_time:
            candidate = session.check_in_time

        session.check_out_time = candidate
        session.auto_closed = True
        closed += 1

    AttendanceSession.objects.bulk_update(stale, ["check_out_time", "auto_closed"])
    return closed


def record_presence(employee, *, at=None):
    """Note that somebody is still at work, on their open session.

    Called from the browser on a timer while the clock is running. **It is not
    a clock-out and it never closes anything** — it only records how far the
    session has got, so that if the tab is closed, the machine sleeps or the
    browser crashes, the sweep knows where to end it.

    Returns whether there was anything to mark, so the caller can stop beating
    once the session is closed rather than pinging a finished day forever.
    """
    at = at or timezone.now()
    log = AttendanceLog.objects.filter(
        employee=employee, date=timezone.localdate()
    ).first()
    if log is None:
        return False

    session = log.sessions.filter(check_out_time__isnull=True).first()
    if session is None:
        return False

    session.last_seen = at
    # `update_fields`, because this runs every minute per signed-in person and
    # has no business touching anything else on the row.
    session.save(update_fields=["last_seen"])
    return True


def working_day_seconds(employee, on_date=None):
    """How long this person's paid day is, in seconds.

    **Served rather than worked out in the browser.** The rule has three steps —
    the shift assigned for this date, else the company's office hours; minus the
    unpaid break, which the shift may override; refuse anything that comes out
    at or below zero — and a client re-implementing it is a second copy that
    will disagree the first time one of the three changes (§2.6).

    Returns `None` where the workspace has set no hours at all. That is a real
    state: `office_start_time` is nullable on purpose, and a dial that filled in
    9-to-5 on its own would be inventing its own denominator.
    """
    from datetime import datetime, timedelta

    from organization.models import CompanyProfile

    on_date = on_date or timezone.localdate()
    company = CompanyProfile.get_solo()

    start = end = None
    break_minutes = company.unpaid_break_minutes

    assignment = (
        ShiftAssignment.objects.filter(employee=employee, start_date__lte=on_date)
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=on_date))
        .select_related("shift")
        .order_by("-start_date")
        .first()
    )
    if assignment and assignment.shift:
        start, end = assignment.shift.start_time, assignment.shift.end_time
        # Null means "use the company's"; zero means "this shift has none",
        # which is a different statement.
        if assignment.shift.unpaid_break_minutes is not None:
            break_minutes = assignment.shift.unpaid_break_minutes
    elif company.office_start_time and company.office_end_time:
        start, end = company.office_start_time, company.office_end_time

    if start is None or end is None:
        return None

    base = datetime.combine(on_date, start)
    finish = datetime.combine(on_date, end)
    # A shift that ends before it starts crosses midnight.
    if finish <= base:
        finish += timedelta(days=1)

    seconds = int((finish - base).total_seconds()) - break_minutes * 60
    return seconds if seconds > 0 else None


def day_summary(employee, on_date=None):
    """Everything the clock widget needs, in one read.

    Deliberately one call: the widget was making a request for the day record
    and then having no way to ask "how long have I been in?", which is the
    question somebody actually looks at it for.
    """
    on_date = on_date or timezone.localdate()
    # Swept on read as well as on a schedule. The scheduled task is the proper
    # mechanism, but a workspace running without a worker — a demo, a fresh
    # install — would otherwise show a clock that has been running for days,
    # and this is the exact screen somebody notices it on.
    close_stale_sessions(today=on_date)
    log = (
        AttendanceLog.objects.filter(employee=employee, date=on_date)
        .prefetch_related("sessions")
        .first()
    )
    if log is None:
        return {
            "date": on_date,
            "status": None,
            "sessions": [],
            "seconds_worked": 0,
            "open_since": None,
            "is_clocked_in": False,
            "punches": 0,
            "working_day_seconds": working_day_seconds(employee, on_date),
        }

    sessions = list(log.sessions.all())
    open_session_row = next((s for s in sessions if s.is_open), None)

    return {
        "date": on_date,
        "status": log.status,
        "sessions": sessions,
        # Closed time only. The screen adds the running stretch itself, so the
        # number here stays the same between two reads a second apart.
        "seconds_worked": sum(s.seconds_worked for s in sessions),
        "open_since": open_session_row.check_in_time if open_session_row else None,
        "is_clocked_in": open_session_row is not None,
        "punches": len(sessions),
        # What a full day is for *this* person on *this* date — their shift if
        # they have one, else the company's hours, minus the unpaid break.
        "working_day_seconds": working_day_seconds(employee, on_date),
    }


def day_history(employee, start, end):
    """The same day shape as `day_summary`, for a range of days.

    **One query for the range, not one per day.** A month view asking
    `day_summary` thirty-one times is thirty-one round trips to render one
    list — the exact shape §L3 and the shared primitives exist to prevent.

    **Only days with a record.** A day nobody clocked in on is either a
    weekend, a holiday or an absence, and which of those it is belongs to the
    calendar and the absence sweep rather than to a punch list. Inventing empty
    rows here would put "no punches" against every Saturday and bury the day
    somebody actually forgot to clock out.
    """
    logs = (
        AttendanceLog.objects.filter(employee=employee, date__gte=start, date__lte=end)
        .prefetch_related("sessions")
        .order_by("-date")
    )

    out = []
    for log in logs:
        sessions = list(log.sessions.all())
        open_row = next((s for s in sessions if s.is_open), None)
        out.append(
            {
                "date": log.date,
                "status": log.status,
                "sessions": sessions,
                "seconds_worked": sum(s.seconds_worked for s in sessions),
                "open_since": open_row.check_in_time if open_row else None,
                "is_clocked_in": open_row is not None,
                "punches": len(sessions),
            }
        )
    return out
