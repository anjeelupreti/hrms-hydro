"""What an HR officer may do, and where the line falls.

**The rule, stated once.** An officer *operates* the system: they read, they
edit, they process. Bringing something new into existence, and removing
anything, is the HR admin's. That is a second axis over the permission list
rather than a longer permission list — see the "verb" section of
`accounts/policy.py`.

**The trap this is mostly guarding.** The obvious implementation gates on the
HTTP method, and POST means two different things in this API: `POST /employees/`
creates a person, and `POST /leave-requests/1/approve/` is somebody doing their
job. Gating on the method would stop an officer approving leave, running
payroll, or clocking anybody in — precisely the operating they exist for. So
the tests below assert both halves: the create is refused *and* the custom
action is not.
"""

from datetime import date

import pytest

from accounts.models import PermissionGrant, User
from accounts.policy import Perm, can, can_create, can_delete
from companies.models import Company
from employees.models import Employee

pytestmark = pytest.mark.django_db

EMPLOYEES = "/api/v1/employees/employees/"


# ── The policy functions ─────────────────────────────────────────────────


def test_an_officer_with_a_grant_may_act_but_not_create(officer_user):
    assert can(officer_user, Perm.PEOPLE_MANAGE) is True
    assert can_create(officer_user, Perm.PEOPLE_MANAGE) is False
    assert can_delete(officer_user, Perm.PEOPLE_MANAGE) is False


def test_a_bare_officer_can_operate_but_not_shape(db):
    """The role carries the *operating* set with no grant at all.

    It used to carry nothing, which meant appointing an officer changed
    nothing until somebody hand-granted seven permissions. What still has to
    be true with no grants is the shape of it: they may work the employee
    record, and they may not create it, delete it, or touch the settings that
    define it.
    """
    bare = User.objects.create_user(username="bare", password="x", role=User.Role.HR_OFFICER)

    assert can(bare, Perm.PEOPLE_MANAGE) is True
    assert can_create(bare, Perm.PEOPLE_MANAGE) is False
    assert can_delete(bare, Perm.PEOPLE_MANAGE) is False
    assert can(bare, Perm.SETTINGS_MANAGE) is False


def test_an_admin_may_create_and_delete(hr_user):
    assert can_create(hr_user, Perm.PEOPLE_MANAGE) is True
    assert can_delete(hr_user, Perm.PEOPLE_MANAGE) is True


def test_the_owner_may_do_everything(owner_user):
    assert can_create(owner_user, Perm.SETTINGS_MANAGE) is True
    assert can_delete(owner_user, Perm.PAYROLL_RUN) is True


# ── Over the wire ────────────────────────────────────────────────────────


def test_an_officer_cannot_create_an_employee(officer_client, company):
    response = officer_client.post(
        EMPLOYEES,
        {
            "first_name": "Bimala",
            "last_name": "Thapa",
            "email": "bimala@example.com",
            "date_joined": "2026-01-05",
            "primary_company": company.pk,
        },
        format="json",
    )

    assert response.status_code == 403


def test_an_officer_can_edit_one(officer_client, employee_user, company):
    employee = Employee.objects.create(
        user=employee_user, employee_code="EMP-R1",
        date_joined=date(2024, 1, 1), primary_company=company,
    )

    response = officer_client.patch(
        f"{EMPLOYEES}{employee.pk}/", {"phone": "9801234567"}, format="json"
    )

    assert response.status_code == 200, response.data
    employee.refresh_from_db()
    assert employee.phone == "9801234567"


def test_an_officer_cannot_delete_one(officer_client, employee_user, company):
    employee = Employee.objects.create(
        user=employee_user, employee_code="EMP-R2",
        date_joined=date(2024, 1, 1), primary_company=company,
    )

    response = officer_client.delete(f"{EMPLOYEES}{employee.pk}/")

    assert response.status_code in (403, 405)
    assert Employee.objects.filter(pk=employee.pk).exists()


def test_an_officer_cannot_create_a_company(officer_client, officer_user):
    """Creating a new *kind of thing* — a company, a slab, a leave type — is
    exactly what the split reserves for an admin."""
    PermissionGrant.objects.get_or_create(
        user=officer_user, permission=Perm.SETTINGS_MANAGE
    )

    response = officer_client.post(
        "/api/v1/companies/companies/", {"name": "New SPV", "code": "NSPV"}, format="json"
    )

    assert response.status_code == 403
    assert not Company.objects.filter(code="NSPV").exists()


def test_a_custom_action_is_still_open_to_an_officer(officer_client, officer_user):
    """POST is not the test — `create` is. An officer who could not POST
    anything could not approve leave or run payroll, which is their job."""
    PermissionGrant.objects.get_or_create(
        user=officer_user, permission=Perm.ATTENDANCE_MANAGE
    )

    response = officer_client.post("/api/v1/attendance/logs/clock-in/", {}, format="json")

    # Whatever the endpoint decides on the merits, it must not be the
    # permission class turning it away.
    assert response.status_code != 403


# ── Who may appoint whom ─────────────────────────────────────────────────


def test_only_the_owner_can_appoint_an_hr_admin(hr_client, employee_user):
    """`hr_client` is a plain HR admin. `admin_client` is a Django superuser,
    which the policy treats as holding everything by design — using it here
    would test the bypass rather than the rule."""
    response = hr_client.post(
        f"/api/v1/accounts/team/{employee_user.pk}/role/",
        {"role": "hr_admin"},
        format="json",
    )

    assert response.status_code == 403
    employee_user.refresh_from_db()
    assert employee_user.role == User.Role.EMPLOYEE


def test_the_owner_can_appoint_an_hr_admin(owner_client, employee_user):
    response = owner_client.post(
        f"/api/v1/accounts/team/{employee_user.pk}/role/",
        {"role": "hr_admin"},
        format="json",
    )

    assert response.status_code == 200, response.data
    employee_user.refresh_from_db()
    assert employee_user.role == User.Role.HR_ADMIN


def test_an_admin_can_promote_and_demote_an_officer(hr_client, employee_user):
    """The everyday case, and the one an admin is for."""
    promote = hr_client.post(
        f"/api/v1/accounts/team/{employee_user.pk}/role/",
        {"role": "hr_officer"}, format="json",
    )
    assert promote.status_code == 200, promote.data

    demote = hr_client.post(
        f"/api/v1/accounts/team/{employee_user.pk}/role/",
        {"role": "employee"}, format="json",
    )
    assert demote.status_code == 200, demote.data
    employee_user.refresh_from_db()
    assert employee_user.role == User.Role.EMPLOYEE


def test_an_admin_cannot_demote_another_admin(hr_client):
    """Otherwise two admins can take turns removing each other."""
    other = User.objects.create_user(
        username="other_admin", password="x", role=User.Role.HR_ADMIN
    )

    response = hr_client.post(
        f"/api/v1/accounts/team/{other.pk}/role/", {"role": "employee"}, format="json"
    )

    assert response.status_code == 403
    other.refresh_from_db()
    assert other.role == User.Role.HR_ADMIN
