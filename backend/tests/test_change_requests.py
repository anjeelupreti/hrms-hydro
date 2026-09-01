"""Profile change requests — the approval step in front of a bank account.

**The defect being prevented is a fraud vector, not an inconvenience.** A bank
account number changed silently the day before payroll sends somebody's salary
somewhere else, and nothing about the run looks wrong afterwards. So the tests
that matter here are the ones about *who can complete a change end to end*, not
the ones about CRUD.
"""

import pytest

from employees.change_requests import ChangeRequestError, approve, submit, withdraw
from employees.models import Employee, EmployeeChangeRequest

pytestmark = pytest.mark.django_db

URL = "/api/v1/employees/change-requests/"


@pytest.fixture
def worker(company, employee_user):
    """An ordinary employee with a record and no permissions."""
    from datetime import date

    yield Employee.objects.create(
        user=employee_user,
        employee_code="EMP-500",
        date_joined=date(2026, 1, 1),
        bank_account_number="1234567890",
    )


def test_filing_a_request_changes_nothing(company, worker, employee_user):
    """🔒 The whole point. A request is an ask, not an edit."""
    submit(worker, "bank_account_number", "9999999999", actor=employee_user)

    worker.refresh_from_db()
    assert worker.bank_account_number == "1234567890"
    assert EmployeeChangeRequest.objects.filter(status="pending").count() == 1


def test_approving_applies_the_change(company, worker, employee_user, admin_user):
    """Approving without writing the value would leave the record unchanged
    while the queue said it was dealt with — the failure this is a fix for."""
    row = submit(worker, "bank_account_number", "9999999999", actor=employee_user)

    approve(row, actor=admin_user)

    worker.refresh_from_db()
    assert worker.bank_account_number == "9999999999"
    row.refresh_from_db()
    assert row.status == EmployeeChangeRequest.Status.APPROVED
    assert row.decided_by_id == admin_user.id
    assert row.decided_at is not None


def test_the_requester_cannot_approve_their_own_request(company, worker, admin_user):
    """🔒 Segregation of duties, and the reason this is not just an edit form.

    An HR admin who can both file and approve can move their own salary to a
    different account in two clicks, with the audit trail showing an approved
    request. A control one person completes end to end is not a control.
    """
    # Filed by the admin, on their own behalf.
    own = Employee.objects.create(
        user=admin_user, employee_code="EMP-501", date_joined="2026-01-01"
    )
    row = submit(own, "bank_account_number", "5555555555", actor=admin_user)

    with pytest.raises(ChangeRequestError, match="somebody else"):
        approve(row, actor=admin_user)

    own.refresh_from_db()
    assert own.bank_account_number != "5555555555"
    row.refresh_from_db()
    assert row.status == EmployeeChangeRequest.Status.PENDING


def test_only_allow_listed_fields_can_be_requested(company, worker, employee_user):
    """The allow-list is what stops somebody requesting a change to their own
    salary, so it is refused in the service rather than filtered in a form."""
    for forbidden in ("employment_status", "employee_code", "date_joined"):
        with pytest.raises(ChangeRequestError, match="not a field"):
            submit(worker, forbidden, "anything", actor=employee_user)


def test_asking_again_supersedes_the_earlier_ask(company, worker, employee_user):
    """An approver must never be choosing between two answers to one question.

    Superseded rather than deleted: "I never asked" and "I asked and changed my
    mind" are different facts, and the sequence is worth keeping.
    """
    first = submit(worker, "phone", "9800000001", actor=employee_user)
    second = submit(worker, "phone", "9800000002", actor=employee_user)

    first.refresh_from_db()
    assert first.status == EmployeeChangeRequest.Status.SUPERSEDED
    assert second.status == EmployeeChangeRequest.Status.PENDING
    assert EmployeeChangeRequest.objects.filter(field="phone").count() == 2


def test_requesting_the_value_it_already_has_is_refused(company, worker, employee_user):
    """Otherwise the queue fills with requests that change nothing, and the
    ones that matter are harder to find."""
    with pytest.raises(ChangeRequestError, match="already"):
        submit(worker, "bank_account_number", "1234567890", actor=employee_user)


