"""Who may do what.

**The tests that matter here are the refusals**, and specifically the ones that
stop delegation turning into escalation. A permission system is easy to get
right for the happy path and is only worth anything at its edges: the admin who
hands out a capability they do not hold, the officer who grants themselves the
power to grant, the owner who gets locked out by a feature shipped next month.

Every one of those is a test below, and each was a real way to lose the model.
"""

import pytest

from accounts.models import PermissionGrant, User
from accounts.policy import (
    ALL_PERMS,
    NEVER_GRANTABLE,
    Perm,
    PermissionError_,
    can,
    can_create,
    can_delete,
    grant,
    manages,
    permissions_of,
    revoke,
    set_role,
    users_with,
)

pytestmark = pytest.mark.django_db


def _user(company, username, role):
    return User.objects.create_user(
        username=username, email=f"{username}@acme.com", password="x", role=role
    )


@pytest.fixture
def owner(company):
    return _user(company, "owner", User.Role.OWNER)


@pytest.fixture
def admin(company):
    return _user(company, "admin2", User.Role.HR_ADMIN)


@pytest.fixture
def officer(company):
    return _user(company, "officer", User.Role.HR_OFFICER)


@pytest.fixture
def staff(company):
    return _user(company, "staff", User.Role.EMPLOYEE)


# ── The floor and the ceiling ────────────────────────────────────────────


def test_an_employee_holds_nothing(company, staff):
    """Self-service is enforced by scoping queries to them, not by a capability."""
    assert all(can(staff, perm) is False for perm in ALL_PERMS)


def test_an_officer_operates_but_does_not_shape(company, officer):
    """🔒 What separates an officer from an admin.

    The default used to be *nothing*, on the argument that "as per their scope"
    only means something if the scope starts empty. In practice that made a
    newly appointed officer indistinguishable from an employee — every edit
    403'd from the role whose whole purpose is editing — so the operating set
    is now held by the role and the *verb* is what keeps them an officer.

    The half that must not drift is the exclusions: settings, payroll and the
    company mailbox are not "operating".
    """
    assert can(officer, Perm.PEOPLE_MANAGE) is True
    assert can(officer, Perm.LEAVE_APPROVE) is True
    assert can(officer, Perm.WORKPLACE_MANAGE) is True

    assert can(officer, Perm.SETTINGS_MANAGE) is False
    assert can(officer, Perm.PAYROLL_RUN) is False
    assert can(officer, Perm.PAYROLL_VIEW) is False
    assert can(officer, Perm.MAIL_ACCESS) is False
    assert can(officer, Perm.PEOPLE_ADMIN) is False


def test_an_officer_may_not_create_or_delete_what_they_may_edit(company, officer):
    """🔒 The verb axis is the whole restriction, now that the role holds the
    permission outright. If this stops holding, an officer *is* an admin."""
    assert can(officer, Perm.PEOPLE_MANAGE) is True
    assert can_create(officer, Perm.PEOPLE_MANAGE) is False
    assert can_delete(officer, Perm.PEOPLE_MANAGE) is False


def test_an_owner_holds_everything(company, owner):
    assert all(can(owner, perm) for perm in ALL_PERMS)


def test_the_owner_is_checked_before_the_permission_map(company, owner):
    """🔒 A capability invented next month must not lock somebody out of the
    workspace they own. So the owner check cannot consult the map at all."""
    assert can(owner, "a.permission.that.does.not.exist.yet") is True
    assert can(staff_role_user(company), "a.permission.that.does.not.exist.yet") is False


def staff_role_user(company):
    return User.objects.create_user(
        username="floor", email="floor@acme.com", password="x", role=User.Role.EMPLOYEE
    )


def test_a_superuser_maps_onto_the_model_rather_than_bypassing_it(company):
    """Two authorisation systems means only one of them gets audited."""
    root = User.objects.create_superuser(
        username="root", email="root@acme.com", password="x"
    )
    assert can(root, Perm.PAYROLL_RUN) is True


def test_a_closed_login_can_do_nothing(company, admin):
    """Offboarding revokes access; the permission layer has to agree, or an
    HR admin who left keeps their capabilities until somebody notices."""
    admin.is_active = False
    admin.save(update_fields=["is_active"])

    assert can(admin, Perm.PAYROLL_RUN) is False
    assert permissions_of(admin) == set()


