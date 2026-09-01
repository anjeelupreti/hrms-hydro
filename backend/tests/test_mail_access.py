"""Who may read the company mailbox.

The mailbox is the one surface in the product that holds mail nobody inside the
company chose to send: whatever arrives at the company's shared address, from
whoever sends it. So "who can open it" is a question the owner has to be able
to answer, and to answer *separately* from every other question about roles.

`MAIL_ACCESS` is its own capability. `IsHRAdmin` falls through to
`PEOPLE_MANAGE` when a viewset names none, which would make the mailbox
readable by exactly the people who maintain employment records — two unrelated
jobs behind one switch, with no way for an owner to grant one without the other.

The nav entry carries the same permission, so an employee is not shown a link
that answers 403 — but that is presentation. These tests are about the door.
"""

import pytest
from django.contrib.auth import get_user_model

from accounts.policy import Perm, grant

pytestmark = [pytest.mark.django_db]


@pytest.fixture
def owner_user(company):
    """The workspace owner — the only actor who can hand out a capability they
    hold by role rather than by grant. There is no shared fixture for one
    because most tests do not need the distinction."""
    user = get_user_model().objects.create_user(
        username="owner-for-mail",
        email="owner-for-mail@example.com",
        password="test-pass-123",
        role="owner",
    )
    return user

MAIL = "/api/v1/mail/messages/"


def test_an_employee_cannot_read_the_company_mailbox(employee_client):
    assert employee_client.get(MAIL).status_code == 403


def test_an_hr_admin_can(hr_client):
    assert hr_client.get(MAIL).status_code == 200


def test_the_owner_can_grant_mailbox_access_to_somebody_else(
    company, owner_user, employee_user, employee_client
):
    """The point of the whole change.

    Somebody in the secretariat or finance may need the mailbox and have no
    business editing people — and before this there was no way to say so.
    """
    assert employee_client.get(MAIL).status_code == 403

    grant(owner_user, employee_user, Perm.MAIL_ACCESS)

    assert employee_client.get(MAIL).status_code == 200


def test_mailbox_access_does_not_carry_people_management_with_it(
    company, owner_user, employee_user, employee_client
):
    """Granting one must not quietly hand over the other.

    This is the half of the split that is easy to get wrong: it is not enough
    that mail has its own permission if holding it still implies the old one.
    """
    grant(owner_user, employee_user, Perm.MAIL_ACCESS)

    assert employee_client.get(MAIL).status_code == 200
    assert employee_client.get("/api/v1/employees/employees/").status_code in (200, 403)

    from accounts.policy import can

    employee_user.refresh_from_db()
    assert can(employee_user, Perm.MAIL_ACCESS) is True
    assert can(employee_user, Perm.PEOPLE_MANAGE) is False


def test_attachments_are_gated_the_same_way(employee_client):
    """An attachment is not less sensitive than the mail that carried it."""
    response = employee_client.get("/api/v1/mail/attachments/1/download/")
    # 403 rather than 404: refused before the row is ever looked for.
    assert response.status_code == 403


def test_the_capability_is_offered_to_the_owner_to_grant(admin_client):
    """It has to appear on Roles & permissions, or the owner cannot use it.

    The screen is driven by `ALL_PERMS`, so this is really asserting that the
    permission was added to the catalogue rather than special-cased in the mail
    module — which is what makes it grantable at all.
    """
    body = admin_client.get("/api/v1/accounts/team/catalogue/").json()
    values = [p["value"] for p in body["permissions"]]
    assert Perm.MAIL_ACCESS in values
    assert next(p for p in body["permissions"] if p["value"] == Perm.MAIL_ACCESS)["grantable"]
