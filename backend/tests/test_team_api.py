"""The delegation screen's API.

`set_role`, `grant` and `revoke` were correct and tested from the day the
permission model landed, and reachable from nothing — no viewset, no URL. The
sentence the design rests on ("the owner appoints HR admins") was true of the
code and false of the product.

These tests are about the *transport* keeping the model's promises rather than
re-deciding them. The escalation cases matter most: an endpoint that grants is
an endpoint somebody will try to grant themselves something with.
"""

import pytest

from accounts.models import PermissionGrant, User
from accounts.policy import Perm

pytestmark = pytest.mark.django_db


def _auth(client, user):
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def cast(company):
    owner = User.objects.create_user(
        username="t_owner", email="o@t.com", password="pw12345!", role=User.Role.OWNER
    )
    admin = User.objects.create_user(
        username="t_admin", email="a@t.com", password="pw12345!", role=User.Role.HR_ADMIN
    )
    officer = User.objects.create_user(
        username="t_officer", email="f@t.com", password="pw12345!", role=User.Role.HR_OFFICER
    )
    staff = User.objects.create_user(
        username="t_staff", email="s@t.com", password="pw12345!", role=User.Role.EMPLOYEE
    )
    return {"owner": owner, "admin": admin, "officer": officer, "staff": staff}


def test_an_employee_cannot_see_the_team_screen(api_client, company, cast):
    """`people.admin` is role-only and never grantable, so this is the whole
    gate: an employee cannot read who holds what, let alone change it."""
    c = _auth(api_client, cast["staff"])
    assert c.get("/api/v1/accounts/team/").status_code == 403


def test_an_officer_cannot_see_it_either(api_client, company, cast):
    """Even one holding several grants. `people.admin` is in NEVER_GRANTABLE
    precisely so an officer cannot be walked up to an admin in two steps."""
    PermissionGrant.objects.create(user=cast["officer"], permission=Perm.PAYROLL_RUN)
    PermissionGrant.objects.create(user=cast["officer"], permission=Perm.PEOPLE_MANAGE)
    c = _auth(api_client, cast["officer"])
    assert c.get("/api/v1/accounts/team/").status_code == 403


def test_the_owner_appoints_an_hr_admin(api_client, company, cast):
    """The sentence the whole model rests on, finally executable."""
    c = _auth(api_client, cast["owner"])
    response = c.post(
        f"/api/v1/accounts/team/{cast['staff'].id}/role/", {"role": "hr_admin"}, format="json"
    )
    assert response.status_code == 200, response.data
    assert response.data["role"] == "hr_admin"

    cast["staff"].refresh_from_db()
    assert cast["staff"].role == User.Role.HR_ADMIN


def test_nobody_can_appoint_an_owner_through_the_api(api_client, company, cast):
    """Owner comes from provisioning. An appointable owner is a second root of
    trust, and the role's only power is that it cannot be handed around."""
    c = _auth(api_client, cast["owner"])
    response = c.post(
        f"/api/v1/accounts/team/{cast['staff'].id}/role/", {"role": "owner"}, format="json"
    )
    assert response.status_code == 403
    assert "cannot be appointed" in response.data["detail"]


def test_an_admin_cannot_demote_the_owner(api_client, company, cast):
    c = _auth(api_client, cast["admin"])
    response = c.post(
        f"/api/v1/accounts/team/{cast['owner'].id}/role/", {"role": "employee"}, format="json"
    )
    assert response.status_code == 403

    cast["owner"].refresh_from_db()
    assert cast["owner"].role == User.Role.OWNER


def test_people_admin_cannot_be_granted_over_the_wire(api_client, company, cast):
    """The escalation the model forbids, attempted through the new door."""
    c = _auth(api_client, cast["owner"])
    response = c.post(
        f"/api/v1/accounts/team/{cast['officer'].id}/grants/",
        {"permission": Perm.PEOPLE_ADMIN},
        format="json",
    )
    assert response.status_code == 403
    assert not PermissionGrant.objects.filter(
        user=cast["officer"], permission=Perm.PEOPLE_ADMIN
    ).exists()


def test_granting_a_capability_shows_up_as_a_grant_not_a_role(api_client, company, cast):
    c = _auth(api_client, cast["owner"])
    response = c.post(
        f"/api/v1/accounts/team/{cast['officer'].id}/grants/",
        {"permission": Perm.LEAVE_APPROVE},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert Perm.LEAVE_APPROVE in response.data["grants"]
    assert Perm.LEAVE_APPROVE in response.data["permissions"]
    assert response.data["role"] == "hr_officer"


def test_revoking_takes_it_back(api_client, company, cast):
    PermissionGrant.objects.create(user=cast["officer"], permission=Perm.LEAVE_APPROVE)
    c = _auth(api_client, cast["owner"])
    response = c.delete(
        f"/api/v1/accounts/team/{cast['officer'].id}/grants/?permission={Perm.LEAVE_APPROVE}"
    )
    assert response.status_code == 200, response.data
    assert Perm.LEAVE_APPROVE not in response.data["grants"]


def test_moving_an_officer_to_employee_drops_their_grants(api_client, company, cast):
    """Otherwise an employee keeps `payroll.run` because nobody thought to
    revoke it — the exact drift `set_role` clears, asserted through the API."""
    PermissionGrant.objects.create(user=cast["officer"], permission=Perm.PAYROLL_RUN)
    c = _auth(api_client, cast["owner"])
    response = c.post(
        f"/api/v1/accounts/team/{cast['officer'].id}/role/", {"role": "employee"}, format="json"
    )
    assert response.status_code == 200, response.data
    assert response.data["grants"] == []
    assert Perm.PAYROLL_RUN not in response.data["permissions"]


def test_the_catalogue_marks_what_this_actor_may_hand_out(api_client, company, cast):
    """The screen disables what would 403 rather than discovering it on click."""
    c = _auth(api_client, cast["owner"])
    response = c.get("/api/v1/accounts/team/catalogue/")
    assert response.status_code == 200

    by_value = {p["value"]: p for p in response.data["permissions"]}
    assert by_value[Perm.PEOPLE_ADMIN]["grantable"] is False
    assert by_value[Perm.PAYROLL_RUN]["grantable"] is True
    assert by_value[Perm.PAYROLL_RUN]["held_by_you"] is True

    roles = {r["value"]: r for r in response.data["roles"]}
    assert roles["owner"]["appointable"] is False
    assert roles["hr_admin"]["appointable"] is True
