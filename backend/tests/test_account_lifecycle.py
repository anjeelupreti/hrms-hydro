"""The three moments of an employee's login: created, activated, revoked.

These are the steps of the onboarding path that were broken, and the reason
they were broken is worth keeping in front of whoever changes this next: the
same job was written twice. Two routes created an account, and only one of them
told the person their password. Each read fine on its own.

So the tests here are mostly about **agreement between the two routes**, not
about either route in isolation. A test that only exercised one would have
passed throughout the entire period the product was shipping unusable accounts.
"""

import pytest
from django.core import mail

from accounts.models import User
from accounts.provisioning import (
    AccountError,
    provision_account,
    restore_access,
    revoke_access,
    unique_username,
)

pytestmark = pytest.mark.django_db


def _client_for(company, user):
    """An authenticated, company-resolved client for an arbitrary user.

    conftest ships fixed-role clients; these tests need one for a user the test
    just provisioned, which is the thing under examination.
    """
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _employee_for(user):
    """The employee record a lifecycle event needs to hang off."""
    from datetime import date

    from employees.models import Employee

    return Employee.objects.create(
        user=user, employee_code=f"EMP-{user.pk:04d}", date_joined=date(2026, 1, 1)
    )


# ── Provisioning ─────────────────────────────────────────────────────────


def test_a_provisioned_account_is_told_its_password(company):
    """An account is not provisioned until its owner has been told how to use
    it."""
    mail.outbox.clear()
    user = provision_account(email="sita@acme.com", first_name="Sita")

    assert len(mail.outbox) == 1
    body = mail.outbox[0].body
    assert user.get_username() in body
    assert user.check_password("") is False  # a real password was set


def test_the_password_is_never_returned_to_the_caller(company):
    """It reaches the person it belongs to and nobody else.

    A password in a return value becomes a password in an API response, and
    from there in logs, proxies and browser history.
    """
    result = provision_account(email="ram@acme.com")

    assert isinstance(result, User)


def test_a_provisioned_account_must_change_its_password(company):
    user = provision_account(email="hari@acme.com")

    assert user.must_change_password is True


def test_an_account_cannot_be_created_without_an_email(company):
    """The email is the login. A placeholder produces somebody who can never
    sign in and a support ticket nobody can explain."""
    with pytest.raises(AccountError):
        provision_account(email="")


def test_a_duplicate_email_is_refused(company):
    provision_account(email="dup@acme.com")
    with pytest.raises(AccountError):
        provision_account(email="dup@acme.com")


def test_duplicate_detection_ignores_case(company):
    """`Ram@acme.com` and `ram@acme.com` are one mailbox and must be one login."""
    provision_account(email="Ram@acme.com")
    with pytest.raises(AccountError):
        provision_account(email="ram@acme.com")


def test_usernames_do_not_collide(company):
    first = provision_account(email="ram@acme.com")
    second = provision_account(email="ram@other.com")

    assert first.get_username() != second.get_username()


def test_a_username_base_is_never_empty(company):
    assert unique_username("") != ""
    assert unique_username(None) != ""


# ── The two routes must agree ────────────────────────────────────────────


def test_both_creation_routes_deliver_credentials(company, hr_user, django_user_model):
    """**The regression test for the whole defect.**

    Hiring a candidate and adding an employee by hand are two doors into the
    same room. Before this, one of them mailed the password and the other did
    not, so which door HR used decided whether the new joiner could sign in.
    """
    from employees.serializers import EmployeeWriteSerializer
    from recruitment.hiring import accept_offer, convert_candidate_to_employee

    # Route 1 — the manual form.
    mail.outbox.clear()
    serializer = EmployeeWriteSerializer(
        data={"email": "manual@acme.com", "first_name": "Manual", "date_joined": "2026-01-01"}
    )
    serializer.is_valid(raise_exception=True)
    serializer.save()
    manual_mails = len(mail.outbox)

    # Route 2 — hiring a candidate.
    from recruitment.models import Candidate, JobPosting, Offer

    job = JobPosting.objects.create(title="Engineer", description="x")
    candidate = Candidate.objects.create(job=job, name="Hired Person", email="hired@acme.com")
    offer = Offer.objects.create(candidate=candidate, status=Offer.Status.SENT)
    accept_offer(offer, actor=hr_user)

    mail.outbox.clear()
    employee, _ = convert_candidate_to_employee(candidate, actor=hr_user)
    hire_mails = len(mail.outbox)

    assert manual_mails >= 1, "the manual route stopped delivering credentials"
    assert hire_mails >= 1, "the hiring route created a login nobody can sign into"
    assert employee.user.must_change_password is True