def test_a_decided_request_cannot_be_decided_again(company, worker, employee_user, admin_user):
    row = submit(worker, "phone", "9800000003", actor=employee_user)
    approve(row, actor=admin_user)

    with pytest.raises(ChangeRequestError, match="already been decided"):
        approve(row, actor=admin_user)


def test_a_pending_request_can_be_withdrawn_but_a_decided_one_cannot(
    company, worker, employee_user, admin_user
):
    """§R2 — anything you can file you can take back, until somebody has acted
    on it. Withdrawing a decision would rewrite the record of that decision."""
    row = submit(worker, "address", "New place", actor=employee_user)
    withdraw(row, actor=employee_user)
    row.refresh_from_db()
    assert row.status == EmployeeChangeRequest.Status.WITHDRAWN

    other = submit(worker, "phone", "9800000004", actor=employee_user)
    approve(other, actor=admin_user)
    with pytest.raises(ChangeRequestError):
        withdraw(other, actor=employee_user)


def test_drift_between_asking_and_approving_is_recorded(
    company, worker, employee_user, admin_user
):
    """The value moved after the request was filed.

    The approver has just approved a change *from* something that is no longer
    true, and "approved a change from A to B" reads very differently once the
    value was already C. Surfaced on the record rather than silently overwritten.
    """
    row = submit(worker, "phone", "9800000005", actor=employee_user)

    worker.phone = "9811111111"
    worker.save(update_fields=["phone"])

    approve(row, actor=admin_user)

    row.refresh_from_db()
    assert "9811111111" in row.decision_note


def test_rejecting_needs_a_reason(company, worker, employee_user, admin_user):
    """A refusal with no reason sends the employee back to HR by email to ask
    why, which is the loop this module exists to close."""
    from employees.change_requests import reject

    row = submit(worker, "phone", "9800000006", actor=employee_user)

    with pytest.raises(ChangeRequestError, match="why"):
        reject(row, actor=admin_user, note="")

    reject(row, actor=admin_user, note="Ring the office to confirm first.")
    row.refresh_from_db()
    assert row.status == EmployeeChangeRequest.Status.REJECTED
    assert row.decision_note


# ── Through the API ──────────────────────────────────────────────────────────


def test_an_employee_sees_only_their_own_requests(
    company, worker, employee_client, admin_user
):
    """Somebody else's request to change their bank details is not information
    this person was refused — it is none of their business. So an empty list,
    not a 403, which would confirm there is something there."""
    from datetime import date

    other = Employee.objects.create(
        user=admin_user, employee_code="EMP-502", date_joined=date(2026, 1, 1)
    )
    submit(other, "phone", "9800000007", actor=admin_user)
    submit(worker, "phone", "9800000008", actor=worker.user)

    response = employee_client.get(URL)

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["employee"] == worker.id


def test_an_employee_cannot_approve_anything(company, worker, employee_client):
    row = submit(worker, "phone", "9800000009", actor=worker.user)

    response = employee_client.post(f"{URL}{row.id}/approve/", {}, format="json")

    assert response.status_code == 403
    row.refresh_from_db()
    assert row.status == EmployeeChangeRequest.Status.PENDING


def test_the_requestable_fields_are_served_with_their_current_values(
    company, worker, employee_client
):
    """The allow-list is a security rule, so the browser reads it rather than
    keeping a second copy that can drift."""
    response = employee_client.get(f"{URL}fields/")

    assert response.status_code == 200
    by_name = {row["name"]: row for row in response.data}
    assert by_name["bank_account_number"]["sensitive"] is True
    assert by_name["bank_account_number"]["current"] == "1234567890"
    assert by_name["phone"]["sensitive"] is False
    # Nothing outside the list, however much a caller would like it there.
    assert "employment_status" not in by_name


def test_hr_can_file_on_somebody_elses_behalf_but_still_cannot_self_approve(
    company, worker, admin_client, admin_user
):
    """People do ring up and read out a new account number, so HR filing is
    allowed — and it is still a request, so the same person cannot close it."""
    filed = admin_client.post(
        URL,
        {"employee": worker.id, "field": "bank_account_number", "new_value": "7777777777"},
        format="json",
    )
    assert filed.status_code == 201

    approved = admin_client.post(f"{URL}{filed.data['id']}/approve/", {}, format="json")

    assert approved.status_code == 400
    assert "somebody else" in str(approved.data).lower()
    worker.refresh_from_db()
    assert worker.bank_account_number == "1234567890"


