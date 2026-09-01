"""Changes an employee asks for, and HR approves.

**The fraud vector this exists to close.** A bank account number changed
silently the day before payroll runs sends somebody's salary somewhere else,
and nothing about the run looks wrong. So the fields that decide where money
goes and who somebody legally is are not editable by the person they describe —
they are *requested*, and a second person approves.

**Not a general "edit your profile" workflow.** Today an employee cannot change
their own record at all: `IsHRAdminOrReadOnly` means every correction goes
through an email to HR and a manual edit, which is both slow and unaudited. This
gives the employee a way to ask that is recorded, reviewable and attributable —
without giving them write access to the fields that matter.

**What can be requested is ours; whether to approve it is the customer's.** The
same line `notifications.reminders` and `organization.setup` draw. A company
cannot add a field to this list, because the list is what stops somebody
requesting a change to their own salary.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.utils.dateparse import parse_date


@dataclass(frozen=True)
class RequestableField:
    """A field an employee may ask to have changed.

    `sensitive` marks the ones that move money or establish identity. They are
    not treated differently *here* — every request needs approval — but the
    approval screen leads with them, and they are the reason this module is not
    simply "let employees edit their profile".
    """

    name: str
    label: str
    sensitive: bool = False


#: The allow-list. Deliberately narrow, and deliberately *not* configurable.
#:
#: Salary, employment status, department, designation and manager are all
#: absent by design: those are decisions the company makes about a person, not
#: facts about them that they would know better. A promotion is a
#: `LifecycleEvent`, which already has its own approval chain — routing it
#: through here as well would be two workflows answering one question.
REQUESTABLE_FIELDS: tuple[RequestableField, ...] = (
    # Where the money goes. The whole reason for the approval step.
    RequestableField("bank_name", "Bank name", sensitive=True),
    RequestableField("bank_branch", "Bank branch", sensitive=True),
    RequestableField("bank_account_name", "Account holder name", sensitive=True),
    RequestableField("bank_account_number", "Account number", sensitive=True),
    RequestableField("bank_account_type", "Account type", sensitive=True),
    # Who somebody legally is. These reach statutory filings.
    RequestableField("legal_first_name", "Legal first name", sensitive=True),
    RequestableField("legal_middle_name", "Legal middle name", sensitive=True),
    RequestableField("legal_last_name", "Legal last name", sensitive=True),
    RequestableField("citizenship_number", "Citizenship number", sensitive=True),
    RequestableField("pan_number", "PAN number", sensitive=True),
    RequestableField("ssf_number", "SSF/SSID number", sensitive=True),
    RequestableField("pf_number", "Provident fund number", sensitive=True),
    RequestableField("cit_number", "CIT number", sensitive=True),
    RequestableField("passport_number", "Passport number"),
    RequestableField("passport_expiry", "Passport expiry"),
    # Ordinary facts about a person that HR still wants to see change.
    RequestableField("marital_status", "Marital status"),
    RequestableField("phone", "Phone number"),
    RequestableField("address", "Address"),
)

FIELDS_BY_NAME = {field.name: field for field in REQUESTABLE_FIELDS}


class ChangeRequestError(Exception):
    """Refused for a stated reason the UI can show."""


def current_value(employee, field_name: str) -> str:
    value = getattr(employee, field_name, None)
    return "" if value in (None, "") else str(value)


def choices_for(field_name: str):
    """The valid values for a requestable field, or `None` if it is free text.

    Read by `submit`, which refuses a value outside the list, and served by the
    requestable-fields API so the form can offer a picker rather than a text
    box.

    Nothing downstream would catch a bad value: `approve` does `setattr` then
    `save()`, and Django's `save()` does not run `full_clean()`, so `choices`
    are not enforced on write. "Divorced" with a capital D would go into the
    column as typed and stop matching every query looking for
    `MaritalStatus.DIVORCED`.
    """
    from employees.models import Employee

    try:
        field = Employee._meta.get_field(field_name)
    except Exception:  # noqa: BLE001 — an unknown field is handled by the caller
        return None
    if not getattr(field, "choices", None):
        return None
    return [{"value": value, "label": label} for value, label in field.choices]


def is_date_field(field_name: str) -> bool:
    """Whether this column holds a date, so a caller can validate one.

    The sibling of `choices_for`, and it exists for the same failure. A column
    whose legal values are a *shape* rather than a list was equally unguarded:
    `approve` does `setattr` then `save()`, so "next March" in `passport_expiry`
    survives submission, sits in the queue looking like a normal request, and
    raises somewhere in the database layer when an approver presses the button —
    in front of the one person who cannot fix it.
    """
    from django.db import models

    from employees.models import Employee

    try:
        field = Employee._meta.get_field(field_name)
    except Exception:  # noqa: BLE001 — an unknown field is handled by the caller
        return False
    return isinstance(field, models.DateField) and not isinstance(field, models.DateTimeField)


def submit(employee, field_name: str, new_value: str, actor, reason: str = ""):
    """File a request. Does **not** change anything — that is the point.

    The old value is snapshotted now rather than read at approval time, so the
    approver sees what the employee was actually looking at when they asked. If
    it has since moved, that is a fact worth surfacing rather than papering
    over.
    """
    from employees.models import EmployeeChangeRequest

    field = FIELDS_BY_NAME.get(field_name)
    if field is None:
        raise ChangeRequestError(f"“{field_name}” is not a field that can be requested.")

    new_value = (new_value or "").strip()
    if not new_value:
        raise ChangeRequestError("Give the new value.")

    # Refused at submission, not at approval. A pending request holding a value
    # the column cannot legally take is a trap set for whoever approves it — and
    # the person who can still fix it easily is the one filing it.
    allowed = choices_for(field_name)
    if allowed is not None and new_value not in {c["value"] for c in allowed}:
        legal = ", ".join(c["label"] for c in allowed)
        raise ChangeRequestError(
            f"“{new_value}” is not a valid {field.label.lower()}. Choose one of: {legal}."
        )

    # Same reasoning as the choices check above, for the fields whose legal
    # values are a format rather than a list.
    if is_date_field(field_name) and parse_date(new_value) is None:
        raise ChangeRequestError(
            f"Give {field.label.lower()} as a date in YYYY-MM-DD form, like 2027-03-14."
        )

    old_value = current_value(employee, field_name)
    if new_value == old_value:
        raise ChangeRequestError("That is already the value on record.")

    # One open request per field, so an approver is never choosing between two
    # answers to the same question — the newer ask replaces the older one.
    EmployeeChangeRequest.objects.filter(
        employee=employee,
        field=field_name,
        status=EmployeeChangeRequest.Status.PENDING,
    ).update(status=EmployeeChangeRequest.Status.SUPERSEDED)

    return EmployeeChangeRequest.objects.create(
        employee=employee,
        field=field_name,
        old_value=old_value,
        new_value=new_value,
        reason=reason.strip()[:255],
        created_by=actor,
        updated_by=actor,
    )


def approve(request_row, actor, note: str = ""):
    """Approve, and **apply**.

    Approving without writing the value leaves the record unchanged while the
    queue reports it as dealt with — the exact failure this module exists to
    prevent. Both happen in one transaction, and the write is logged.

    🔒 **The requester cannot approve their own request**, including an HR admin
    asking for a change to their own bank details. This is the same reasoning as
    "you can only grant what you hold": a control that one person can complete
    end to end is not a control.
    """
    from django.db import transaction

    from employees.models import EmployeeChangeRequest, EmployeeLog

    if request_row.status != EmployeeChangeRequest.Status.PENDING:
        raise ChangeRequestError("That request has already been decided.")

    if request_row.created_by_id == getattr(actor, "id", None):
        raise ChangeRequestError(
            "You filed this request, so somebody else has to approve it."
        )

    employee = request_row.employee
    field_name = request_row.field

    with transaction.atomic():
        # Re-read rather than trusting the snapshot. If the value moved since
        # the request was filed, the approver has just approved a change from
        # something that is no longer true — worth surfacing on the record
        # rather than quietly overwriting, because "approved a change from A to
        # B" reads very differently once the value was already C.
        actual_old = current_value(employee, field_name)
        if actual_old != request_row.old_value:
            drift = f"(was “{actual_old}” at approval, not “{request_row.old_value}”)"
            note = f"{note} {drift}".strip() if note else drift

        # Guarded again here, because a row could have been filed before the
        # check above existed. `save()` does not validate choices, so this is
        # the last place a bad value can be stopped before it is in the column.
        allowed = choices_for(field_name)
        if allowed is not None and request_row.new_value not in {c["value"] for c in allowed}:
            raise ChangeRequestError(
                f"“{request_row.new_value}” is not a valid value for {field_name}. "
                "Ask for the change again with a valid option."
            )

        setattr(employee, field_name, request_row.new_value)
        employee.updated_by = actor
        employee.save(update_fields=[field_name, "updated_by", "updated_at"])

        request_row.status = EmployeeChangeRequest.Status.APPROVED
        request_row.decided_by = actor
        request_row.decision_note = note.strip()[:255]
        request_row.decided_at = _now()
        request_row.updated_by = actor
        request_row.save()

        # `EmployeeLog.Field` is a fixed set covering lifecycle changes only, so
        # these do not fit it — but an approved change to a bank account is
        # exactly the kind of thing somebody will need to reconstruct later.
        # The request row *is* that record: it carries who asked, who approved,
        # both values and both timestamps, and it is never deleted.
        _ = EmployeeLog  # documented above; no parallel history mechanism

    return request_row


def reject(request_row, actor, note: str = ""):
    """Decline, with the reason attached.

    A rejection with no note is the thing that sends the employee back to HR by
    email to ask why, which is the loop this module exists to close.
    """
    from employees.models import EmployeeChangeRequest

    if request_row.status != EmployeeChangeRequest.Status.PENDING:
        raise ChangeRequestError("That request has already been decided.")

    note = note.strip()
    if not note:
        raise ChangeRequestError("Say why you are declining it.")

    request_row.status = EmployeeChangeRequest.Status.REJECTED
    request_row.decided_by = actor
    request_row.decision_note = note[:255]
    request_row.decided_at = _now()
    request_row.updated_by = actor
    request_row.save()
    return request_row


def withdraw(request_row, actor):
    """The employee changing their mind — §R2 applied to a request.

    Anything you can file you must be able to take back, and only while it is
    still pending: withdrawing a decision somebody already made would rewrite
    the record of that decision.
    """
    from employees.models import EmployeeChangeRequest

    if request_row.status != EmployeeChangeRequest.Status.PENDING:
        raise ChangeRequestError("That request has already been decided.")

    request_row.status = EmployeeChangeRequest.Status.WITHDRAWN
    request_row.updated_by = actor
    request_row.save(update_fields=["status", "updated_by", "updated_at"])
    return request_row


def _now():
    from django.utils import timezone

    return timezone.now()