def test_an_anonymous_caller_can_do_nothing(company):
    assert can(None, Perm.PEOPLE_VIEW) is False


# ── Grants ───────────────────────────────────────────────────────────────


def test_an_admin_can_grant_a_capability_to_an_officer(company, admin, officer):
    grant(admin, officer, Perm.LEAVE_APPROVE)
    assert can(officer, Perm.LEAVE_APPROVE) is True
    assert can(officer, Perm.PAYROLL_RUN) is False


def test_a_grant_is_one_row_and_revoked_on_its_own(company, admin, officer):
    """The reason for individual grants rather than bundles: a wrong grant is
    one checkbox, not a bundle somebody else also holds."""
    # Two permissions the *role* does not carry, so what is being read is the
    # grant row and not the officer default underneath it.
    grant(admin, officer, Perm.CRM_MANAGE)
    grant(admin, officer, Perm.RECRUITMENT_MANAGE)
    revoke(admin, officer, Perm.CRM_MANAGE)

    assert can(officer, Perm.CRM_MANAGE) is False
    assert can(officer, Perm.RECRUITMENT_MANAGE) is True


def test_granting_twice_is_not_two_grants(company, admin, officer):
    grant(admin, officer, Perm.LEAVE_APPROVE)
    grant(admin, officer, Perm.LEAVE_APPROVE)

    assert PermissionGrant.objects.filter(user=officer).count() == 1


def test_you_cannot_grant_what_you_do_not_hold(company, officer, staff):
    """🔒 **Delegation must not become escalation.**

    Without this rule an admin lacking payroll access could grant it to an
    officer and act through them — privilege escalation in one hop, using only
    features working exactly as designed.
    """
    # An officer given the power to appoint, but nothing else.
    PermissionGrant.objects.create(user=officer, permission=Perm.PEOPLE_ADMIN)

    with pytest.raises(PermissionError_, match="do not hold it yourself"):
        grant(officer, staff, Perm.PAYROLL_RUN)


def test_the_power_to_grant_can_never_itself_be_granted(company, admin, officer):
    """🔒 A grantable "grant permissions" is how an officer becomes an admin in
    two steps: grant yourself people.admin, then grant yourself the rest."""
    with pytest.raises(PermissionError_, match="cannot be granted"):
        grant(admin, officer, Perm.PEOPLE_ADMIN)

    assert Perm.PEOPLE_ADMIN in NEVER_GRANTABLE


def test_an_officer_cannot_grant_themselves_anything(company, officer):
    with pytest.raises(PermissionError_):
        grant(officer, officer, Perm.PAYROLL_RUN)


def test_an_employee_cannot_grant(company, staff, officer):
    with pytest.raises(PermissionError_):
        grant(staff, officer, Perm.LEAVE_APPROVE)


def test_an_invented_permission_is_refused(company, admin, officer):
    """A typo must not become a permission nobody ever holds and nobody notices."""
    with pytest.raises(PermissionError_, match="No such permission"):
        grant(admin, officer, "payrol.run")


def test_revoking_does_not_require_holding_the_permission(company, owner, officer):
    """Asymmetric with granting, deliberately: you should always be able to
    remove a capability you can see is wrong, even one you do not hold. The
    alternative is a mistaken grant outliving the person who spotted it."""
    PermissionGrant.objects.create(user=officer, permission=Perm.PAYROLL_RUN)
    limited = User.objects.create_user(
        username="limited", email="l@acme.com", password="x", role=User.Role.HR_OFFICER
    )
    PermissionGrant.objects.create(user=limited, permission=Perm.PEOPLE_ADMIN)

    revoke(limited, officer, Perm.PAYROLL_RUN)
    assert can(officer, Perm.PAYROLL_RUN) is False


# ── Appointment ──────────────────────────────────────────────────────────


def test_an_owner_can_appoint_an_hr_admin(company, owner, staff):
    set_role(owner, staff, User.Role.HR_ADMIN)
    staff.refresh_from_db()

    assert staff.role == User.Role.HR_ADMIN
    assert can(staff, Perm.PAYROLL_RUN) is True


def test_the_owner_role_cannot_be_handed_out(company, owner, staff):
    """One per company, from signup. A second owner is a second root of trust."""
    with pytest.raises(PermissionError_, match="cannot be appointed"):
        set_role(owner, staff, User.Role.OWNER)


