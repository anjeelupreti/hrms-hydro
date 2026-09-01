"""A clock left running overnight.

Nothing closed an open session, so a forgotten clock-out ran for days. It is
not merely untidy: `seconds_worked` returns 0 for an open session — on purpose,
because a total that changes every time you read it cannot be summed — so the
day's hours were **lost entirely** and payroll read it as though nobody worked.
"""

from datetime import date, datetime, time, timedelta

import pytest
from django.utils import timezone

from attendance.models import AttendanceLog, AttendanceSession
from attendance.punches import close_stale_sessions, day_summary, record_presence
from employees.models import Employee
from organization.models import CompanyProfile

pytestmark = pytest.mark.django_db


@pytest.fixture
def person(company, admin_user):
    yield Employee.objects.create(
        user=admin_user, employee_code="EMP-CLOCK", date_joined=date(2020, 1, 1)
    )


def _open_session(person, day, at=time(9, 0)):
    log = AttendanceLog.objects.create(
        employee=person, date=day, status=AttendanceLog.Status.PRESENT
    )
    return AttendanceSession.objects.create(
        log=log, check_in_time=timezone.make_aware(datetime.combine(day, at))
    )


def test_yesterdays_open_session_is_closed(company, person):
    yesterday = timezone.localdate() - timedelta(days=1)
    session = _open_session(person, yesterday)

    assert close_stale_sessions() == 1

    session.refresh_from_db()
    assert session.check_out_time is not None
    assert session.auto_closed is True
    # And the day now has hours, where before it had none.
    assert session.seconds_worked > 0


def test_todays_open_session_is_left_alone(company, person):
    """🔒 Somebody currently at work must not be clocked out from under them.

    The sweep runs on read as well as on a schedule, so this is not a corner
    case — it fires every time anybody opens the clock widget.
    """
    session = _open_session(person, timezone.localdate())

    assert close_stale_sessions() == 0

    session.refresh_from_db()
    assert session.check_out_time is None
    assert session.auto_closed is False


def test_it_closes_at_the_office_end_not_midnight(company, person):
    """**Midnight is the wrong answer**, and it was the obvious one.

    Closing at 00:00 credits somebody who forgot with fifteen hours — turning a
    missing record into an inflated one, which is harder to catch because it
    looks like data. The office's own end time is the honest guess.
    """
    profile = CompanyProfile.get_solo()
    profile.office_end_time = time(18, 0)
    profile.save()

    yesterday = timezone.localdate() - timedelta(days=1)
    session = _open_session(person, yesterday, at=time(9, 0))

    close_stale_sessions()

    session.refresh_from_db()
    assert timezone.localtime(session.check_out_time).hour == 18
    # Nine hours, not fifteen.
    assert session.seconds_worked == 9 * 3600


def test_a_night_shift_is_not_closed_before_it_started(company, person):
    """🔒 Somebody who clocked in at 22:00 must not be clocked out at 18:00 the
    same evening — that is a negative day, and `seconds_worked` would go
    backwards."""
    profile = CompanyProfile.get_solo()
    profile.office_end_time = time(18, 0)
    profile.save()

    yesterday = timezone.localdate() - timedelta(days=1)
    session = _open_session(person, yesterday, at=time(22, 0))

    close_stale_sessions()

    session.refresh_from_db()
    assert session.check_out_time >= session.check_in_time
    assert session.seconds_worked >= 0


def test_it_falls_back_to_end_of_day_without_office_hours(company, person):
    """`office_end_time` is nullable — a workspace that never sets one still
    needs its clocks to stop."""
    profile = CompanyProfile.get_solo()
    profile.office_end_time = None
    profile.save()

    yesterday = timezone.localdate() - timedelta(days=1)
    session = _open_session(person, yesterday)

    close_stale_sessions()

    session.refresh_from_db()
    assert session.check_out_time is not None
    assert timezone.localtime(session.check_out_time).date() == yesterday


def test_the_clock_widget_heals_itself(company, person):
    """The sweep runs on read too. A workspace with no Celery worker — a demo,
    a fresh install — would otherwise show a clock that had been running for
    days, and this is the exact screen somebody notices it on."""
    _open_session(person, timezone.localdate() - timedelta(days=3))

    summary = day_summary(person)

    # Today has nothing open, and the stale one is no longer running.
    assert summary["is_clocked_in"] is False
    assert AttendanceSession.objects.filter(check_out_time__isnull=True).count() == 0


def test_sweeping_twice_changes_nothing(company, person):
    """It runs nightly *and* on every read, so it has to be idempotent — a
    second pass must not move a time it already set."""
    session = _open_session(person, timezone.localdate() - timedelta(days=1))

    close_stale_sessions()
    session.refresh_from_db()
    first = session.check_out_time

    assert close_stale_sessions() == 0
    session.refresh_from_db()
    assert session.check_out_time == first


# ── Closing where the person actually stopped ────────────────────────────────


def test_it_closes_at_the_last_heartbeat_not_the_office_hour(company, person):
    """🔒 **This is what makes overtime survive.**

    A fixed office-end time truncates a late night: somebody who worked until
    21:40 would be recorded as leaving at 18:00, and the two hours they are owed
    would simply not exist. The last beat the browser sent is when they actually
    stopped, and it is the better answer whenever we have it.
    """
    profile = CompanyProfile.get_solo()
    profile.office_end_time = time(18, 0)
    profile.save()

    yesterday = timezone.localdate() - timedelta(days=1)
    session = _open_session(person, yesterday, at=time(9, 0))
    session.last_seen = timezone.make_aware(datetime.combine(yesterday, time(21, 40)))
    session.save(update_fields=["last_seen"])

    close_stale_sessions()

    session.refresh_from_db()
    assert timezone.localtime(session.check_out_time).hour == 21
    # Twelve hours and forty minutes, not the nine the office hour implies.
    assert session.seconds_worked == 12 * 3600 + 40 * 60


def test_a_beat_never_closes_anything(company, person):
    """It records presence. A heartbeat that could clock somebody out would
    make every dropped connection a clock-out."""
    session = _open_session(person, timezone.localdate())

    assert record_presence(person) is True

    session.refresh_from_db()
    assert session.check_out_time is None
    assert session.last_seen is not None


def test_a_beat_with_nothing_open_is_harmless(company, person):
    """A background timer pinging after somebody clocked out is not an error —
    it just means there was nothing to mark, and the client stops."""
    assert record_presence(person) is False


def test_a_stale_heartbeat_before_check_in_is_ignored(company, person):
    """Belt and braces: a `last_seen` older than the check-in would produce a
    negative day, and `seconds_worked` would run backwards."""
    yesterday = timezone.localdate() - timedelta(days=1)
    session = _open_session(person, yesterday, at=time(14, 0))
    session.last_seen = timezone.make_aware(datetime.combine(yesterday, time(9, 0)))
    session.save(update_fields=["last_seen"])

    close_stale_sessions()

    session.refresh_from_db()
    assert session.check_out_time >= session.check_in_time
    assert session.seconds_worked >= 0
