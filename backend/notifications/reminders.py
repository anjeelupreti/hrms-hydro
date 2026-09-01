"""Reminders that fire *before* the thing happens, on rules somebody configured.

**What this replaces.** Every reminder in the product was a hand-written task
with its own query and its own hardcoded "today": birthdays, work anniversaries
and holidays all fired on the day, which for a holiday means the message is
"today is Dashain, enjoy it" — an announcement nobody can plan around. Adding
"warn a week before probation ends" meant a fourth task, a fourth beat entry, a
fourth fan-out wrapper and a fourth `notified_at` column to stop it firing every
morning. Those are the exact four things billing dunning had just been made to
hand-write, which is the point at which a pattern becomes a mechanism.

**The line between us and the customer, and why it is drawn here.**

What can be reminded about is *ours*: each `ReminderKind` below knows which
model to query, which date field means "when", who is affected, and which facts
it can offer. That has to be code — it is a database query, and a settings
screen that let somebody write one would be a settings screen that could read
the payroll table.

When it fires, who hears it and what it says is *theirs*. A company that wants
thirty days' notice before a probation lapses should not have to ask us, and the
wording of a message to their own staff is not our business.

**Templates substitute, they do not evaluate.** `str.format` is not safe on text
somebody typed — `{x.__class__.__init__.__globals__}` is a real escape from it —
and a Django `Template` is a small programming language with filters and tag
loading. This walks a regex over `{name}` and looks each one up in a plain dict,
so the worst a malicious template can do is name a variable that does not exist,
which renders as itself.
"""

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta

logger = logging.getLogger(__name__)

#: `{employee_name}` — a bare name, nothing else. No dots, no indexing, no
#: calls, so there is no expression for a template to smuggle anything through.
PLACEHOLDER = re.compile(r"\{([a-z_][a-z0-9_]*)\}")


def render(template: str, values: dict) -> str:
    """Substitute `{name}` from `values`, leaving unknown names alone.

    Unknown names are left visible rather than blanked: somebody who typed
    `{employe_name}` should see their typo in the preview, not an eerie gap
    they have to work backwards from.
    """
    return PLACEHOLDER.sub(lambda m: str(values.get(m.group(1), m.group(0))), template)


@dataclass(frozen=True)
class Recipient:
    """Somebody to tell, and the facts that are true for them.

    `user` is a company `User`; `values` are what the templates may reference.
    `key` identifies the underlying row so the same reminder is not sent twice
    for the same object at the same lead time.
    """

    user: object
    key: str
    values: dict


@dataclass(frozen=True)
class ReminderKind:
    """One thing that can be reminded about.

    `resolve(target_date)` returns the `Recipient`s for whom something happens
    on exactly that date. The dispatcher calls it once per configured lead time
    with `today + lead`, so a kind never needs to know what a lead time is — it
    answers one question, for one date.
    """

    key: str
    label: str
    #: Shown on the settings screen so somebody choosing knows what they get.
    description: str
    resolve: Callable[[date], list]
    #: Names a template may use, for the settings screen to list.
    variables: tuple = ()
    default_lead_days: tuple = (7,)
    default_subject: str = ""
    default_body: str = ""
    #: Platform-to-company rather than inside a company. Keeps the two registries
    #: apart without a second module.
    scope: str = "company"


_REGISTRY: dict = {}


def register(kind: ReminderKind) -> ReminderKind:
    if kind.key in _REGISTRY:
        raise ValueError(f"Reminder kind {kind.key!r} is already registered.")
    _REGISTRY[kind.key] = kind
    return kind


def kinds(scope: str = "company") -> list:
    return [k for k in _REGISTRY.values() if k.scope == scope]


def get_kind(key: str):
    return _REGISTRY.get(key)


def choices(scope: str = "company") -> list:
    return [(k.key, k.label) for k in kinds(scope)]


# ── The kinds themselves ─────────────────────────────────────────────────
#
# Each is a query and nothing more. Deliberately small: a kind that starts
# deciding *whether* to send has taken back the decision this module exists to
# hand over.


def _employee_name(employee):
    user = employee.user
    return user.get_full_name() or user.get_username()


