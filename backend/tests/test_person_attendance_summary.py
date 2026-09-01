"""One person's attendance, as a reading rather than a strip of dots.

The profile's attendance tab drew a month grid and nothing else — a row of two
dots on an otherwise empty strip. A grid shows *which days had a record*; it
cannot answer the question somebody opens that tab with, which is **am I turning
up on time**. This endpoint answers it.

The rule that matters most here is not arithmetic, it is scope: attendance is a
record of somebody's movements, so "who may read whose" has to come from the
same place the attendance list gets it, not from a second decision made here.
"""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from attendance.models import AttendanceLog

pytestmark = [pytest.mark.django_db]

URL = "/api/v1/attendance/logs/person-summary/"


@pytest.fixture
def person(company, employee_user):
    from employees.models import Employee

    return Employee.objects.create(
        user=employee_user, employee_code="SUM-1", date_joined=date(2024, 1, 1)
    )


def _log(person, days_ago, status, hour=None):
    when = timezone.localdate() - timedelta(days=days_ago)
    check_in = None
    if hour is not None:
        check_in = timezone.make_aware(
            timezone.datetime.combine(when, timezone.datetime.min.time())
        ).replace(hour=hour, minute=0)
    return AttendanceLog.objects.create(
        employee=person, date=when, status=status, check_in_time=check_in
    )


def test_it_counts_each_status(hr_client, company, person):
    _log(person, 1, AttendanceLog.Status.PRESENT)
    _log(person, 2, AttendanceLog.Status.PRESENT)
    _log(person, 3, AttendanceLog.Status.LATE)
    _log(person, 4, AttendanceLog.Status.ABSENT)
    _log(person, 5, AttendanceLog.Status.HALF_DAY)

    data = hr_client.get(f"{URL}?employee={person.pk}&days=30").data

    assert data["present"] == 2
    assert data["late"] == 1
    assert data["absent"] == 1
    assert data["half_day"] == 1
    assert data["recorded"] == 5


def test_absence_is_not_a_day_turned_up(hr_client, company, person):
    """`turned_up` is the denominator for punctuality, so counting an absence in
    it would make somebody look *better* for not coming in."""
    _log(person, 1, AttendanceLog.Status.PRESENT)
    _log(person, 2, AttendanceLog.Status.ABSENT)

    data = hr_client.get(f"{URL}?employee={person.pk}&days=30").data

    assert data["turned_up"] == 1
    assert data["punctuality"] == 100


def test_nothing_recorded_reports_no_score(hr_client, company, person):
    """`None`, not 100. A perfect punctuality score for somebody who has never
    been recorded is a lie, and it is the kind that reaches a review."""
    data = hr_client.get(f"{URL}?employee={person.pk}&days=30").data

    assert data["recorded"] == 0
    assert data["punctuality"] is None
    assert data["average_arrival"] is None


def test_the_window_excludes_older_days(hr_client, company, person):
    _log(person, 2, AttendanceLog.Status.PRESENT)
    _log(person, 45, AttendanceLog.Status.PRESENT)

    assert hr_client.get(f"{URL}?employee={person.pk}&days=30").data["recorded"] == 1
    assert hr_client.get(f"{URL}?employee={person.pk}&days=92").data["recorded"] == 2


def test_the_window_is_capped(hr_client, company, person):
    """An unbounded range over a busy company is a slow query nobody asked for —
    the same cap `my-history` applies."""
    assert hr_client.get(f"{URL}?employee={person.pk}&days=9999").data["days"] == 92


def test_average_arrival_is_a_time_of_day(hr_client, company, person):
    """Averaging `check_in_time` across dates is meaningless — the mean of two
    timestamps a month apart is a moment in between. Only the clock time counts."""
    _log(person, 1, AttendanceLog.Status.PRESENT, hour=8)
    _log(person, 20, AttendanceLog.Status.PRESENT, hour=10)

    assert hr_client.get(f"{URL}?employee={person.pk}&days=30").data["average_arrival"] == "09:00"


def test_an_employee_cannot_read_a_colleagues_movements(employee_client, company, employee_user):
    """🔒 The scope rule. `?employee=` must not become a second, ungated way to
    somebody's arrival times.

    The filter is applied *inside* the viewset's own queryset, which already
    encodes who may see whose — so asking for a colleague's id returns an empty
    summary rather than their record. Nothing here re-decides the question.

    **The colleague has to be a different person, and that is the whole test.**
    The first version of this built the "colleague" from `employee_user` — the
    same account the client is signed in as — so it asked for its own record,
    got it, and reported a leak that was not there. A permission test whose two
    identities are secretly one tests nothing.
    """
    from accounts.models import User
    from employees.models import Employee

    other_user = User.objects.create_user(
        username="colleague", email="colleague@t.test", password="pw",
        role=User.Role.EMPLOYEE,
    )
    colleague = Employee.objects.create(
        user=other_user, employee_code="SUM-2", date_joined=date(2024, 1, 1)
    )
    assert colleague.user_id != employee_user.id, "the two identities are the same account"
    _log(colleague, 1, AttendanceLog.Status.LATE)
    _log(colleague, 2, AttendanceLog.Status.PRESENT)

    data = employee_client.get(f"{URL}?employee={colleague.pk}&days=30").data

    assert data["recorded"] == 0, "read another employee's attendance"


def test_hr_can_read_it(hr_client, company, person):
    """The other half — a rule that refused everybody would pass the test above
    and be useless."""
    _log(person, 1, AttendanceLog.Status.PRESENT)

    assert hr_client.get(f"{URL}?employee={person.pk}&days=30").data["recorded"] == 1
