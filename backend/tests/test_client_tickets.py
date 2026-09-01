"""The company's client desk — customers raising concerns, in CRM.

**Placed in `crm`, not `helpdesk`, deliberately.** The requester is a client the
CRM already tracks, so their tickets belong beside their deals. `helpdesk` stays
internal — an employee reporting a broken chair is a different queue with a
different audience and different privacy rules, and one model serving both would
have a requester that is sometimes an employee and sometimes a customer.

The tests concentrate on the two things that are not CRUD: **the clocks** (what
stops the response timer, and what does not) and **visibility** (which of the
things written on a ticket the client may read).
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from core.timeline import TimelineKind, timeline_for
from crm.models import Client, ClientTicket, SLAPolicy, TimelineEntry
from crm.tickets import (
    TicketError,
    add_internal_note,
    assign_ticket,
    client_visible_timeline,
    move_ticket,
    raise_ticket,
    reply_to_client,
    sla_targets,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def client_row(company):
    yield Client.objects.create(name="Everest Traders", status="active")


@pytest.fixture
def ticket(company, client_row):
    yield raise_ticket(
        client=client_row,
        subject="Invoice does not match the delivery note",
        description="Three items billed, two received.",
    )


# ── Identity and placement ───────────────────────────────────────────────


def test_a_ticket_gets_a_quotable_reference(company, ticket):
    """"About ticket CT-0042" has to mean something to both sides of a
    conversation, which a UUID does not."""
    assert ticket.reference.startswith("CT-")
    assert len(ticket.reference) == 7


def test_references_are_sequential(company, client_row):
    first = raise_ticket(client=client_row, subject="One")
    second = raise_ticket(client=client_row, subject="Two")

    assert int(second.reference.split("-")[1]) == int(first.reference.split("-")[1]) + 1


def test_a_clients_tickets_hang_off_the_client_record(company, client_row, ticket):
    """The whole reason this lives in CRM: one place shows a client's deals and
    their open concerns."""
    assert list(client_row.tickets.all()) == [ticket]


def test_the_internal_helpdesk_is_untouched(company):
    """Two inbound queues per company, deliberately. A customer's complaint must
    never appear in the staff IT queue."""
    from helpdesk.models import Ticket

    requester_field = Ticket._meta.get_field("requester")
    assert requester_field.related_model.__name__ == "Employee"
    assert ClientTicket._meta.get_field("client").related_model is Client


# ── The clocks ───────────────────────────────────────────────────────────


def test_sla_targets_are_snapshotted_at_raise(company, client_row):
    """Changing the policy next month must not retroactively put past tickets
    in breach — or quietly rescue them from it."""
    SLAPolicy.objects.create(
        priority=ClientTicket.Priority.URGENT, response_hours=1, resolution_hours=4
    )
    urgent = raise_ticket(
        client=client_row, subject="Site down", priority=ClientTicket.Priority.URGENT
    )
    original_due = urgent.response_due_at

    policy = SLAPolicy.objects.get(priority=ClientTicket.Priority.URGENT)
    policy.response_hours = 24
    policy.save(update_fields=["response_hours"])
    urgent.refresh_from_db()

    assert urgent.response_due_at == original_due


def test_an_unconfigured_priority_gets_a_generous_default(company, client_row):
    """A default that puts every ticket instantly in breach teaches people to
    ignore the breach flag, which is worse than having no target."""
    response_due, resolution_due = sla_targets(ClientTicket.Priority.LOW)

    assert response_due > timezone.now() + timedelta(hours=1)
    assert resolution_due > response_due


def test_replying_stops_the_response_clock(company, ticket, hr_user):
    assert ticket.first_response_at is None
    reply_to_client(ticket, "We are looking into it now.", actor=hr_user)
    ticket.refresh_from_db()

    assert ticket.first_response_at is not None


def test_an_internal_note_does_not_stop_the_response_clock(company, ticket, hr_user):
    """The promise was a *response*. Writing "chased Ram about this" to yourself
    is not answering the customer, and letting it stop the clock would make the
    SLA measure our note-taking.
    """
    add_internal_note(ticket, "Chased Ram in accounts.", actor=hr_user)
    ticket.refresh_from_db()

    assert ticket.first_response_at is None


def test_moving_to_in_progress_does_not_stop_the_response_clock(company, ticket, hr_user):
    """Moving a ticket to "in progress" is us organising ourselves — the client
    has still heard nothing."""
    move_ticket(ticket, "in_progress", actor=hr_user)
    ticket.refresh_from_db()

    assert ticket.first_response_at is None


def test_a_breach_is_reported_while_it_is_still_happening(company, ticket):
    """"Currently breaching" is the question a queue is scanned for."""
    ticket.response_due_at = timezone.now() - timedelta(hours=1)
    ticket.save(update_fields=["response_due_at"])

    assert ticket.response_breached is True


def test_a_late_reply_still_counts_as_a_breach(company, ticket, hr_user):
    """Answering eventually does not un-break the promise — the breach is
    recorded by comparing the two timestamps."""
    ticket.response_due_at = timezone.now() - timedelta(hours=2)
    ticket.save(update_fields=["response_due_at"])
    reply_to_client(ticket, "Sorry for the delay.", actor=hr_user)
    ticket.refresh_from_db()

    assert ticket.response_breached is True


def test_a_prompt_reply_is_not_a_breach(company, ticket, hr_user):
    reply_to_client(ticket, "On it.", actor=hr_user)
    ticket.refresh_from_db()

    assert ticket.response_breached is False


# ── Visibility ───────────────────────────────────────────────────────────


def test_the_client_sees_replies_and_not_internal_notes(company, ticket, hr_user):
    """The one unrecoverable mistake this module can make."""
    add_internal_note(ticket, "Their account is overdue, go carefully.", actor=hr_user)
    reply_to_client(ticket, "We have found the discrepancy.", actor=hr_user)

    visible = list(client_visible_timeline(ticket))
    everything = timeline_for(TimelineEntry, ticket).count()

    assert everything > len(visible)
    assert all("overdue" not in entry.body for entry in visible)
    assert any("discrepancy" in entry.body for entry in visible)


def test_status_changes_are_internal_by_default(company, ticket, hr_user):
    """A client does not need to watch a ticket bounce between our columns."""
    move_ticket(ticket, "in_progress", actor=hr_user)
    visible = list(client_visible_timeline(ticket))

    assert all(entry.kind != TimelineKind.STATUS for entry in visible)


# ── The flow ─────────────────────────────────────────────────────────────


def test_resolving_stamps_the_resolution_time(company, ticket, hr_user):
    move_ticket(ticket, "in_progress", actor=hr_user)
    move_ticket(ticket, "resolved", actor=hr_user)
    ticket.refresh_from_db()

    assert ticket.resolved_at is not None


def test_reopening_clears_the_resolution_but_not_the_response(company, ticket, hr_user):
    """The problem is not over, so the resolution stamp must go — but we *did*
    respond once, and that does not stop being true."""
    reply_to_client(ticket, "Looking now.", actor=hr_user)
    move_ticket(ticket, "resolved", actor=hr_user)
    move_ticket(ticket, "open", actor=hr_user)
    ticket.refresh_from_db()

    assert ticket.resolved_at is None
    assert ticket.first_response_at is not None


def test_an_illegal_move_is_refused(company, ticket, hr_user):
    """"Resolved" while waiting on the customer is a claim nobody has checked."""
    move_ticket(ticket, "waiting", actor=hr_user)
    with pytest.raises(TicketError):
        move_ticket(ticket, "resolved", actor=hr_user)


# ── Assignment ───────────────────────────────────────────────────────────


def test_assignment_is_recorded_not_silent(company, ticket, payroll_setup, hr_user):
    """"Who was looking after this in March" gets asked, and a bare foreign key
    cannot answer it."""
    assign_ticket(ticket, payroll_setup["emp"], actor=hr_user)
    entries = [
        e for e in timeline_for(TimelineEntry, ticket)
        if e.kind == TimelineKind.ASSIGNMENT
    ]

    assert len(entries) == 1
    assert entries[0].from_value == "unassigned"


def test_reassigning_to_the_same_person_records_nothing(company, ticket, payroll_setup, hr_user):
    assign_ticket(ticket, payroll_setup["emp"], actor=hr_user)
    assign_ticket(ticket, payroll_setup["emp"], actor=hr_user)
    entries = [
        e for e in timeline_for(TimelineEntry, ticket)
        if e.kind == TimelineKind.ASSIGNMENT
    ]

    assert len(entries) == 1


# ── Who raised it ────────────────────────────────────────────────────────


def test_an_emailed_ticket_records_who_sent_it(company, client_row):
    """Recording "System" for a named person who wrote to you is a small lie
    that makes the history useless."""
    emailed = raise_ticket(
        client=client_row, subject="Late delivery",
        channel=ClientTicket.Channel.EMAIL,
        actor_label="sita@everest.example",
    )
    entry = timeline_for(TimelineEntry, emailed).first()

    assert entry.who == "sita@everest.example"


# ── The board and the API ────────────────────────────────────────────────


def test_the_board_columns_come_from_the_flow_not_the_data(company, client_row, hr_client):
    """An empty column is information — nothing is waiting on the customer.

    Deriving columns from the statuses that happen to be present would make
    that vanish exactly when it is worth knowing.
    """
    raise_ticket(client=client_row, subject="Only one ticket, in one column")
    response = hr_client.get("/api/v1/crm/tickets/board/")

    assert response.status_code == 200
    values = [c["value"] for c in response.data["columns"]]
    assert values == ["open", "in_progress", "waiting", "resolved", "closed"]
    counts = {c["value"]: c["count"] for c in response.data["columns"]}
    assert counts["open"] == 1
    assert counts["waiting"] == 0


def test_the_board_publishes_the_legal_moves(company, client_row, hr_client):
    """So the board can refuse a drag before asking the server, and say why
    rather than just snapping the card back."""
    response = hr_client.get("/api/v1/crm/tickets/board/")

    transitions = response.data["transitions"]
    assert "resolved" not in transitions["waiting"]
    assert "in_progress" in transitions["open"]


def test_creating_through_the_api_sets_the_sla_clocks(company, client_row, hr_client):
    """Creating the row directly would leave the ticket permanently
    un-breachable — a queue where nothing is ever late."""
    response = hr_client.post(
        "/api/v1/crm/tickets/",
        {"client": client_row.id, "subject": "Wrong delivery", "priority": "high"},
        format="json",
    )

    assert response.status_code == 201
    assert response.data["response_due_at"] is not None
    assert response.data["reference"].startswith("CT-")


def test_an_illegal_move_through_the_api_is_refused(company, ticket, hr_client):
    hr_client.post(f"/api/v1/crm/tickets/{ticket.id}/move/", {"status": "waiting"}, format="json")
    response = hr_client.post(
        f"/api/v1/crm/tickets/{ticket.id}/move/", {"status": "resolved"}, format="json"
    )

    assert response.status_code == 409


def test_the_staff_timeline_includes_internal_notes(company, ticket, hr_client, hr_user):
    add_internal_note(ticket, "Their account is overdue.", actor=hr_user)
    response = hr_client.get(f"/api/v1/crm/tickets/{ticket.id}/timeline/")

    bodies = " ".join(e["body"] for e in response.data)
    assert "overdue" in bodies


def test_age_is_reported_in_hours(company, ticket, hr_client):
    """A queue is read by age far more than by date — "open four days" is what
    makes somebody act."""
    response = hr_client.get(f"/api/v1/crm/tickets/{ticket.id}/")

    assert response.data["age_hours"] >= 0