# ── A constrained column must not be filled from a text box ──────────────
#
# A constrained column must be validated at submission. `approve` does
# `setattr` + `save()`, and Django's `save()` does not run `full_clean()`, so
# `choices` are never enforced on write — "Divorced" with a capital D would go
# into the column as typed and stop matching every query looking for it.


def test_a_choice_field_refuses_a_value_outside_its_choices(company, worker, employee_user):
    """Refused at submission — the person who can still fix it easily is the one
    filing it, not the approver staring at a value the column cannot take."""
    with pytest.raises(ChangeRequestError):
        submit(worker, "marital_status", "Divorced", actor=employee_user)   # capital D
    with pytest.raises(ChangeRequestError):
        submit(worker, "marital_status", "seperated", actor=employee_user)  # not a choice

    assert EmployeeChangeRequest.objects.count() == 0


def test_a_choice_field_accepts_a_legal_value(company, worker, employee_user, admin_user):
    """And the valid one still goes all the way through, or the guard has simply
    broken the feature."""
    row = submit(worker, "marital_status", "married", actor=employee_user)
    approve(row, actor=admin_user)

    worker.refresh_from_db()
    assert worker.marital_status == "married"


def test_approval_is_guarded_too_for_rows_filed_before_the_check(
    company, worker, employee_user, admin_user
):
    """The submission guard cannot help a row that predates it. `save()` does
    not validate choices, so approval is the last place a bad value can be
    stopped before it is in the column."""
    row = submit(worker, "marital_status", "married", actor=employee_user)
    # Bypass the submission guard the way an older row would have.
    EmployeeChangeRequest.objects.filter(pk=row.pk).update(new_value="Divorced")
    row.refresh_from_db()

    with pytest.raises(ChangeRequestError):
        approve(row, actor=admin_user)

    worker.refresh_from_db()
    assert worker.marital_status != "Divorced"


def test_free_text_fields_are_still_free_text(company, worker, employee_user):
    """The guard must apply only where the column is constrained. A phone number
    has no `choices`, and rejecting one would be worse than the bug."""
    row = submit(worker, "phone", "+977-9812345678", actor=employee_user)
    assert row.new_value == "+977-9812345678"


def test_the_api_serves_the_choices_it_validates_against(company, worker):
    """The picker and the guard have to agree. Two lists would drift, and the
    drift would show up as a form offering a value the server refuses."""
    from employees.change_requests import choices_for

    options = choices_for("marital_status")
    assert options is not None
    assert {c["value"] for c in options} == {"single", "married", "divorced", "widowed"}
    # Free text reports None, so the client can tell "choose" from "type".
    assert choices_for("phone") is None


def test_a_date_field_refuses_a_value_that_is_not_a_date(company, worker, employee_user):
    """The sibling of the choices guard, for columns whose legal values are a
    format rather than a list.

    Without it `passport_expiry` accepted "next March", sat in the queue looking
    like any other request, and raised out of the database layer when somebody
    pressed Approve — in front of the one person who could not fix it. Refusing
    at submission puts the error where the value was typed.
    """
    with pytest.raises(ChangeRequestError) as exc:
        submit(worker, "passport_expiry", "next March", actor=employee_user)
    assert "YYYY-MM-DD" in str(exc.value)

    assert EmployeeChangeRequest.objects.count() == 0

    # A real date still goes through, and still applies on approval.
    row = submit(worker, "passport_expiry", "2031-04-09", actor=employee_user)
    assert row.new_value == "2031-04-09"


def test_the_api_says_which_fields_are_dates(company, worker):
    """The form offers a calendar off this flag. If it disagreed with the guard,
    the picker would be shown for a field the server treats as free text — or,
    worse, withheld from the one it validates."""
    from employees.change_requests import is_date_field

    assert is_date_field("passport_expiry") is True
    assert is_date_field("phone") is False
    assert is_date_field("bank_account_number") is False
