"""Suspension: the interval, the lock, and how it ends.

The property worth pinning above all others is that **the roster and the login
never disagree**. Three facts move together — the suspension's own flag, the
employment status, and `User.is_active`, which is what actually stops somebody
signing in — and a bug in any one of them produces either a person marked
suspended who can still work, or a person locked out with nothing on any screen
to say why.
"""

from datetime import date, timedelta

import pytest

from accounts.policy import Perm, can
from employees.models import Employee, Suspension
from employees.suspensions import SuspensionError, is_suspended, lift, suspend, sweep

pytestmark = pytest.mark.django_db

LIST = "/api/v1/employees/suspensions/"


@pytest.fixture
def worker(db, employee_user, company):
    return Employee.objects.create(
        user=employee_user,
        employee_code="EMP-S1",
        date_joined=date(2024, 1, 1),
        primary_company=company,
    )


# ── The lock ─────────────────────────────────────────────────────────────


def test_suspending_locks_the_account_and_moves_the_status(worker):
    suspend(worker, starts_on=date.today(), ends_on=date.today() + timedelta(days=7), reason="Inquiry")

    worker.refresh_from_db()
    worker.user.refresh_from_db()
    assert worker.employment_status == Employee.EmploymentStatus.SUSPENDED
    assert worker.user.is_active is False
    assert is_suspended(worker)


def test_a_suspended_account_holds_no_capability(worker, officer_user):
    """`can` fails closed on an inactive user, so a granted permission does not
    survive a suspension. Asserted here rather than trusted, because it is the
    difference between a lock-out and a locked screen with a working API."""
    from accounts.models import PermissionGrant

    PermissionGrant.objects.create(user=worker.user, permission=Perm.PEOPLE_VIEW)
    assert can(worker.user, Perm.PEOPLE_VIEW) is True

    suspend(worker, starts_on=date.today(), reason="Pending inquiry")

    worker.user.refresh_from_db()
    assert can(worker.user, Perm.PEOPLE_VIEW) is False


def test_a_future_suspension_does_not_lock_anybody_yet(worker):
    """The interval means what it says. A suspension starting next Monday must
    not take somebody's access away this Thursday."""
    suspend(worker, starts_on=date.today() + timedelta(days=4), reason="Scheduled")

    worker.refresh_from_db()
    worker.user.refresh_from_db()
    assert worker.user.is_active is True
    assert worker.employment_status == Employee.EmploymentStatus.ACTIVE


def test_two_suspensions_cannot_overlap(worker):
    """Two live suspensions would each claim to be the reason somebody is
    locked out, and lifting one would leave the account locked with no visible
    cause."""
    suspend(worker, starts_on=date.today(), ends_on=date.today() + timedelta(days=10), reason="One")

    with pytest.raises(SuspensionError, match="already suspended"):
        suspend(worker, starts_on=date.today() + timedelta(days=2), reason="Two")


def test_a_leaver_cannot_be_suspended(worker):
    worker.employment_status = Employee.EmploymentStatus.TERMINATED
    worker.save()

    with pytest.raises(SuspensionError, match="already left"):
        suspend(worker, starts_on=date.today(), reason="Too late")


def test_an_end_date_before_the_start_is_refused(worker):
    with pytest.raises(SuspensionError, match="cannot end before"):
        suspend(
            worker,
            starts_on=date.today(),
            ends_on=date.today() - timedelta(days=1),
            reason="Backwards",
        )


# ── Lifting ──────────────────────────────────────────────────────────────


def test_reinstating_gives_the_account_back(worker):
    suspension = suspend(worker, starts_on=date.today(), reason="Inquiry")

    lift(suspension, outcome=Suspension.Outcome.REINSTATED, note="Cleared")

    worker.refresh_from_db()
    worker.user.refresh_from_db()
    assert worker.user.is_active is True
    assert worker.employment_status == Employee.EmploymentStatus.ACTIVE
    suspension.refresh_from_db()
    assert suspension.is_active is False
    assert suspension.lifted_on == date.today()


def test_ending_in_termination_does_not_reopen_the_account(worker):
    """The one case where lifting a suspension must *not* hand the login back.

    A dismissal is an exit, and an offboarding flow that finds a working
    account waiting for it has been handed the wrong starting point.
    """
    suspension = suspend(worker, starts_on=date.today(), reason="Gross misconduct")

    lift(suspension, outcome=Suspension.Outcome.TERMINATED, note="Dismissed")

    worker.refresh_from_db()
    worker.user.refresh_from_db()
    assert worker.employment_status == Employee.EmploymentStatus.TERMINATED
    assert worker.user.is_active is False


def test_an_outcome_is_required(worker):
    suspension = suspend(worker, starts_on=date.today(), reason="Inquiry")

    with pytest.raises(SuspensionError, match="how the suspension ended"):
        lift(suspension, outcome=Suspension.Outcome.PENDING)


# ── The sweep ────────────────────────────────────────────────────────────


def test_the_sweep_lifts_a_suspension_whose_interval_has_run_out(worker):
    """The interval exists so the suspension can end itself. Without this,
    unlocking on the right morning is somebody's diary entry."""
    suspension = suspend(
        worker,
        starts_on=date.today() - timedelta(days=10),
        ends_on=date.today() - timedelta(days=1),
        reason="Seven days",
    )
    # Force the stale state a missed sweep would leave behind.
    Suspension.objects.filter(pk=suspension.pk).update(is_active=True)
    Employee.objects.filter(pk=worker.pk).update(
        employment_status=Employee.EmploymentStatus.SUSPENDED
    )
    worker.user.is_active = False
    worker.user.save()

    sweep()

    worker.refresh_from_db()
    worker.user.refresh_from_db()
    assert worker.user.is_active is True
    assert worker.employment_status == Employee.EmploymentStatus.ACTIVE