def _probation_ending(target_date):
    """Probation lapsing, which needs a confirm-or-extend decision first.

    Told to HR and to the manager, not to the employee: this is a decision
    somebody has to make *about* them, and mailing "your probation ends
    Tuesday" to somebody whose manager has not yet decided is worse than
    silence.
    """
    from accounts.policy import Perm, users_with
    from employees.models import Employee

    employees = Employee.objects.filter(
        probation_end_date=target_date,
        employment_status=Employee.EmploymentStatus.ACTIVE,
    ).select_related("user", "manager__user")

    out = []
    for employee in employees:
        values = {
            "employee_name": _employee_name(employee),
            "employee_code": employee.employee_code,
            "date": str(employee.probation_end_date),
            "days": (employee.probation_end_date - date.today()).days,
        }
        audience = set(users_with(Perm.PEOPLE_MANAGE))
        if employee.manager and employee.manager.user:
            audience.add(employee.manager.user)
        for user in audience:
            out.append(Recipient(user=user, key=f"employee:{employee.pk}", values=values))
    return out


def _passport_expiring(target_date):
    """A passport running out, told to the person who holds it and to HR.

    Stored since the statutory fields were added and never once read. It is
    discovered today by somebody needing to travel.
    """
    from accounts.policy import Perm, users_with
    from employees.models import Employee

    employees = Employee.objects.filter(
        passport_expiry=target_date,
        employment_status=Employee.EmploymentStatus.ACTIVE,
    ).select_related("user")

    out = []
    for employee in employees:
        values = {
            "employee_name": _employee_name(employee),
            "date": str(employee.passport_expiry),
            "days": (employee.passport_expiry - date.today()).days,
        }
        for user in {employee.user, *users_with(Perm.PEOPLE_MANAGE)}:
            out.append(Recipient(user=user, key=f"employee:{employee.pk}", values=values))
    return out


def _holiday_upcoming(target_date):
    """A holiday, told in advance so people can plan around it.

    The existing holiday task fires on the morning of and says "enjoy the
    holiday", which is an announcement. This is the reminder.
    """
    from employees.models import Employee
    from notifications.models import Holiday

    holidays = Holiday.objects.filter(date=target_date)
    if not holidays.exists():
        return []

    employees = Employee.objects.filter(
        employment_status=Employee.EmploymentStatus.ACTIVE
    ).select_related("user")

    out = []
    for holiday in holidays:
        values = {
            "holiday_name": holiday.name,
            "date": str(holiday.date),
            "days": (holiday.date - date.today()).days,
        }
        for employee in employees:
            out.append(
                Recipient(user=employee.user, key=f"holiday:{holiday.pk}", values=values)
            )
    return out


def _task_due(target_date):
    """A project task coming due, told to whoever it is assigned to."""
    from projects.models import ProjectTask

    tasks = (
        ProjectTask.objects.filter(due_date=target_date, assignee__isnull=False)
        .exclude(status=ProjectTask.Status.DONE)
        .select_related("assignee__user", "project")
    )

    out = []
    for task in tasks:
        if not task.assignee.user_id:
            continue
        out.append(
            Recipient(
                user=task.assignee.user,
                key=f"task:{task.pk}",
                values={
                    "task_title": task.title,
                    "project_name": task.project.name,
                    "date": str(task.due_date),
                    "days": (task.due_date - date.today()).days,
                },
            )
        )
    return out


register(ReminderKind(
    key="probation_ending",
    label="Probation ending",
    description=(
        "Warns HR and the manager before somebody's probation lapses, so the "
        "confirm-or-extend decision happens before the date rather than after."
    ),
    resolve=_probation_ending,
    variables=("employee_name", "employee_code", "date", "days"),
    default_lead_days=(30, 7),
    default_subject="Probation ending for {employee_name}",
    default_body=(
        "{employee_name} ({employee_code}) finishes probation on {date}, in {days} days. "
        "Confirm or extend before then."
    ),
))

register(ReminderKind(
    key="passport_expiring",
    label="Passport expiring",
    description="Warns the employee and HR before a recorded passport runs out.",
    resolve=_passport_expiring,
    variables=("employee_name", "date", "days"),
    default_lead_days=(90, 30),
    default_subject="Passport expiring for {employee_name}",
    default_body="{employee_name}'s passport expires on {date}, in {days} days.",
))