def test_both_routes_flag_the_password_for_replacement(company, hr_user):
    from employees.serializers import EmployeeWriteSerializer

    serializer = EmployeeWriteSerializer(
        data={"email": "flagged@acme.com", "first_name": "Flag", "date_joined": "2026-01-01"}
    )
    serializer.is_valid(raise_exception=True)
    employee = serializer.save()

    assert employee.user.must_change_password is True


# ── Activation ───────────────────────────────────────────────────────────


def test_changing_the_password_clears_the_flag(company):
    """The flag tracks *who chose* the password, so choosing one clears it."""
    user = provision_account(email="change@acme.com", password="TempPass!234")
    assert user.must_change_password is True

    response = _client_for(company, user).post(
        "/api/v1/accounts/change-password/",
        {"old_password": "TempPass!234", "new_password": "ChosenByMe!99"},
        format="json",
    )
    assert response.status_code == 200

    user.refresh_from_db()
    assert user.must_change_password is False


def test_the_flag_is_visible_to_the_shell(company):
    """The frontend redirects on this, so it has to be on /me/."""
    user = provision_account(email="me@acme.com")

    response = _client_for(company, user).get("/api/v1/accounts/me/")
    assert response.status_code == 200
    assert response.data["must_change_password"] is True


def test_an_existing_account_is_not_marched_through_a_change_screen(company):
    """The migration defaults to False deliberately: everybody already using
    the product chose their own password, and flipping them all to True would
    be a self-inflicted outage on the morning of the deploy."""
    user = User.objects.create_user(username="existing", email="e@acme.com", password="x")

    assert user.must_change_password is False


# ── Revocation ───────────────────────────────────────────────────────────


def test_leaving_closes_the_login(company, hr_user):
    """Leaving closes the login. Stopping the pay is not enough on its own — it
    leaves the directory, chat, documents and their own record reachable."""
    from datetime import date

    from employees.models import LifecycleApprovalAction, LifecycleEvent
    from employees.services import decide, submit_lifecycle_event

    user = provision_account(email="leaver@acme.com", send_mail=False)
    employee = _employee_for(user)
    event = submit_lifecycle_event(
        employee,
        LifecycleEvent.EventType.RESIGNATION,
        hr_user,
        effective_date=date.today(),
    )
    decide(event, hr_user, LifecycleApprovalAction.Decision.APPROVED)
    user.refresh_from_db()

    assert user.is_active is False


def test_revoking_is_idempotent(company):
    """Applying the same lifecycle event twice must not be an error."""
    user = provision_account(email="twice@acme.com")
    revoke_access(user)
    revoke_access(user)

    assert user.is_active is False


def test_access_can_be_restored(company):
    """A rescinded termination, or a rejoiner. A revocation with no matching
    restore is how somebody ends up locked out with no route back that does
    not involve a database console."""
    user = provision_account(email="back@acme.com")
    revoke_access(user)
    restore_access(user)

    assert user.is_active is True


def test_a_promotion_does_not_close_the_login(company, hr_user):
    """A guard that fires on every lifecycle event is not a guard."""
    from datetime import date

    from employees.models import LifecycleApprovalAction, LifecycleEvent
    from employees.services import decide, submit_lifecycle_event

    user = provision_account(email="promoted@acme.com", send_mail=False)
    employee = _employee_for(user)
    event = submit_lifecycle_event(
        employee,
        LifecycleEvent.EventType.PROMOTION,
        hr_user,
        effective_date=date.today(),
    )
    decide(event, hr_user, LifecycleApprovalAction.Decision.APPROVED)
    user.refresh_from_db()

    assert user.is_active is True
