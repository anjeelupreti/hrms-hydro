"""Suspending somebody, lifting it, and keeping the lock honest.

**One function writes the lock, and it writes all three things at once.** A
suspension has to move three facts together: the `Suspension.is_active` flag,
the employee's `employment_status`, and `User.is_active`, which is what
actually stops them signing in. Any view that set one of those on its own would
produce the failure this module exists to prevent — a roster saying "suspended"
next to an account that still works, or the reverse, which is somebody locked
out with nothing on screen to say why.

**Why the lock is `User.is_active`.** SimpleJWT's authentication checks that
flag on every request, so a suspension bites on the next call rather than
whenever a fifteen-minute access token happens to expire. The alternative —
checking a suspension table inside the token serializer — only catches *new*
sign-ins, so the person being walked out of the building keeps their session
for the rest of the quarter-hour. It also, for free, blocks the refresh
endpoint and `accounts.policy.can`, which both fail closed on an inactive user.

**Why `is_active` is stored on the suspension rather than derived on read.**
Because it drives a flag on another table. A computed property would be correct
in the abstract and would still leave `User.is_active` to be written by
somebody remembering to; storing it means there is exactly one place that knows
they change together.
"""

from __future__ import annotations

from datetime import date

from django.db import transaction

from employees.models import Employee, Suspension


class SuspensionError(Exception):
    """The suspension cannot be recorded as asked."""


def active_suspension(employee: Employee, on_date: date | None = None) -> Suspension | None:
    """The suspension in force for this person, if any.

    Reads the dates rather than the `is_active` flag. The flag is what the
    lock-out is derived from and is kept up to date by the sweep below; this
    answers the question from the record itself, so a missed sweep shows up as
    a stale flag rather than as a wrong answer here.
    """
    on_date = on_date or date.today()
    for suspension in employee.suspensions.filter(starts_on__lte=on_date):
        if suspension.covers(on_date):
            return suspension
    return None


def is_suspended(employee: Employee, on_date: date | None = None) -> bool:
    return active_suspension(employee, on_date) is not None


@transaction.atomic
def suspend(employee, *, starts_on, ends_on=None, reason, actor=None):
    """Put somebody on suspension.

    Refuses to stack. Two overlapping suspensions would each claim to be the
    reason somebody is locked out, and lifting one would leave the account
    locked with no visible cause — so the existing one is amended instead,
    which is what "extend the suspension" means anyway.
    """
    if ends_on is not None and ends_on < starts_on:
        raise SuspensionError("A suspension cannot end before it starts.")

    existing = active_suspension(employee, starts_on)
    if existing is not None:
        raise SuspensionError(
            f"{employee.employee_code} is already suspended from {existing.starts_on}. "
            "Amend that suspension rather than adding a second one."
        )

    if employee.employment_status in (
        Employee.EmploymentStatus.RESIGNED,
        Employee.EmploymentStatus.TERMINATED,
    ):
        raise SuspensionError(
            "This person has already left. Suspending a leaver locks an account "
            "that offboarding should have closed."
        )

    suspension = Suspension.objects.create(
        employee=employee,
        starts_on=starts_on,
        ends_on=ends_on,
        reason=reason,
        created_by=actor,
        updated_by=actor,
    )
    _sync(employee)
    # `_sync` writes `is_active` through a fresh queryset, so the instance
    # created above is already stale by the time it is returned. A caller
    # serialising it straight back — which the viewset does — would report a
    # suspension that is not in force on a person who has just been locked out.
    suspension.refresh_from_db()
    return suspension


@transaction.atomic
def lift(suspension, *, outcome, note="", actor=None, on_date=None):
    """End a suspension, and say how it ended.

    `outcome` is required rather than defaulted, because the three answers lead
    to different places: reinstated puts somebody back to work, withdrawn says
    it should not have happened, and terminated is an exit that the offboarding
    flow then has to pick up.
    """
    if outcome not in Suspension.Outcome.values or outcome == Suspension.Outcome.PENDING:
        raise SuspensionError("Say how the suspension ended: reinstated, withdrawn or terminated.")

    on_date = on_date or date.today()
    suspension.outcome = outcome
    suspension.outcome_note = note
    suspension.lifted_on = on_date
    suspension.lifted_by = actor
    # Closed off at today rather than left open, so `covers()` stops returning
    # it and the sweep below has nothing left to do.
    if suspension.ends_on is None or suspension.ends_on > on_date:
        suspension.ends_on = on_date
    suspension.is_active = False
    suspension.updated_by = actor
    suspension.save()

    employee = suspension.employee
    if outcome == Suspension.Outcome.TERMINATED:
        # The status is set here rather than left to the sweep: a dismissal is
        # not "the suspension expired", and the roster should say so the moment
        # somebody records it.
        employee.employment_status = Employee.EmploymentStatus.TERMINATED
        employee.save(update_fields=["employment_status", "updated_at"])
    _sync(employee)
    return suspension


def _sync(employee: Employee) -> bool:
    """Make the flag, the status and the login agree with the records.

    Returns whether anything changed, so the nightly sweep can report a count
    rather than a shrug.
    """
    today = date.today()
    current = active_suspension(employee, today)
    changed = False

    for suspension in employee.suspensions.all():
        should_be = suspension.pk == getattr(current, "pk", None)
        if suspension.is_active != should_be:
            suspension.is_active = should_be
            suspension.save(update_fields=["is_active", "updated_at"])
            changed = True

    # The employment status follows the suspension in both directions, but only
    # between `active` and `suspended`. Somebody on leave or already gone keeps
    # the status they have: overwriting it would use a lock-out to erase a fact
    # about their employment.
    status = employee.employment_status
    if current is not None and status == Employee.EmploymentStatus.ACTIVE:
        employee.employment_status = Employee.EmploymentStatus.SUSPENDED
        employee.save(update_fields=["employment_status", "updated_at"])
        changed = True
    elif current is None and status == Employee.EmploymentStatus.SUSPENDED:
        employee.employment_status = Employee.EmploymentStatus.ACTIVE
        employee.save(update_fields=["employment_status", "updated_at"])
        changed = True

    # The lock itself.
    #
    # Only ever *re-enabled* for somebody whose account this module disabled.
    # An account deactivated for another reason — offboarding, a security
    # decision — must not be handed back by a suspension ending.
    user = employee.user
    if current is not None and user.is_active:
        user.is_active = False
        user.save(update_fields=["is_active"])
        changed = True
    elif (
        current is None
        and not user.is_active
        and employee.employment_status == Employee.EmploymentStatus.ACTIVE
    ):
        user.is_active = True
        user.save(update_fields=["is_active"])
        changed = True

    return changed


def sweep(on_date: date | None = None) -> int:
    """Start and end every suspension whose day has come.

    Runs nightly. A suspension with an end date is expected to lift itself —
    that is what the interval is *for* — and an HRMS where somebody has to
    remember to unlock an account on the right morning is one where people stay
    locked out over a weekend.

    Idempotent, so an extra run costs a few queries and changes nothing.
    """
    on_date = on_date or date.today()
    touched = 0
    # Anyone with a suspension that either began or ended recently enough to
    # still be out of step. Scanning everyone with any suspension at all is
    # cheap here and avoids a date-window bug hiding a stuck account.
    employees = (
        Employee.objects.filter(suspensions__isnull=False).select_related("user").distinct()
    )
    for employee in employees:
        if _sync(employee):
            touched += 1
    return touched