register(ReminderKind(
    key="holiday_upcoming",
    label="Holiday coming up",
    description=(
        "Tells everyone about a company holiday in advance. The existing "
        "same-day message stays as it is — this is the one people can plan around."
    ),
    resolve=_holiday_upcoming,
    variables=("holiday_name", "date", "days"),
    default_lead_days=(7,),
    default_subject="{holiday_name} is in {days} days",
    default_body="{holiday_name} falls on {date}. The office is closed that day.",
))

register(ReminderKind(
    key="task_due",
    label="Task due",
    description="Reminds an assignee before a project task's due date.",
    resolve=_task_due,
    variables=("task_title", "project_name", "date", "days"),
    default_lead_days=(1,),
    default_subject="{task_title} is due {date}",
    default_body="Your task \"{task_title}\" on {project_name} is due on {date}.",
))


# ── Dispatch ─────────────────────────────────────────────────────────────


def seed_default_rules():
    """Give a company one rule per kind, off by default except the obvious ones.

    Seeded rather than left empty so the settings screen shows what is
    *available* rather than an empty list somebody has to guess the shape of.
    Only the two that nobody would object to arrive switched on — a product
    that starts mailing everybody about everything on day one gets its
    notifications turned off wholesale, including the ones that mattered.
    """
    from notifications.models import ReminderRule

    on_by_default = {"probation_ending", "holiday_upcoming"}
    created = []
    for kind in kinds("company"):
        rule, made = ReminderRule.objects.get_or_create(
            kind=kind.key,
            defaults={
                "is_enabled": kind.key in on_by_default,
                "lead_days": list(kind.default_lead_days),
                "subject": kind.default_subject,
                "body": kind.default_body,
            },
        )
        if made:
            created.append(rule.kind)
    return created


def run_reminders(on_date=None, *, dry_run=False):
    """Fire every enabled rule for today. Safe to run repeatedly.

    Returns a summary a human can read when asked "did the reminders go out",
    which is the question a silent scheduled job can never answer.

    `dry_run` resolves and renders without sending or recording — what the
    settings screen's preview is for, so somebody can see the actual message
    against their actual data before turning a rule on.
    """
    from django.db import IntegrityError, transaction

    from notifications.models import ReminderLog, ReminderRule
    from notifications.services import notify

    on_date = on_date or date.today()
    sent, skipped = 0, 0
    previews = []

    for rule in ReminderRule.objects.filter(is_enabled=True):
        kind = get_kind(rule.kind)
        if kind is None:
            # A rule naming a kind this build does not have — a downgrade, or a
            # kind withdrawn. Skipped rather than raising: one stale row must
            # not stop every other reminder going out.
            logger.warning("Reminder rule %s names an unknown kind.", rule.kind)
            continue

        for lead in rule.offsets():
            target_date = on_date + timedelta(days=lead)
            try:
                recipients = kind.resolve(target_date)
            except Exception:  # noqa: BLE001
                # One broken kind must not take the nightly run with it.
                logger.exception("Reminder kind %s failed to resolve.", rule.kind)
                continue

            for recipient in recipients:
                values = {**recipient.values, "days": lead}
                subject = render(rule.subject or kind.default_subject, values)
                body = render(rule.body or kind.default_body, values)

                if dry_run:
                    previews.append({
                        "kind": rule.kind,
                        "lead_days": lead,
                        "to": getattr(recipient.user, "email", "") or str(recipient.user),
                        "subject": subject,
                        "body": body,
                    })
                    continue

                # The unique constraint is the real guard, not this check — two
                # workers racing would both pass a look-before-you-leap. The
                # `get_or_create` is attempted and the collision caught, so the
                # database decides and the duplicate is simply not sent.
                try:
                    with transaction.atomic():
                        _, created = ReminderLog.objects.get_or_create(
                            rule=rule,
                            target_key=recipient.key,
                            recipient=recipient.user,
                            lead_days=lead,
                            due_date=target_date,
                        )
                except IntegrityError:
                    created = False

                if not created:
                    skipped += 1
                    continue

                notify(recipient.user, f"reminder_{rule.kind}", body, email_subject=subject)
                sent += 1

    if dry_run:
        return {"previews": previews}
    return {"sent": sent, "already_sent": skipped}