def test_the_owner_cannot_be_demoted(company, owner, admin):
    """🔒 Otherwise a company can reach zero owners, and nobody can appoint
    anybody ever again."""
    with pytest.raises(PermissionError_, match="owner"):
        set_role(admin, owner, User.Role.EMPLOYEE)


def test_demotion_clears_grants_that_would_otherwise_linger(company, owner, officer):
    """An employee keeping `payroll.run` because nobody thought to revoke it
    separately is the quiet version of this system failing.

    Caught a real inversion when first written: the early return meant to guard
    the deletion was skipping it.
    """
    PermissionGrant.objects.create(user=officer, permission=Perm.PAYROLL_RUN)
    set_role(owner, officer, User.Role.EMPLOYEE)
    officer.refresh_from_db()

    assert can(officer, Perm.PAYROLL_RUN) is False


def test_staying_an_officer_keeps_their_grants(company, owner, officer):
    """The other half: grants exist *for* officers, so re-setting the same role
    must not quietly strip what somebody was deliberately given."""
    PermissionGrant.objects.create(user=officer, permission=Perm.PAYROLL_RUN)
    set_role(owner, officer, User.Role.HR_OFFICER)
    officer.refresh_from_db()

    assert can(officer, Perm.PAYROLL_RUN) is True


def test_an_employee_cannot_appoint_themselves(company, staff):
    with pytest.raises(PermissionError_):
        set_role(staff, staff, User.Role.HR_ADMIN)


# ── What the navigation is built from ────────────────────────────────────


def _client(company, user):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_me_reports_the_permissions_the_nav_is_built_from(company, admin):
    """The browser must not infer authorisation from `role` — that is how a
    menu and its API drift apart."""
    response = _client(company, admin).get("/api/v1/accounts/me/")

    assert response.status_code == 200
    assert Perm.PAYROLL_RUN in response.data["permissions"]
    assert Perm.DASHBOARD_VIEW in response.data["permissions"]


def test_an_employee_is_told_they_hold_nothing(company, staff):
    """Which is what empties their sidebar of links to 403 walls."""
    response = _client(company, staff).get("/api/v1/accounts/me/")

    assert response.status_code == 200
    assert response.data["permissions"] == []


def test_an_officers_list_grows_with_each_grant(company, admin, officer):
    """The nav has to follow a grant without anybody redeploying."""
    before = set(_client(company, officer).get("/api/v1/accounts/me/").data["permissions"])
    # Not in the officer default — a grant of something they already hold
    # proves nothing about grants.
    grant(admin, officer, Perm.CRM_MANAGE)
    after = set(_client(company, officer).get("/api/v1/accounts/me/").data["permissions"])

    assert Perm.CRM_MANAGE not in before
    assert after == before | {Perm.CRM_MANAGE}


def test_permissions_are_read_per_request_not_from_the_token(company, admin, officer):
    """🔒 A capability revoked this morning is gone this morning.

    Baked into the JWT, it would survive until the token expired — which is a
    revocation that does not revoke.
    """
    client = _client(company, officer)
    grant(admin, officer, Perm.CRM_MANAGE)
    assert Perm.CRM_MANAGE in client.get("/api/v1/accounts/me/").data["permissions"]

    revoke(admin, officer, Perm.CRM_MANAGE)
    # Same client, same token, no re-authentication.
    assert Perm.CRM_MANAGE not in client.get("/api/v1/accounts/me/").data["permissions"]


# ── Scope is orthogonal ──────────────────────────────────────────────────


def test_being_a_manager_grants_no_capability(company, staff):
    """🔒 Reach and capability are different axes. Conflating them produces
    managers who can run payroll."""
    from datetime import date

    from employees.models import Employee

    boss_user = User.objects.create_user(
        username="boss", email="boss@acme.com", password="x", role=User.Role.EMPLOYEE
    )
    boss = Employee.objects.create(
        user=boss_user, employee_code="EMP-8001", date_joined=date(2026, 1, 1)
    )
    report = Employee.objects.create(
        user=staff, employee_code="EMP-8002", date_joined=date(2026, 1, 1), manager=boss
    )

    assert manages(boss_user, report) is True
    assert can(boss_user, Perm.PAYROLL_RUN) is False


