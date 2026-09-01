"""Raising, answering and closing a client's ticket.

The behaviour that separates this from CRUD is all about **clocks and
visibility**: when the promise to respond was made, when it was kept, and which
of the things written on a ticket the client is allowed to read.
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from core.statusflow import TICKET_FLOW, TransitionError
from core.timeline import TimelineKind, TimelineVisibility, record
from crm.models import ClientTicket, SLAPolicy, TimelineEntry

#: Used when a company has not configured a policy for a priority. Deliberately
#: generous rather than aggressive: a default that puts every ticket instantly
#: in breach teaches people to ignore the breach flag, which is worse than
#: having no target at all.
DEFAULT_RESPONSE_HOURS = 8
DEFAULT_RESOLUTION_HOURS = 72


class TicketError(Exception):
    """A ticket operation that cannot be applied as asked."""


def next_reference():
    """`CT-0001`, sequential.

    Readable and quotable — "about ticket CT-0042" has to mean something to
    both sides of a conversation, which a UUID does not.
    """
    last = (
        ClientTicket.objects.filter(reference__startswith="CT-")
        .order_by("-reference")
        .values_list("reference", flat=True)
        .first()
    )
    number = 1
    if last:
        try:
            number = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            number = ClientTicket.objects.count() + 1
    return f"CT-{number:04d}"


def sla_targets(priority, *, opened_at=None):
    """When a response and a resolution are due for this priority.

    Snapshotted onto the ticket by `raise_ticket` rather than computed on read,
    so changing the policy next month cannot retroactively put past tickets in
    breach — or quietly rescue them from it.
    """
    opened_at = opened_at or timezone.now()
    policy = SLAPolicy.objects.filter(priority=priority, is_active=True).first()
    response_hours = policy.response_hours if policy else DEFAULT_RESPONSE_HOURS
    resolution_hours = policy.resolution_hours if policy else DEFAULT_RESOLUTION_HOURS
    return (
        opened_at + timedelta(hours=response_hours),
        opened_at + timedelta(hours=resolution_hours),
    )


@transaction.atomic
def raise_ticket(*, client, subject, description="", contact=None,
                 priority=ClientTicket.Priority.NORMAL,
                 channel=ClientTicket.Channel.INTERNAL, actor=None, actor_label=""):
    """Open a ticket for a client.

    `actor_label` carries who raised it when they are not a user of this system
    — a customer emailing in. Recording "System" for a named person who wrote to
    you is a small lie that makes the history useless.
    """
    opened_at = timezone.now()
    response_due, resolution_due = sla_targets(priority, opened_at=opened_at)

    ticket = ClientTicket.objects.create(
        client=client,
        contact=contact,
        reference=next_reference(),
        subject=subject,
        description=description,
        priority=priority,
        channel=channel,
        status="open",
        response_due_at=response_due,
        resolution_due_at=resolution_due,
        created_by=actor,
        updated_by=actor,
    )
    record(
        TimelineEntry, ticket,
        kind=TimelineKind.SYSTEM,
        body=f"Ticket raised via {ticket.get_channel_display().lower()}.",
        actor=actor,
        actor_label=actor_label,
    )
    return ticket


@transaction.atomic
def reply_to_client(ticket, body, *, actor=None):
    """A reply the client actually receives — and the thing that stops the
    response clock.

    Stopping it here rather than on any status change is the point: moving a
    ticket to "in progress" is us organising ourselves, and the client has still
    heard nothing. The promise was a *response*, and only a reply keeps it.
    """
    if not body.strip():
        raise TicketError("A reply needs something in it.")

    entry = record(
        TimelineEntry, ticket,
        kind=TimelineKind.REPLY,
        visibility=TimelineVisibility.CUSTOMER,
        body=body,
        actor=actor,
    )
    if ticket.first_response_at is None:
        ticket.first_response_at = entry.created_at
        ticket.save(update_fields=["first_response_at", "updated_at"])
    return entry


def add_internal_note(ticket, body, *, actor=None):
    """A note about the ticket that the client never sees.

    Explicitly does **not** touch `first_response_at`. Writing "chased Ram about
    this" to yourself is not answering the customer, and letting it stop the
    clock would make the SLA measure our note-taking.
    """
    return record(
        TimelineEntry, ticket,
        kind=TimelineKind.NOTE,
        visibility=TimelineVisibility.INTERNAL,
        body=body,
        actor=actor,
    )


@transaction.atomic
def move_ticket(ticket, to_status, *, actor=None, note=""):
    """Move a ticket through the declared flow, recording the transition."""
    try:
        TICKET_FLOW.apply(
            ticket, to_status, timeline_model=TimelineEntry, actor=actor, note=note
        )
    except TransitionError as exc:
        raise TicketError(str(exc)) from exc

    if to_status == "resolved" and ticket.resolved_at is None:
        ticket.resolved_at = timezone.now()
        ticket.save(update_fields=["resolved_at", "updated_at"])
    elif to_status == "open":
        # Reopening clears the resolution stamp: the problem is not over, and
        # leaving the old timestamp would report a resolution that did not hold.
        # `first_response_at` is *not* cleared — we did respond, once, and that
        # fact does not stop being true.
        if ticket.resolved_at is not None:
            ticket.resolved_at = None
            ticket.save(update_fields=["resolved_at", "updated_at"])
    return ticket


@transaction.atomic
def assign_ticket(ticket, employee, *, actor=None):
    """Hand a ticket to somebody, visibly.

    Recorded on the timeline rather than being a silent field change, because
    "who was looking after this in March" is a question that gets asked and a
    bare foreign key cannot answer.
    """
    previous = ticket.assignee
    if previous is not None and employee is not None and previous.pk == employee.pk:
        return ticket

    ticket.assignee = employee
    ticket.updated_by = actor
    ticket.save(update_fields=["assignee", "updated_by", "updated_at"])

    def name(person):
        if person is None:
            return "unassigned"
        return person.user.get_full_name() or person.user.get_username()

    record(
        TimelineEntry, ticket,
        kind=TimelineKind.ASSIGNMENT,
        body=f"Assigned to {name(employee)}.",
        from_value=name(previous),
        to_value=name(employee),
        actor=actor,
    )
    return ticket


def client_visible_timeline(ticket):
    """What the client is allowed to read.

    A thin wrapper over `timeline_for(..., include_internal=False)` that exists
    to be the *only* thing a client-facing view calls — so the decision is made
    once here rather than remembered at every call site.
    """
    from core.timeline import timeline_for

    return timeline_for(TimelineEntry, ticket, include_internal=False)
