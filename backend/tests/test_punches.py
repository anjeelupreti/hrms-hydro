"""Clocking in and out as many times as a day actually has.

The product allowed one punch each way per day, so a lunch break could not be
recorded: the choice was to leave the break out or leave the afternoon out.

The tests that matter here are the **invariants**, not the happy path. A double
tap producing two open sessions would silently double somebody's day, and a
clock-out that lands before its clock-in would quietly subtract from it. Both
are the kind of arithmetic error nobody notices until payroll.
"""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from attendance.models import AttendanceLog, AttendanceSession
from attendance.policy import AttendancePolicy, AttendanceSourceError
from attendance.punches import PunchError, close_session, day_summary, open_session
from employees.models import Employee

pytestmark = pytest.mark.django_db


@pytest.fixture
def person(company, employee_user):
    yield Employee.objects.create(
        user=employee_user, employee_code="EMP-5001", date_joined=date(2026, 1, 1)
    )


def _at(hour, minute=0):
    """A time today, in the company's own timezone."""
    return timezone.make_aware(
        timezone.datetime.combine(
            timezone.localdate(), timezone.datetime.min.time().replace(hour=hour, minute=minute)
        ),
        timezone.get_current_timezone(),
    )


# ── A day with breaks in it ──────────────────────────────────────────────


def test_a_day_can_hold_several_punches(company, person):
    """The whole point. Morning, lunch, afternoon."""
    open_session(person, at=_at(9))
    close_session(person, at=_at(13))
    open_session(person, at=_at(14))
    close_session(person, at=_at(18))

    summary = day_summary(person)

    assert summary["punches"] == 2
    assert summary["seconds_worked"] == 8 * 3600  # four hours, twice


def test_a_second_punch_does_not_create_a_second_day(company, person):
    """One day record, several sessions under it. Everything downstream —
    payroll included — still reads one row per person per day."""
    open_session(person, at=_at(9))
    close_session(person, at=_at(13))
    open_session(person, at=_at(14))

    assert AttendanceLog.objects.filter(employee=person).count() == 1
    assert AttendanceSession.objects.count() == 2


def test_lateness_is_judged_on_the_first_punch_only(company, person):
    """A second check-in after lunch is not somebody arriving late."""
    open_session(person, at=_at(9))
    status_after_first = AttendanceLog.objects.get(employee=person).status
    close_session(person, at=_at(13))
    open_session(person, at=_at(15))

    assert AttendanceLog.objects.get(employee=person).status == status_after_first


def test_turning_up_contradicts_an_absence(company, person):
    """🔒 The nightly sweep marks a day absent before anybody punches. Somebody
    arriving after it ran would otherwise stay "absent" all day while visibly
    clocked in — and payroll would dock them for a day they worked."""
    AttendanceLog.objects.create(
        employee=person, date=timezone.localdate(), status=AttendanceLog.Status.ABSENT
    )
    open_session(person, at=_at(9))

    assert AttendanceLog.objects.get(employee=person).status != AttendanceLog.Status.ABSENT


def test_a_half_day_is_not_overwritten_by_coming_back_from_lunch(company, person):
    """Half-day is a judgement somebody made. Recomputing on every punch would
    undo an HR correction the moment the person clocked back in."""
    open_session(person, at=_at(9))
    close_session(person, at=_at(12))

    log = AttendanceLog.objects.get(employee=person)
    log.status = AttendanceLog.Status.HALF_DAY
    log.save(update_fields=["status"])

    open_session(person, at=_at(13))

    assert AttendanceLog.objects.get(employee=person).status == AttendanceLog.Status.HALF_DAY


# ── The invariants ───────────────────────────────────────────────────────


def test_you_cannot_be_clocked_in_twice(company, person):
    """🔒 A double tap must not open two sessions — the day's total would
    silently double, and nothing downstream could tell."""
    open_session(person, at=_at(9))
    with pytest.raises(PunchError, match="already clocked in"):
        open_session(person, at=_at(9, 1))

    assert AttendanceSession.objects.filter(check_out_time__isnull=True).count() == 1