def test_holding_a_capability_makes_you_nobodys_manager(company, admin):
    """The other direction of the same rule: an approver with no reports
    approves nothing."""
    from datetime import date

    from employees.models import Employee

    somebody = User.objects.create_user(
        username="other", email="other@acme.com", password="x"
    )
    employee = Employee.objects.create(
        user=somebody, employee_code="EMP-8003", date_joined=date(2026, 1, 1)
    )

    assert can(admin, Perm.LEAVE_APPROVE) is True
    assert manages(admin, employee) is False


# ── The dashboard gate ───────────────────────────────────────────────────


def test_an_employee_cannot_reach_the_company_dashboard(company, staff):
    """🔒 Found as a **coverage gap**, not a failure.

    Gating the dashboard broke no test — which meant nothing in the suite had
    ever called this endpoint as a plain employee. The company-of-one bug it
    fixes (a *company* dashboard reporting `total_employees: 1` because the
    page silently scoped itself down to the caller) was never covered either.
    """
    response = _client(company, staff).get("/api/v1/dashboard/summary/")

    assert response.status_code == 403


def test_hr_still_sees_the_whole_company(company, admin):
    """A gate that blocks everybody is not a gate — and the numbers must be the
    company's, not one person's."""
    from datetime import date

    from employees.models import Employee

    for i in range(3):
        user = User.objects.create_user(
            username=f"body{i}", email=f"body{i}@acme.com", password="x"
        )
        Employee.objects.create(
            user=user, employee_code=f"EMP-95{i:02d}", date_joined=date(2026, 1, 1)
        )

    response = _client(company, admin).get("/api/v1/dashboard/summary/")

    assert response.status_code == 200
    assert response.data["total_employees"] >= 3


# ── users_with: the plural of `can` ──────────────────────────────────────


def test_users_with_finds_the_owner_that_a_role_filter_missed(company):
    """"Who should hear about this?" is a question about capability, not role.

    `User.objects.filter(role=HR_ADMIN)` misses the owner — who is not
    `hr_admin` — and a brand-new workspace's only user *is* its owner. Asked
    that way, a notification reaches nobody at all on exactly the workspaces
    least able to notice.
    """
    owner = _user(company, "solo_owner", User.Role.OWNER)

    # The role question, which misses.
    assert not User.objects.filter(role=User.Role.HR_ADMIN, pk=owner.pk).exists()
    # The right one.
    assert owner in users_with(Perm.LEAVE_APPROVE)
    assert owner in users_with(Perm.PAYROLL_RUN)


def test_users_with_finds_an_officer_holding_only_the_grant(company):
    """The other direction, and the whole point of granting anything: an
    hr_officer with `expenses.manage` and nothing else is the right person to
    tell about an expense claim, and a role filter never sees them."""
    officer = _user(company, "grantee", User.Role.HR_OFFICER)
    PermissionGrant.objects.create(user=officer, permission=Perm.EXPENSES_MANAGE)

    assert officer in users_with(Perm.EXPENSES_MANAGE)
    # Only what they were granted — a grant is one capability, not a role.
    assert officer not in users_with(Perm.PAYROLL_RUN)


def test_users_with_excludes_deactivated_accounts(company):
    """`can` returns False for an inactive user, so the plural must agree.
    A revoked account still holding a role would otherwise keep receiving
    approval requests it cannot act on."""
    admin = _user(company, "gone", User.Role.HR_ADMIN)
    assert admin in users_with(Perm.LEAVE_APPROVE)

    admin.is_active = False
    admin.save(update_fields=["is_active"])
    assert admin not in users_with(Perm.LEAVE_APPROVE)


def test_users_with_agrees_with_can_for_every_permission(company):
    """The two must not drift. `users_with` is `can` asked of everybody, and a
    clause added to one and not the other is a silent authorisation hole."""
    people = [
        _user(company, "u_owner", User.Role.OWNER),
        _user(company, "u_admin", User.Role.HR_ADMIN),
        _user(company, "u_officer", User.Role.HR_OFFICER),
        _user(company, "u_staff", User.Role.EMPLOYEE),
    ]
    PermissionGrant.objects.create(user=people[2], permission=Perm.LEAVE_APPROVE)

    for permission in ALL_PERMS:
        plural = set(users_with(permission).values_list("pk", flat=True))
        singular = {p.pk for p in people if can(p, permission)}
        assert plural >= singular, f"{permission}: users_with missed {singular - plural}"
        assert not (plural & {p.pk for p in people}) - singular, (
            f"{permission}: users_with included somebody `can` denies"
        )
