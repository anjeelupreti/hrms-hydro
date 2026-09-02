"""The travel order, and the seam with attendance.

Kept out of the viewset because two of these are called from elsewhere — the
attendance sweep asks `on_visit`, and the timesheet generator reads the same
day list — and a rule that lives in a view is a rule the next caller skips.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from fieldvisits.models import FieldVisit


class FieldVisitError(Exception):
    """The visit cannot be recorded or moved as asked."""


def days_of(visit) -> list[date]:
    """Every date the visit covers, both ends included."""
    return [
        visit.starts_on + timedelta(days=offset)
        for offset in range((visit.ends_on - visit.starts_on).days + 1)
    ]


def on_visit(employee, on_date=None) -> FieldVisit | None:
    """The approved visit covering this person on this day, if any.

    **This is what stops the attendance sweep docking somebody's pay for being
    at the site they were sent to.** Before it existed, an engineer at the
    headworks for a week had no clock-in for five days, and
    `mark_absent_employees` recorded five absences — which feed `unpaid_days`
    and scale pay directly.

    Only *approved* and *completed* visits count. A request that nobody has
    signed is not yet a reason to be away.
    """
    on_date = on_date or date.today()
    return (
        FieldVisit.objects.filter(
            employee=employee,
            starts_on__lte=on_date,
            ends_on__gte=on_date,
            status__in=[FieldVisit.Status.APPROVED, FieldVisit.Status.COMPLETED],
        )
        .order_by("starts_on")
        .first()
    )


@transaction.atomic
def request_visit(visit, *, actor=None):
    """Send a draft for a travel order."""
    if visit.status != FieldVisit.Status.DRAFT:
        raise FieldVisitError("This visit has already been requested.")
    if visit.ends_on < visit.starts_on:
        raise FieldVisitError("A visit cannot end before it starts.")
    visit.status = FieldVisit.Status.REQUESTED
    visit.updated_by = actor
    visit.save(update_fields=["status", "updated_by", "updated_at"])
    _announce(visit)
    return visit


@transaction.atomic
def decide(visit, *, approve, note="", actor=None):
    """Issue or refuse the travel order.

    Approval is what makes the visit count for attendance, which is why it is
    a transition rather than a flag somebody edits.
    """
    if visit.status not in (FieldVisit.Status.REQUESTED, FieldVisit.Status.DRAFT):
        raise FieldVisitError("This visit has already been decided.")
    visit.status = FieldVisit.Status.APPROVED if approve else FieldVisit.Status.REJECTED
    visit.decided_by = actor if getattr(actor, "is_authenticated", False) else None
    visit.decided_at = timezone.now()
    visit.decision_note = note or ""
    visit.save(
        update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"]
    )
    _announce(visit, decided=True)
    return visit


@transaction.atomic
def complete(visit, *, report="", actor=None):
    """Back from site, with the report.

    Refused without one. A visit with no findings is a cost with no output, and
    the report is the only part of this record anybody reads a year later.
    """
    if visit.status != FieldVisit.Status.APPROVED:
        raise FieldVisitError("Only an approved visit can be completed.")
    text = (report or visit.report or "").strip()
    if not text:
        raise FieldVisitError("Write what was found before closing the visit.")
    visit.report = text
    visit.status = FieldVisit.Status.COMPLETED
    visit.completed_at = timezone.now()
    visit.updated_by = actor
    visit.save(
        update_fields=["report", "status", "completed_at", "updated_by", "updated_at"]
    )
    return visit


@transaction.atomic
def generate_time_entries(visit, *, hours_per_day="8.00", actor=None):
    """Turn a completed visit into timesheet lines.

    **The honest version of "can timesheets carry field visits".** They cannot
    hold one — see the module docstring on `fieldvisits.models` — but a visit
    can *produce* entries, and that is the integration worth having: the visit
    says where somebody was and why; the entries say what those days were worth
    to a project.

    Needs a project, because a time entry without one has nothing to be
    reported against. Skips days that already have an entry for the same
    project, so running it twice adds nothing.
    """
    from timesheets.models import TimeEntry

    if visit.project_id is None:
        raise FieldVisitError(
            "Attach a project to the visit first — a timesheet line has to be "
            "against something."
        )
    if visit.status != FieldVisit.Status.COMPLETED:
        raise FieldVisitError("Complete the visit first.")

    created = 0
    for day in days_of(visit):
        _, made = TimeEntry.objects.get_or_create(
            employee=visit.employee,
            project=visit.project,
            date=day,
            defaults={
                "hours": hours_per_day,
                "description": f"Field visit: {visit.destination}",
                "billable": True,
                "created_by": actor,
                "updated_by": actor,
            },
        )
        created += int(made)
    return created


def _announce(visit, decided=False):
    """Tell the approver it is waiting, or the traveller what was decided.

    Guarded: a notification that fails must not undo a transition already
    recorded.
    """
    from notifications.services import notify

    try:
        name = visit.employee.user.get_full_name() or visit.employee.user.get_username()
        if decided:
            verdict = "approved" if visit.status == FieldVisit.Status.APPROVED else "refused"
            notify(
                visit.employee.user,
                f"field_visit_{verdict}",
                f"Your field visit to {visit.destination} "
                f"({visit.starts_on:%d %b} – {visit.ends_on:%d %b}) was {verdict}.",
                email_subject=f"Field visit {verdict}",
            )
            return
        if visit.approver is not None:
            notify(
                visit.approver.user,
                "field_visit_requested",
                f"{name} has asked to visit {visit.destination} "
                f"({visit.starts_on:%d %b} – {visit.ends_on:%d %b}).",
                email_subject="A field visit needs your approval",
            )
    except Exception:  # noqa: BLE001 — the transition is the record
        import logging

        logging.getLogger(__name__).exception("Could not announce field visit %s", visit.pk)
