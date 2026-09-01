"""An employee's own punch history — the portal's record of when they were in.

**Why this is its own endpoint rather than a filter on the attendance list.**
That list is HR's, and it is gated as HR's. Somebody's arrival times are a
record of their movements, so the employee-facing route answers for the caller
and takes no `?employee=` at all — a parameter here would be a second, ungated
way to the same data.
"""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from attendance.models import AttendanceLog, AttendanceSession
from employees.models import Employee

pytestmark = pytest.mark.django_db

URL = "/api/v1/attendance/logs/my-history/"


@pytest.fixture
def worker(company, employee_user):
    yield Employee.objects.create(
        user=employee_user, employee_code="EMP-700", date_joined=date(2026, 1, 1)
    )


def _day_with_punches(employee, on_date, pairs):
    """A day record with closed sessions, built the way the service would."""
    log = AttendanceLog.objects.create(
        employee=employee, date=on_date, status=AttendanceLog.Status.PRESENT
    )
    for start_hour, end_hour in pairs:
        AttendanceSession.objects.create(
            log=log,
            check_in_time=timezone.make_aware(
                timezone.datetime.combine(on_date, timezone.datetime.min.time())
            )
            + timedelta(hours=start_hour),
            check_out_time=timezone.make_aware(
                timezone.datetime.combine(on_date, timezone.datetime.min.time())
            )
            + timedelta(hours=end_hour),
        )
    return log


def test_the_history_returns_a_day_per_record_newest_first(company, worker, employee_client):
    today = timezone.localdate()
    _day_with_punches(worker, today - timedelta(days=2), [(9, 13), (14, 18)])
    _day_with_punches(worker, today - timedelta(days=1), [(9, 17)])

    response = employee_client.get(URL)

    assert response.status_code == 200
    days = response.data["days"]
    assert len(days) == 2
    assert days[0]["date"] > days[1]["date"]
    # The lunch break is visible as two punches rather than one long day —
    # the whole reason sessions exist beneath the day record.
    assert days[1]["punches"] == 2


def test_days_with_no_record_are_left_out_rather_than_invented(
    company, worker, employee_client
):
    """A day nobody clocked in on is a weekend, a holiday or an absence, and
    which of those it is belongs to the calendar and the absence sweep.

    Inventing empty rows would put "no punches" against every Saturday and bury
    the day somebody actually forgot to clock out.
    """
    today = timezone.localdate()
    _day_with_punches(worker, today - timedelta(days=5), [(9, 17)])

    response = employee_client.get(URL)

    assert len(response.data["days"]) == 1
    assert response.data["days_with_punches"] == 1


def test_the_total_is_served_not_summed_in_the_browser(company, worker, employee_client):
    """§2.6 — a total computed over one page is not a fact about the range."""
    today = timezone.localdate()
    _day_with_punches(worker, today - timedelta(days=1), [(9, 13)])  # 4h
    _day_with_punches(worker, today - timedelta(days=2), [(9, 12)])  # 3h

    response = employee_client.get(URL)

    assert response.data["seconds_worked"] == 7 * 3600


def test_an_open_session_reads_as_still_clocked_in(company, worker, employee_client):
    """A missing clock-out is a fact the screen shows, not an error."""
    today = timezone.localdate()
    log = AttendanceLog.objects.create(
        employee=worker, date=today, status=AttendanceLog.Status.PRESENT
    )
    AttendanceSession.objects.create(
        log=log, check_in_time=timezone.now() - timedelta(hours=2)
    )

    response = employee_client.get(URL)

    day = response.data["days"][0]
    assert day["is_clocked_in"] is True
    assert day["open_since"] is not None
    # Closed time only, so the number does not move between two reads.
    assert day["seconds_worked"] == 0


def test_a_range_can_be_asked_for_and_is_capped(company, worker, employee_client):
    """An unbounded range over a busy company is a slow query nobody asked for —
    the same reason the date-conversion batch endpoint refuses one."""
    today = timezone.localdate()

    ok = employee_client.get(f"{URL}?start={today - timedelta(days=10)}&end={today}")
    assert ok.status_code == 200

    too_wide = employee_client.get(f"{URL}?start={today - timedelta(days=400)}&end={today}")
    assert too_wide.status_code == 400
    assert "92" in str(too_wide.data)


def test_a_backwards_range_is_refused_rather_than_silently_empty(
    company, worker, employee_client
):
    today = timezone.localdate()

    response = employee_client.get(f"{URL}?start={today}&end={today - timedelta(days=5)}")

    assert response.status_code == 400


def test_a_bad_date_is_refused_rather_than_falling_back(company, worker, employee_client):
    """A range quietly different from the one asked for is worse than an error,
    because the numbers still look plausible."""
    response = employee_client.get(f"{URL}?start=last-tuesday")

    assert response.status_code == 400
    assert "YYYY-MM-DD" in str(response.data)


def test_it_answers_for_the_caller_and_nobody_else(
    company, worker, employee_client, admin_user
):
    """🔒 No `?employee=`, so there is no ungated second route to somebody
    else's movements. Passing one changes nothing."""
    today = timezone.localdate()
    other = Employee.objects.create(
        user=admin_user, employee_code="EMP-701", date_joined=date(2026, 1, 1)
    )
    _day_with_punches(other, today - timedelta(days=1), [(9, 17)])

    response = employee_client.get(f"{URL}?employee={other.id}")

    assert response.status_code == 200
    assert response.data["days"] == []


def test_an_account_with_no_employee_record_gets_an_honest_answer(
    company, employee_client
):
    """"No records" and "you are not an employee" are different facts."""
    response = employee_client.get(URL)

    assert response.status_code == 400
    assert "employee profile" in str(response.data).lower()
