"""What somebody has been doing, as opposed to what was done to them.

The feed is what somebody *did* — leave asked for, hours logged, expenses
claimed, training finished, tasks closed — and deliberately not `EmployeeLog`,
which is an audit of edits made to their record and is already shown by Record
history and by the position timeline.

The property worth protecting is the **per-source cap**. Somebody logs
timesheets every day and resigns once; taking the newest N rows *overall* would
be N timesheet entries and nothing else — a feed that hides every module except
the noisiest.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

pytestmark = [pytest.mark.django_db]


@pytest.fixture
def person(company, employee_user):
    from employees.models import Employee

    return Employee.objects.create(
        user=employee_user, employee_code="ACT-1", date_joined=date(2024, 1, 1)
    )


def _url(pk):
    return f"/api/v1/employees/employees/{pk}/activity/"


def test_an_empty_record_reports_nothing_rather_than_failing(hr_client, company, person):
    assert hr_client.get(_url(person.pk)).data == []


def test_leave_appears_in_the_feed(hr_client, company, person):
    from leave.models import LeaveRequest, LeaveType

    kind = LeaveType.objects.create(name="Annual", code="ANN-ACT", annual_quota_days=10)
    LeaveRequest.objects.create(
        employee=person,
        leave_type=kind,
        start_date=date(2026, 3, 1),
        end_date=date(2026, 3, 2),
        days_requested=Decimal("2"),
    )

    rows = hr_client.get(_url(person.pk)).data

    assert [r["kind"] for r in rows] == ["leave"]
    assert "Annual" in rows[0]["text"]


def test_timesheets_appear(hr_client, company, person):
    from projects.models import Project
    from timesheets.models import TimeEntry

    project = Project.objects.create(name="Penstock", status=Project.Status.ACTIVE)
    TimeEntry.objects.create(
        employee=person, project=project, date=date(2026, 5, 4), hours=Decimal("6")
    )

    rows = hr_client.get(_url(person.pk)).data

    assert rows[0]["kind"] == "timesheet"
    assert "Penstock" in rows[0]["text"]


def test_the_newest_thing_is_first(hr_client, company, person):
    """A feed sorted any other way is a list."""
    from projects.models import Project
    from timesheets.models import TimeEntry

    project = Project.objects.create(name="Canal", status=Project.Status.ACTIVE)
    TimeEntry.objects.create(
        employee=person, project=project, date=date(2026, 1, 1), hours=Decimal("4")
    )
    TimeEntry.objects.create(
        employee=project and person, project=project, date=date(2026, 6, 1), hours=Decimal("4")
    )

    dates = [r["date"] for r in hr_client.get(_url(person.pk)).data]

    assert dates == sorted(dates, reverse=True)


def test_one_noisy_module_cannot_crowd_out_the_others(hr_client, company, person):
    """Each source is capped *before* the merge, not after.

    Somebody logs timesheets every day and takes leave twice a year. Trimming
    the merged list instead would return twenty timesheet entries and hide the
    leave entirely — the feed would be technically correct and useless.
    """
    from leave.models import LeaveRequest, LeaveType
    from projects.models import Project
    from timesheets.models import TimeEntry

    project = Project.objects.create(name="Spillway", status=Project.Status.ACTIVE)
    # Thirty days of timesheets, all newer than the leave below.
    for i in range(30):
        TimeEntry.objects.create(
            employee=person,
            project=project,
            date=date(2026, 6, 1) + timedelta(days=i),
            hours=Decimal("8"),
        )
    kind = LeaveType.objects.create(name="Sick", code="SICK-ACT", annual_quota_days=5)
    LeaveRequest.objects.create(
        employee=person,
        leave_type=kind,
        start_date=date(2026, 1, 5),
        end_date=date(2026, 1, 5),
        days_requested=Decimal("1"),
    )

    kinds = {r["kind"] for r in hr_client.get(_url(person.pk)).data}

    assert "leave" in kinds, "the noisiest module crowded out everything else"
    assert "timesheet" in kinds


def test_another_employees_feed_is_not_readable(employee_client, company, employee_user):
    """The feed is somebody's working life. It is reached through `get_object()`,
    so it inherits the viewset's visibility rather than deciding again — and the
    colleague has to be a genuinely different account for this to test anything.
    """
    from accounts.models import User
    from employees.models import Employee

    other = User.objects.create_user(
        username="feedcolleague", email="fc@t.test", password="pw", role=User.Role.EMPLOYEE
    )
    colleague = Employee.objects.create(
        user=other, employee_code="ACT-2", date_joined=date(2024, 1, 1)
    )
    assert colleague.user_id != employee_user.id

    assert employee_client.get(_url(colleague.pk)).status_code in (403, 404)