def test_the_sweep_starts_one_whose_day_has_come(worker):
    suspend(worker, starts_on=date.today(), ends_on=date.today() + timedelta(days=3), reason="Now")
    # Undo the immediate effect, as though the record had been created ahead of
    # its start date and nothing had run since.
    worker.user.is_active = True
    worker.user.save()

    sweep()

    worker.user.refresh_from_db()
    assert worker.user.is_active is False


def test_the_sweep_is_idempotent(worker):
    suspend(worker, starts_on=date.today(), ends_on=date.today() + timedelta(days=3), reason="Now")

    assert sweep() == 0, "nothing was out of step, so nothing should have been touched"


def test_a_suspension_does_not_overwrite_a_leaver_status(worker):
    """Between `active` and `suspended` only. A suspension ending must not
    quietly mark a resigned employee as active again."""
    suspension = suspend(worker, starts_on=date.today(), reason="Inquiry")
    Employee.objects.filter(pk=worker.pk).update(
        employment_status=Employee.EmploymentStatus.RESIGNED
    )

    lift(suspension, outcome=Suspension.Outcome.REINSTATED)

    worker.refresh_from_db()
    assert worker.employment_status == Employee.EmploymentStatus.RESIGNED


# ── Signing in ───────────────────────────────────────────────────────────


def test_a_suspended_person_is_told_why_rather_than_that_their_password_is_wrong(
    api_client, worker
):
    """The default refusal is "No active account found with the given
    credentials", which is indistinguishable from a typo — so somebody spends
    the morning resetting a password that was never wrong."""
    worker.user.set_password("known-password")
    worker.user.save()
    suspend(worker, starts_on=date.today(), ends_on=date.today() + timedelta(days=5), reason="Inquiry")

    response = api_client.post(
        "/api/v1/accounts/token/",
        {"username": worker.user.get_username(), "password": "known-password"},
        format="json",
    )

    assert response.status_code == 401
    assert response.data["code"] == "account_suspended"
    assert "suspended" in response.data["detail"]


def test_a_reinstated_person_can_sign_in_again(api_client, worker):
    worker.user.set_password("known-password")
    worker.user.save()
    suspension = suspend(worker, starts_on=date.today(), reason="Inquiry")
    lift(suspension, outcome=Suspension.Outcome.REINSTATED)

    response = api_client.post(
        "/api/v1/accounts/token/",
        {"username": worker.user.get_username(), "password": "known-password"},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert "access" in response.data


# ── Over the wire ────────────────────────────────────────────────────────


def test_hr_can_suspend_through_the_api(admin_client, worker):
    response = admin_client.post(
        LIST,
        {
            "employee": worker.pk,
            "starts_on": str(date.today()),
            "ends_on": str(date.today() + timedelta(days=14)),
            "reason": "Pending inquiry into the 14 Poush incident.",
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["is_active"] is True
    worker.user.refresh_from_db()
    assert worker.user.is_active is False


def test_lifting_over_the_wire_needs_an_outcome(admin_client, worker):
    suspension = suspend(worker, starts_on=date.today(), reason="Inquiry")

    refused = admin_client.post(f"{LIST}{suspension.pk}/lift/", {}, format="json")
    assert refused.status_code == 400

    accepted = admin_client.post(
        f"{LIST}{suspension.pk}/lift/",
        {"outcome": "reinstated", "note": "Cleared"},
        format="json",
    )
    assert accepted.status_code == 200, accepted.data
    assert accepted.data["outcome"] == "reinstated"


def test_an_employee_sees_their_own_suspension_and_nobody_elses(
    employee_client, worker, hr_user, company
):
    """Being told you are suspended is not optional."""
    other = Employee.objects.create(
        user=hr_user, employee_code="EMP-S2",
        date_joined=date(2024, 1, 1), primary_company=company,
    )
    suspend(worker, starts_on=date.today(), reason="Mine")
    suspend(other, starts_on=date.today(), reason="Theirs")

    response = employee_client.get(LIST)

    assert response.status_code == 200, response.data
    reasons = {row["reason"] for row in response.data["results"]}
    assert reasons == {"Mine"}


def test_an_employee_cannot_suspend_anybody(employee_client, worker):
    response = employee_client.post(
        LIST,
        {"employee": worker.pk, "starts_on": str(date.today()), "reason": "No"},
        format="json",
    )

    assert response.status_code == 403


def test_the_profile_says_why_and_until_when(admin_client, worker):
    """A bare "Suspended" chip with no date is the thing people ask HR about."""
    suspend(
        worker,
        starts_on=date.today(),
        ends_on=date.today() + timedelta(days=7),
        reason="Pending inquiry",
    )

    response = admin_client.get(f"/api/v1/employees/employees/{worker.pk}/")

    assert response.status_code == 200, response.data
    active = response.data["active_suspension"]
    assert active is not None
    assert active["reason"] == "Pending inquiry"
    assert active["ends_on"] == date.today() + timedelta(days=7)
