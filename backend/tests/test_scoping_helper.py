"""P1.5 — the one definition of employee visibility.

The point of these is the *fail-closed* case. The interesting user is not an
employee or an HR admin — it is a User with no employee profile at all, which
is what a platform-created admin or a service account looks like before an
Employee row exists. Four of the five old call sites handled that; the fifth
did not, and matched every unmanaged employee's rows instead of none.
"""

from datetime import date

import pytest
from django.contrib.auth import get_user_model

from employees.models import Employee
from employees.scoping import (
    is_people_admin,
    requesting_employee,
    scope_to_visible,
)
from leave.models import LeaveType
from leave.services import submit_leave_request

pytestmark = pytest.mark.django_db

User = get_user_model()


@pytest.fixture
def org(company, payroll_setup):
    """A manager, their report, and an unmanaged employee.

    `loner` is the one that matters: with no manager, `manager_id IS NULL`
    is true for their rows, which is exactly what the buggy filter matched.
    """
    made = {}
    for name in ("boss", "report", "loner"):
        user = User.objects.create_user(
            username=f"sc_{name}", email=f"sc_{name}@t.test",
            password="pw", role=User.Role.EMPLOYEE,
        )
        made[name] = Employee.objects.create(
            user=user, employee_code=f"SC-{name.upper()}",
            date_joined=date(2026, 1, 1),
            department=payroll_setup["dept"], designation=payroll_setup["desig"],
        )
    made["report"].manager = made["boss"]
    made["report"].save(update_fields=["manager"])
    return made


@pytest.fixture
def leave_type(company):
    return LeaveType.objects.create(
        name="Casual", code="CL", is_paid=True, annual_quota_days=10,
    )


def _request_for(employee, leave_type, day):
    return submit_leave_request(
        employee=employee, leave_type=leave_type,
        start_date=date(2026, 10, day), end_date=date(2026, 10, day),
        half_day=False, reason="x",
    )


# ── The regression this extraction fixes ─────────────────────────────────


def test_a_user_with_no_employee_profile_sees_nothing(company, org, leave_type):
    """A user with no employee profile must see nobody's requests.

    `Q(employee=None) | Q(employee__manager=None)` reads as
    `employee_id IS NULL OR manager_id IS NULL`: the first branch matches
    nothing and the second matches every unmanaged employee, which hands their
    requests to anybody without a profile.
    """
    from leave.models import LeaveRequest

    _request_for(org["loner"], leave_type, 1)
    _request_for(org["report"], leave_type, 2)

    orphan = User.objects.create_user(
        username="sc_orphan", email="sc_orphan@t.test",
        password="pw", role=User.Role.EMPLOYEE,
    )
    assert requesting_employee(orphan) is None

    visible = scope_to_visible(LeaveRequest.objects.all(), orphan)

    assert visible.count() == 0


def test_the_unmanaged_employee_still_sees_their_own(company, org, leave_type):
    """Failing closed must not go too far — `loner` has no manager, but they
    are still themselves."""
    from leave.models import LeaveRequest

    mine = _request_for(org["loner"], leave_type, 3)

    visible = scope_to_visible(LeaveRequest.objects.all(), org["loner"].user)

    assert list(visible.values_list("id", flat=True)) == [mine.id]


# ── The rule itself ──────────────────────────────────────────────────────


def test_an_employee_sees_only_their_own(company, org, leave_type):
    from leave.models import LeaveRequest

    mine = _request_for(org["report"], leave_type, 4)
    _request_for(org["loner"], leave_type, 5)

    visible = scope_to_visible(LeaveRequest.objects.all(), org["report"].user)

    assert set(visible.values_list("id", flat=True)) == {mine.id}


def test_a_manager_sees_themselves_and_their_reports(company, org, leave_type):
    from leave.models import LeaveRequest

    theirs = _request_for(org["report"], leave_type, 6)
    loners = _request_for(org["loner"], leave_type, 7)

    visible = set(
        scope_to_visible(LeaveRequest.objects.all(), org["boss"].user)
        .values_list("id", flat=True)
    )

    assert theirs.id in visible
    assert loners.id not in visible


def test_hr_sees_everything(company, org, leave_type, hr_user):
    from leave.models import LeaveRequest

    a = _request_for(org["report"], leave_type, 8)
    b = _request_for(org["loner"], leave_type, 9)

    visible = set(
        scope_to_visible(LeaveRequest.objects.all(), hr_user).values_list("id", flat=True)
    )

    assert {a.id, b.id} <= visible


def test_people_admin_predicate(company, org, hr_user, admin_user):
    assert is_people_admin(hr_user)
    assert is_people_admin(admin_user)
    assert not is_people_admin(org["report"].user)


def test_the_path_argument_targets_a_different_fk(company, org, leave_type):
    """`scope_to_visible` takes the lookup prefix so it can filter models
    whose Employee FK is not called `employee`. Every current caller uses the
    default, but the hierarchy work will add ones that don't."""
    from leave.models import LeaveRequest

    _request_for(org["report"], leave_type, 10)

    # Explicit default behaves identically to the implicit one.
    explicit = scope_to_visible(LeaveRequest.objects.all(), org["boss"].user, path="employee")
    implicit = scope_to_visible(LeaveRequest.objects.all(), org["boss"].user)

    assert list(explicit.values_list("id", flat=True)) == list(
        implicit.values_list("id", flat=True)
    )
