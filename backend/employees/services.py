from datetime import date

from django.db import transaction
from django.utils import timezone

from accounts.provisioning import revoke_access
from employees.models import Employee, EmployeeLog, LifecycleApprovalAction, LifecycleEvent
from employees.offboarding import start_offboarding
from notifications.services import notify

EventType = LifecycleEvent.EventType
Status = LifecycleEvent.Status


@transaction.atomic
def submit_lifecycle_event(employee, event_type, actor, **fields):
    """Award needs no approval — it doesn't change any Employee field, so
    it's applied (logged as a LifecycleEvent, nothing more) immediately.
    Every other event type starts PENDING_APPROVAL."""
    if event_type == EventType.AWARD:
        event = LifecycleEvent.objects.create(
            employee=employee,
            event_type=event_type,
            status=Status.APPLIED,
            applied_at=timezone.now(),
            created_by=actor,
            updated_by=actor,
            **fields,
        )
        return event

    event = LifecycleEvent.objects.create(
        employee=employee,
        event_type=event_type,
        status=Status.PENDING_APPROVAL,
        created_by=actor,
        updated_by=actor,
        **fields,
    )
    _notify_hr_admins(event)
    return event


def _notify_hr_admins(event):
    from accounts.policy import Perm, users_with

    message = (
        f"{event.employee.user.get_full_name() or event.employee.employee_code} has a "
        f"{event.get_event_type_display()} request pending approval, effective {event.effective_date}."
    )
    for admin in users_with(Perm.PEOPLE_MANAGE):
        notify(admin, "lifecycle_event_pending", message, email_subject="Lifecycle event awaiting approval")


@transaction.atomic
def decide(event, actor, decision, comment=""):
    if event.status != Status.PENDING_APPROVAL:
        raise ValueError("This event has already been decided.")

    LifecycleApprovalAction.objects.create(event=event, decision=decision, comment=comment, actor=actor)

    if decision == LifecycleApprovalAction.Decision.REJECTED:
        event.status = Status.REJECTED
        event.updated_by = actor
        event.save(update_fields=["status", "updated_by", "updated_at"])
        notify(
            event.employee.user,
            "lifecycle_event_rejected",
            f"Your {event.get_event_type_display()} request was rejected." + (f" Reason: {comment}" if comment else ""),
            email_subject="Lifecycle event rejected",
        )
        return event

    event.status = Status.APPROVED
    event.updated_by = actor
    event.save(update_fields=["status", "updated_by", "updated_at"])

    if event.effective_date <= date.today():
        apply_event(event, actor=actor)
    else:
        notify(
            event.employee.user,
            "lifecycle_event_approved",
            f"Your {event.get_event_type_display()} request was approved, effective {event.effective_date}.",
            email_subject="Lifecycle event approved",
        )
    return event


def cancel(event, actor):
    if event.status != Status.PENDING_APPROVAL:
        raise ValueError("Only a pending event can be cancelled.")
    event.status = Status.CANCELLED
    event.updated_by = actor
    event.save(update_fields=["status", "updated_by", "updated_at"])
    return event


