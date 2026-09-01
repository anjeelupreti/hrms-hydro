"""Scheduled attendance work.

One sweep: a day that has ended cannot still be in progress, so any session
still open from a previous day is closed — at the last heartbeat where there
was one, else the office's own end time. See `close_stale_sessions`.

**Why there is no "they closed the tab" sweep.** One was built and removed the
same day. A browser heartbeat can only measure whether somebody is *using the
HRMS*, and nobody in this company is: they run a powerhouse, survey a
transmission line, sit in a meeting with the laptop shut. Silence in the tab is
not absence from work, and a sweep acting on it would clock people out mid-shift
and turn a missing record into a wrong one — which is harder to catch, because
it looks like data. Presence that is actually presence comes from the biometric
devices, which `attendance/devices` already ingests. Manual clock in/out is the
honest fallback until then.

The heartbeat itself stays: `close_stale_sessions` uses `last_seen` to decide
*where* to close a forgotten session, so somebody who worked until 21:40 gets
21:40 rather than the office's 18:00.
"""

from celery import shared_task


@shared_task
def sweep_open_sessions():
    """Close yesterday's forgotten clock-outs.

    `day_summary` also calls the sweep on read, so a deployment with no worker
    running still self-heals the moment somebody opens the screen. This is the
    proper mechanism: it fixes the record for *everybody*, including the people
    who did not log in that day and whose hours would otherwise sit at zero
    until they happened to look.
    """
    from attendance.punches import close_stale_sessions

    closed = close_stale_sessions()
    return f"closed {closed} open session(s)"