def test_clocking_out_with_nothing_open_is_refused(company, person):
    """Somebody pressing Out expects something to have happened. Silence would
    look identical to success."""
    open_session(person, at=_at(9))
    close_session(person, at=_at(13))

    with pytest.raises(PunchError, match="not clocked in"):
        close_session(person, at=_at(14))


def test_clocking_out_before_clocking_in_is_refused(company, person):
    """🔒 A device replaying an old event, or a wrong clock, would otherwise
    store a negative stretch that quietly reduces the day."""
    open_session(person, at=_at(14))
    with pytest.raises(PunchError, match="earlier than"):
        close_session(person, at=_at(9))


def test_clocking_out_without_ever_clocking_in_is_refused(company, person):
    with pytest.raises(PunchError, match="not clocked in today"):
        close_session(person)


# ── What the widget reads ────────────────────────────────────────────────


def test_an_untouched_day_reports_nothing_rather_than_failing(company, person):
    """The card renders before anybody has punched. Zeroes, not an error."""
    summary = day_summary(person)

    assert summary["is_clocked_in"] is False
    assert summary["punches"] == 0
    assert summary["seconds_worked"] == 0
    assert summary["open_since"] is None


def test_an_open_session_reports_when_it_started(company, person):
    """The screen counts up from this. Serving the total instead would give a
    number that changes between two reads a second apart."""
    open_session(person, at=_at(9))
    summary = day_summary(person)

    assert summary["is_clocked_in"] is True
    assert summary["open_since"] == _at(9)
    assert summary["seconds_worked"] == 0  # nothing finished yet


def test_the_running_stretch_is_excluded_from_the_total(company, person):
    """Closed sessions only, so the figure is stable enough to compare."""
    open_session(person, at=_at(9))
    close_session(person, at=_at(12))
    open_session(person, at=_at(13))

    summary = day_summary(person)

    assert summary["seconds_worked"] == 3 * 3600
    assert summary["is_clocked_in"] is True


def test_sessions_come_back_in_the_order_they_happened(company, person):
    """A timeline out of order is worse than no timeline."""
    open_session(person, at=_at(9))
    close_session(person, at=_at(12))
    open_session(person, at=_at(13))
    close_session(person, at=_at(17))

    times = [s.check_in_time for s in day_summary(person)["sessions"]]

    assert times == sorted(times)


# ── The policy still applies ─────────────────────────────────────────────


def test_a_forbidden_source_is_refused_on_every_punch(company, person):
    """Not just the first one of the day — otherwise turning web check-in off
    stops nothing after somebody's morning punch."""
    open_session(person, at=_at(9))
    close_session(person, at=_at(12))

    AttendancePolicy.objects.create(allow_web=False)

    with pytest.raises(AttendanceSourceError):
        open_session(person, at=_at(13))


def test_hr_can_still_record_a_punch_when_the_policy_forbids_it(company, person):
    """The rule that stops a policy becoming an outage."""
    AttendancePolicy.objects.create(allow_web=False, allow_biometric=False)
    session = open_session(person, at=_at(9), by_hr=True)

    assert session.pk is not None


# ── Notes ────────────────────────────────────────────────────────────────


def test_a_punch_can_say_what_it_was(company, person):
    """"Client visit" is the difference between a gap that needs explaining and
    one that already is."""
    open_session(person, at=_at(9), note="Client visit — Everest Traders")
    summary = day_summary(person)

    assert summary["sessions"][0].note.startswith("Client visit")


def test_yesterdays_punches_do_not_leak_into_today(company, person):
    """Each day stands alone, or an open session left over from last night
    makes somebody look permanently clocked in."""
    yesterday = timezone.localdate() - timedelta(days=1)
    log = AttendanceLog.objects.create(
        employee=person, date=yesterday, status=AttendanceLog.Status.PRESENT
    )
    AttendanceSession.objects.create(log=log, check_in_time=_at(9) - timedelta(days=1))

    summary = day_summary(person)

    assert summary["is_clocked_in"] is False
    assert summary["punches"] == 0