@transaction.atomic
def apply_event(event, actor=None):
    """Applies the underlying Employee field change for an APPROVED event
    whose effective_date has arrived, and writes to the existing
    EmployeeLog — no parallel history mechanism, per docs/development-plan.md."""
    employee = event.employee
    changes = {}

    if event.event_type == EventType.PROMOTION and event.new_designation_id:
        changes[EmployeeLog.Field.DESIGNATION] = event.new_designation
    elif event.event_type == EventType.TRANSFER:
        if event.new_department_id:
            changes[EmployeeLog.Field.DEPARTMENT] = event.new_department
        if event.new_manager_id:
            changes[EmployeeLog.Field.MANAGER] = event.new_manager
    elif event.event_type == EventType.RESIGNATION:
        changes[EmployeeLog.Field.EMPLOYMENT_STATUS] = Employee.EmploymentStatus.RESIGNED
    elif event.event_type == EventType.TERMINATION:
        changes[EmployeeLog.Field.EMPLOYMENT_STATUS] = Employee.EmploymentStatus.TERMINATED

    field_attr = {
        EmployeeLog.Field.DESIGNATION: "designation",
        EmployeeLog.Field.DEPARTMENT: "department",
        EmployeeLog.Field.MANAGER: "manager",
        EmployeeLog.Field.EMPLOYMENT_STATUS: "employment_status",
    }

    entries = []
    update_fields = []
    for log_field, new_value in changes.items():
        attr = field_attr[log_field]
        old_value = getattr(employee, attr)
        if old_value == new_value:
            continue
        entries.append(
            EmployeeLog(
                employee=employee,
                field=log_field,
                from_value=str(old_value) if old_value is not None else "",
                to_value=str(new_value) if new_value is not None else "",
                actor=actor or event.updated_by,
            )
        )
        setattr(employee, attr, new_value)
        update_fields.append(attr)

    if update_fields:
        employee.updated_by = actor or event.updated_by
        employee.save(update_fields=update_fields + ["updated_by", "updated_at"])
    if entries:
        EmployeeLog.objects.bulk_create(entries)

    # Leaving closes the login, in the same service that stops the pay.
    #
    # These were separate before, which is the worst version of the two: the
    # same approved event decided both, so a company reasonably assumed one
    # implied the other — and a leaver kept the directory, chat, documents and
    # their own record. Being paid and being able to sign in are different
    # questions, but they are answered by one decision, so they belong here.
    #
    # Safe for the final payslip: payroll selects on the employee record and
    # who was payable during the period, never on `User.is_active`.
    if event.event_type in (EventType.RESIGNATION, EventType.TERMINATION):
        revoke_access(employee.user, reason=event.get_event_type_display().lower())

        # Leaving is built as the mirror of arriving. Hiring instantiates an
        # onboarding checklist automatically; until now leaving instantiated
        # nothing, so the two halves of one lifecycle were held to different
        # standards. Silent when no template is configured, for the same reason
        # hiring is: a missing checklist must not fail the resignation itself.
        start_offboarding(employee, event=event, actor=actor or event.updated_by)

    event.status = Status.APPLIED
    event.applied_at = timezone.now()
    event.save(update_fields=["status", "applied_at"])

    notify(
        employee.user,
        "lifecycle_event_applied",
        f"Your {event.get_event_type_display()} is now effective.",
        email_subject="Lifecycle event effective",
    )
    return event


class RehireError(Exception):
    """Refused for a stated reason the UI can show."""


def rehire(employee, actor, date_joined=None, note=""):
    """Bring a former employee back — **the same person, the same record.**

    **The existing account is reactivated; a returning employee is not asked
    for a new email** (D23). A person is not a new person, and a second address
    forks their history in two — one record holding their service, documents and
    past payslips, another holding everything from now on, and neither able to
    answer "how long have they been here?".

    So the record is reused, the login is re-opened, and the return is written
    to `EmployeeLog` like any other status change. What is *not* reused is the
    join date: `date_joined` may be reset to the day they actually came back,
    because leave accrual and probation both count from it and a gap of two
    years is not service.

    Refused for somebody who has not left, because "rehire" would then be a
    silent no-op that reads as though it did something.
    """
    from accounts.provisioning import restore_access

    if employee.employment_status == Employee.EmploymentStatus.ACTIVE:
        raise RehireError(f"{employee.employee_code} is already active.")

    # **Suspended is not "gone".** A suspension leaves the status at `suspended`
    # and the login closed, which from here looks exactly like somebody who has
    # left — so rehiring one would set them active and hand the account back
    # through `restore_access`, with the suspension record still saying it is in
    # force. That is the one state `employees/suspensions.py` exists to make
    # impossible, reached through a door it does not own.
    if employee.employment_status == Employee.EmploymentStatus.SUSPENDED:
        raise RehireError(
            f"{employee.employee_code} is suspended, not a leaver. "
            "Lift the suspension instead — that is what returns their access."
        )

    previous = employee.employment_status

    with transaction.atomic():
        employee.employment_status = Employee.EmploymentStatus.ACTIVE
        fields = ["employment_status", "updated_by", "updated_at"]
        if date_joined is not None:
            # Deliberately optional. Some returns are a rescinded resignation a
            # week later, where the original date is still the right one.
            employee.date_joined = date_joined
            fields.append("date_joined")
        employee.updated_by = actor
        employee.save(update_fields=fields)

        EmployeeLog.objects.create(
            employee=employee,
            field=EmployeeLog.Field.EMPLOYMENT_STATUS,
            from_value=previous,
            to_value=Employee.EmploymentStatus.ACTIVE,
            actor=actor,
        )

        # The login, which offboarding closed. Without this they are "active"
        # on paper and cannot sign in — the exact half-done state `restore_access`
        # exists to prevent.
        restore_access(employee.user)

    return employee
