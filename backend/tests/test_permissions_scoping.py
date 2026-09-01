"""P1.3 — role scoping across employees and leave.

The rule this suite pins is that "manager" is not a role on `User` — it is a
*relationship* on `Employee.manager`. Every scoped queryset resolves it that
way, which means a manager sees their reports and nobody else's, and an
employee promoted to manager gains visibility without any role change.

Getting that wrong in either direction is bad: too narrow and approvals
stall, too wide and one team lead reads the whole company's leave history.
"""

from datetime import date

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from employees.models import Employee
from leave.models import ApprovalChain, ApprovalStep, LeaveRequest, LeaveType
from leave.services import submit_leave_request

pytestmark = pytest.mark.django_db

User = get_user_model()


def _as(company, user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def team(company, payroll_setup):
    """A three-person shape: a manager, their direct report, and an
    unrelated employee on another team. The outsider is the control — most
    scoping bugs are invisible without someone who should NOT be visible."""
    made = {}
    for name in ("boss", "report", "outsider"):
        user = User.objects.create_user(
            username=name, email=f"{name}@t.test", password="pw",
            role=User.Role.EMPLOYEE,
        )
        made[name] = Employee.objects.create(
            user=user, employee_code=f"EMP-{name.upper()}",
            date_joined=date(2026, 1, 1),
            department=payroll_setup["dept"], designation=payroll_setup["desig"],
        )
    made["report"].manager = made["boss"]
    made["report"].save(update_fields=["manager"])
    return made


@pytest.fixture
def leave_type(company):
    return LeaveType.objects.create(
        name="Annual", code="AL", is_paid=True, annual_quota_days=20,
    )


# ── P1.3.2 — employees see only themselves ───────────────────────────────


def test_employee_leave_list_excludes_colleagues(company, team, leave_type):
    mine = submit_leave_request(
        employee=team["report"], leave_type=leave_type,
        start_date=date(2026, 9, 1), end_date=date(2026, 9, 2),
        half_day=False, reason="mine",
    )
    theirs = submit_leave_request(
        employee=team["outsider"], leave_type=leave_type,
        start_date=date(2026, 9, 1), end_date=date(2026, 9, 2),
        half_day=False, reason="theirs",
    )

    response = _as(company, team["report"].user).get("/api/v1/leave/requests/")

    assert response.status_code == 200
    results = response.data["results"] if isinstance(response.data, dict) else response.data
    ids = {row["id"] for row in results}
    assert mine.id in ids
    assert theirs.id not in ids


def test_employee_cannot_retrieve_a_colleagues_leave_request(company, team, leave_type):
    theirs = submit_leave_request(
        employee=team["outsider"], leave_type=leave_type,
        start_date=date(2026, 9, 1), end_date=date(2026, 9, 2),
        half_day=False, reason="theirs",
    )

    response = _as(company, team["report"].user).get(f"/api/v1/leave/requests/{theirs.id}/")

    assert response.status_code == 404


# ── P1.3.3 — a manager sees direct reports, and only those ───────────────


def test_manager_sees_their_direct_reports_leave(company, team, leave_type):
    report_request = submit_leave_request(
        employee=team["report"], leave_type=leave_type,
        start_date=date(2026, 9, 1), end_date=date(2026, 9, 2),
        half_day=False, reason="report",
    )

    response = _as(company, team["boss"].user).get("/api/v1/leave/requests/")

    results = response.data["results"] if isinstance(response.data, dict) else response.data
    assert report_request.id in {row["id"] for row in results}


def test_manager_does_not_see_another_teams_leave(company, team, leave_type):
    """The control case. `boss` manages `report`, not `outsider`."""
    outsider_request = submit_leave_request(
        employee=team["outsider"], leave_type=leave_type,
        start_date=date(2026, 9, 1), end_date=date(2026, 9, 2),
        half_day=False, reason="outsider",
    )

    response = _as(company, team["boss"].user).get("/api/v1/leave/requests/")

    results = response.data["results"] if isinstance(response.data, dict) else response.data
    assert outsider_request.id not in {row["id"] for row in results}


def test_manager_is_a_relationship_not_a_role(company, team):
    """`boss` holds the EMPLOYEE role — their extra visibility comes purely
    from `Employee.manager` pointing at them. If this ever becomes a role
    flag, scoping has to be revisited everywhere."""
    assert team["boss"].user.role == User.Role.EMPLOYEE
    assert team["report"].manager_id == team["boss"].id


# ── Employee directory is read-only to non-HR ────────────────────────────


def test_employee_cannot_create_an_employee(company, team):
    response = _as(company, team["report"].user).post(
        "/api/v1/employees/employees/",
        {"employee_code": "EMP-FAKE", "date_joined": "2026-01-01"},
        format="json",
    )

    assert response.status_code == 403


def test_employee_cannot_edit_another_employee(company, team):
    response = _as(company, team["report"].user).patch(
        f"/api/v1/employees/employees/{team['outsider'].id}/",
        {"employee_code": "HACKED"},
        format="json",
    )

    assert response.status_code == 403


def test_hr_admin_can_create_an_employee(company, team, hr_user, payroll_setup):
    response = _as(company, hr_user).post(
        "/api/v1/employees/employees/",
        {
            "employee_code": "EMP-NEW",
            "date_joined": "2026-01-01",
            "first_name": "New",
            "last_name": "Hire",
            "email": "new.hire@t.test",
            "department": payroll_setup["dept"].id,
            "designation": payroll_setup["desig"].id,
        },
        format="json",
    )

    assert response.status_code in (200, 201), response.data


# ── P1.3.9 — approving your own request ──────────────────────────────────


def test_an_unmanaged_employees_request_skips_to_the_hr_step(
    company, team, leave_type
):
    """`boss` has no manager, so the MANAGER step cannot resolve an approver.

    Rather than stall forever, `_notify_step_approvers` auto-skips it and
    advances to the next step — HR_ADMIN in the seeded chain. The request
    stays PENDING and still needs a human, it just needs a different one.

    Worth pinning because the alternative implementations are both bad: stall
    with nobody able to act, or auto-*approve*. Neither happens here, and a
    change that introduced either would break this test.

    (My first version of this test created its own single-step chain, which
    `get_default_chain` then picked ahead of the seeded one — with no second
    step to advance to, the request finalised as APPROVED and I briefly
    mistook that for the product's behaviour. The chain a test creates can
    change the thing it is measuring.)
    """
    own = submit_leave_request(
        employee=team["boss"], leave_type=leave_type,
        start_date=date(2026, 9, 10), end_date=date(2026, 9, 11),
        half_day=False, reason="my own leave",
    )
    own.refresh_from_db()

    assert own.status == LeaveRequest.Status.PENDING
    assert own.current_step > 1  # advanced past the unresolvable manager step


def test_a_managed_employee_cannot_approve_their_own_request(company, team, leave_type):
    """The case that actually matters: `report` HAS a manager, so their
    request sits PENDING at the manager step and they cannot act on it
    themselves — `can_act_on_step` compares the actor against
    `employee.manager`, which is `boss`, not them."""
    own = submit_leave_request(
        employee=team["report"], leave_type=leave_type,
        start_date=date(2026, 9, 10), end_date=date(2026, 9, 11),
        half_day=False, reason="my own leave",
    )
    own.refresh_from_db()
    assert own.status == LeaveRequest.Status.PENDING

    response = _as(company, team["report"].user).post(
        f"/api/v1/leave/requests/{own.id}/approve/", {"comment": ""}, format="json"
    )

    assert response.status_code == 403
    own.refresh_from_db()
    assert own.status == LeaveRequest.Status.PENDING


def test_an_hr_admin_CAN_approve_their_own_request_segregation_of_duties_gap(
    company, hr_user, payroll_setup, leave_type
):
    """**Known gap, deliberately documented rather than asserted as correct.**

    `can_act_on_step` resolves an HR_ADMIN step to *any* HR admin or
    superuser — it never compares the actor against the requester. So an HR
    admin who files their own leave can approve it themselves, and the audit
    trail records them on both sides.

    This is a real segregation-of-duties finding an auditor would raise.
    It is not obviously a bug to *fix* blindly, though: in a ten-person
    company where HR is one person, forbidding self-approval means their
    leave can never be approved by anyone. That is a product decision, so
    the behaviour is pinned here and escalated rather than silently changed.

    Tracked as P1.3.9. Flip this assertion when the policy is decided.
    """
    chain = ApprovalChain.objects.create(name="HR only", is_active=True)
    ApprovalStep.objects.create(
        chain=chain, sequence=1, approver_role=ApprovalStep.ApproverRole.HR_ADMIN,
    )
    hr_employee = Employee.objects.create(
        user=hr_user, employee_code="EMP-HR",
        date_joined=date(2026, 1, 1),
        department=payroll_setup["dept"], designation=payroll_setup["desig"],
    )
    own = submit_leave_request(
        employee=hr_employee, leave_type=leave_type,
        start_date=date(2026, 9, 20), end_date=date(2026, 9, 21),
        half_day=False, reason="my own leave",
    )

    response = _as(company, hr_user).post(
        f"/api/v1/leave/requests/{own.id}/approve/", {"comment": ""}, format="json"
    )

    # Documents the CURRENT behaviour — self-approval succeeds.
    assert response.status_code == 200


def test_an_unrelated_employee_cannot_approve_anything(company, team, leave_type):
    chain = ApprovalChain.objects.create(name="Manager only", is_active=True)
    ApprovalStep.objects.create(
        chain=chain, sequence=1, approver_role=ApprovalStep.ApproverRole.MANAGER,
    )
    request_obj = submit_leave_request(
        employee=team["report"], leave_type=leave_type,
        start_date=date(2026, 9, 1), end_date=date(2026, 9, 2),
        half_day=False, reason="report",
    )

    response = _as(company, team["outsider"].user).post(
        f"/api/v1/leave/requests/{request_obj.id}/approve/", {"comment": ""}, format="json"
    )

    assert response.status_code in (403, 404)


# ── P1.3.6 — unauthenticated everywhere ──────────────────────────────────


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/employees/employees/",
        "/api/v1/leave/requests/",
        "/api/v1/leave/balances/",
        "/api/v1/attendance/logs/",
        "/api/v1/documents/repository/",
    ],
)
def test_unauthenticated_requests_fail_closed(api_client, path):
    response = api_client.get(path)

    assert response.status_code in (401, 403)
    # And nothing leaks in the body.
    body = str(response.data).lower() if hasattr(response, "data") else ""
    assert "employee_code" not in body


def test_expired_or_absent_credentials_do_not_fall_back_to_a_default_user(api_client):
    """A missing Authorization header must not resolve to *some* user. The
    failure has to be authentication, not a silently-anonymous session."""
    response = api_client.get("/api/v1/accounts/me/")

    assert response.status_code in (401, 403)
