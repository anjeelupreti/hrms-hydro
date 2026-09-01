"""The series the charts are drawn from.

Two screens had totals as of today and no shape: leave and expenses. A single
month's figure is a number with nothing to compare it to, which is the same gap
the payroll card had before it was given a history.

What these test is not the arithmetic — it is the three decisions that make a
series honest: which rows count, how a month with nothing in it is represented,
and what happens at the edges of the window.
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from attendance.models import AttendanceLog
from employees.models import Employee
from expenses.models import ExpenseClaim
from leave.models import LeaveRequest, LeaveType

pytestmark = pytest.mark.django_db

LEAVE_TREND = "/api/v1/leave/requests/trend/"
EXPENSE_TREND = "/api/v1/expenses/claims/trend/"
ARRIVALS = "/api/v1/attendance/logs/arrivals/"


@pytest.fixture
def person(company, admin_user):
    yield Employee.objects.create(
        user=admin_user, employee_code="EMP-TREND", date_joined=date(2020, 1, 1)
    )


# ── Leave ────────────────────────────────────────────────────────────────────


def test_every_month_in_the_window_is_present(company, admin_client, person):
    """🔒 **A quiet month is the answer, not an absent row.**

    Built from rows alone, a company that took no leave in Poush would produce a
    series that skips it — and a chart drawn from that shows Mangsir sitting
    next to Magh as though they were adjacent. The spacing would be a lie about
    the very thing the series exists to show.
    """
    response = admin_client.get(LEAVE_TREND)

    assert response.status_code == 200
    months = response.data["months"]
    # Twelve months back plus the current one, give or take the boundary.
    assert 12 <= len(months) <= 14
    assert all(m["total"] == 0 for m in months)


def test_only_approved_leave_counts(company, admin_client, person):
    """A pending request is a request, not a day off.

    Counting it would make the busiest months look busier still — which is
    exactly when somebody is deciding whether to approve one more.
    """
    holiday = LeaveType.objects.create(name="Annual", code="AL", annual_quota_days=20)
    today = timezone.localdate()
    for status, days in (
        (LeaveRequest.Status.APPROVED, "3.0"),
        (LeaveRequest.Status.PENDING, "5.0"),
        (LeaveRequest.Status.REJECTED, "7.0"),
    ):
        LeaveRequest.objects.create(
            employee=person,
            leave_type=holiday,
            start_date=today,
            end_date=today,
            days_requested=Decimal(days),
            status=status,
        )

    response = admin_client.get(LEAVE_TREND)
    total = sum(m["total"] for m in response.data["months"])

    assert total == 3.0
    assert response.data["types"] == ["Annual"]


def test_leave_is_split_by_type(company, admin_client, person):
    """One stacked bar per month is only useful if the stack means something.
    Sick leave clustering in one month and annual leave in another are different
    facts about a company, and a single total hides both."""
    annual = LeaveType.objects.create(name="Annual", code="AL", annual_quota_days=20)
    sick = LeaveType.objects.create(name="Sick", code="SL", annual_quota_days=10)
    today = timezone.localdate()
    for kind, days in ((annual, "2.0"), (sick, "1.0")):
        LeaveRequest.objects.create(
            employee=person, leave_type=kind, start_date=today, end_date=today,
            days_requested=Decimal(days), status=LeaveRequest.Status.APPROVED,
        )

    response = admin_client.get(LEAVE_TREND)

    assert response.data["types"] == ["Annual", "Sick"]
    current = [m for m in response.data["months"] if m["total"] > 0][0]
    assert current["Annual"] == 2.0
    assert current["Sick"] == 1.0


def test_leave_older_than_the_window_is_excluded(company, admin_client, person):
    """The window is what makes the series readable. Without the cut, one
    ancient row stretches the axis and flattens everything recent."""
    holiday = LeaveType.objects.create(name="Annual", code="AL", annual_quota_days=20)
    LeaveRequest.objects.create(
        employee=person, leave_type=holiday,
        start_date=timezone.localdate() - timedelta(days=800),
        end_date=timezone.localdate() - timedelta(days=800),
        days_requested=Decimal("9.0"), status=LeaveRequest.Status.APPROVED,
    )

    response = admin_client.get(LEAVE_TREND)

    assert sum(m["total"] for m in response.data["months"]) == 0


# ── Expenses ─────────────────────────────────────────────────────────────────


def test_approved_and_reimbursed_both_count_as_spend(company, admin_client, person):
    """The company has agreed to the money either way.

    Whether the transfer has cleared is a treasury question, not a spending one,
    and excluding approved claims would make the current month look artificially
    light every single time.
    """
    today = timezone.localdate()
    for status, amount in (
        (ExpenseClaim.Status.APPROVED, "100.00"),
        (ExpenseClaim.Status.REIMBURSED, "50.00"),
        (ExpenseClaim.Status.PENDING, "999.00"),
        (ExpenseClaim.Status.REJECTED, "999.00"),
    ):
        ExpenseClaim.objects.create(
            employee=person, amount=Decimal(amount), expense_date=today,
            status=status, category=ExpenseClaim.Category.TRAVEL,
        )

    response = admin_client.get(EXPENSE_TREND)

    assert sum(m["total"] for m in response.data["months"]) == 150.0


def test_categories_are_ordered_by_spend(company, admin_client, person):
    """So the biggest category is always the first series and its colour does
    not move between renders — colour follows the entity, not its rank changing
    underneath the reader."""
    today = timezone.localdate()
    for category, amount in (
        (ExpenseClaim.Category.TRAVEL, "20.00"),
        (ExpenseClaim.Category.MEALS, "300.00"),
    ):
        ExpenseClaim.objects.create(
            employee=person, amount=Decimal(amount), expense_date=today,
            status=ExpenseClaim.Status.APPROVED, category=category,
        )

    response = admin_client.get(EXPENSE_TREND)
    names = [c["name"] for c in response.data["categories"]]

    assert names[0] == "Meals"
    assert response.data["categories"][0]["total"] == 300.0


def test_an_empty_expense_series_still_has_its_months(company, admin_client, person):
    """Same rule as leave: the calendar builds the buckets, not the rows."""
    response = admin_client.get(EXPENSE_TREND)

    assert response.status_code == 200
    assert 12 <= len(response.data["months"]) <= 14
    assert response.data["categories"] == []


# ── Attendance ───────────────────────────────────────────────────────────────
#
# Not a lateness percentage. The question is whether the start time the
# workspace publishes is the one people actually keep, and that is a shape.


def test_arrivals_are_bucketed_by_half_hour(company, admin_client, person):
    """Finer and a company of ninety produces a comb of ones; coarser and the
    difference between 09:05 and 09:50 — which is the entire question —
    disappears into a single bar."""
    today = timezone.localdate()
    # The day offset and the minute are separate — reusing one for both put
    # a punch 50 days back, outside the four-week window, and the endpoint
    # correctly dropped it.
    for offset, minute in enumerate((5, 20, 50)):
        day = today - timedelta(days=offset)
        AttendanceLog.objects.create(
            employee=person,
            date=day,
            status=AttendanceLog.Status.PRESENT,
            check_in_time=timezone.make_aware(datetime.combine(day, time(9, minute))),
        )

    response = admin_client.get(ARRIVALS)
    slots = {s["label"]: s["count"] for s in response.data["slots"]}

    # 09:05 and 09:20 share the 09:00 bucket; 09:50 falls in 09:30.
    assert slots["09:00"] == 2
    assert slots["09:30"] == 1


def test_the_typical_arrival_is_a_median(company, admin_client, person):
    """🔒 A mean is dragged around by one person who came in at 4am to fix
    something — and that is exactly the day most worth logging, so it will
    happen."""
    today = timezone.localdate()
    for offset, hour in enumerate([4, 9, 9, 9, 9]):
        AttendanceLog.objects.create(
            employee=person,
            date=today - timedelta(days=offset),
            status=AttendanceLog.Status.PRESENT,
            check_in_time=timezone.make_aware(
                datetime.combine(today - timedelta(days=offset), time(hour, 0))
            ),
        )

    response = admin_client.get(ARRIVALS)

    # 9am, not the 8am a mean would report.
    assert response.data["median"] == 9 * 60


def test_an_empty_distribution_says_so_rather_than_guessing(company, admin_client, person):
    """A dial drawn from no data would put its hand at midnight, which reads as
    a fact rather than an absence."""
    response = admin_client.get(ARRIVALS)

    assert response.data["slots"] == []
    assert response.data["median"] is None
    assert response.data["total"] == 0
