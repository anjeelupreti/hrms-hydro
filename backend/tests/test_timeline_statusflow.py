"""The CRM/support foundation: timelines and declared status flows.

**A status flow is a set of legal moves.** A board where any card goes to any
column is a spreadsheet with rounded corners; these tests are mostly about the
moves that are refused.
"""

import pytest

from core.statusflow import TICKET_FLOW, StatusFlow, TransitionError
from core.timeline import (
    TimelineKind,
    TimelineVisibility,
    duration_in_current_status,
    record,
    record_status_change,
    timeline_for,
)

pytestmark = pytest.mark.django_db


# ── Declared transitions ─────────────────────────────────────────────────


def test_a_legal_move_is_allowed_and_an_illegal_one_is_not():
    assert TICKET_FLOW.can("open", "in_progress") is True
    assert TICKET_FLOW.can("waiting", "resolved") is False


def test_resolving_from_waiting_is_refused_with_the_alternatives():
    """"Resolved" while waiting on somebody else is a claim nobody has checked.

    The message lists where you *can* go, because a refusal that does not say
    what is allowed just sends the reader to the source.
    """
    with pytest.raises(TransitionError) as exc:
        TICKET_FLOW.check("waiting", "resolved")

    message = str(exc.value)
    assert "In progress" in message
    assert "Open" in message


def test_a_no_op_move_is_always_allowed():
    """Saving a form without changing the status must not be an error."""
    assert TICKET_FLOW.can("closed", "closed") is True
    TICKET_FLOW.check("resolved", "resolved")


def test_reopening_goes_back_to_open_rather_than_a_reopened_state():
    """A reopened ticket *is* open. Giving it its own column would split every
    "how many are open" count in two."""
    assert "reopened" not in TICKET_FLOW.values
    assert TICKET_FLOW.can("resolved", "open") is True
    assert TICKET_FLOW.can("closed", "open") is True


def test_columns_come_from_the_flow_in_declared_order():
    """The board's columns are the flow's states — so the UI does not keep a
    second copy of that list to drift from the model."""
    columns = TICKET_FLOW.columns()

    assert [c["value"] for c in columns] == [
        "open", "in_progress", "waiting", "resolved", "closed"
    ]
    assert columns[-1]["is_terminal"] is True
    assert columns[0]["is_terminal"] is False


def test_order_is_data_not_alphabetical():
    """A board reads left to right; sorting it would scramble that."""
    assert TICKET_FLOW.values == [
        "open", "in_progress", "waiting", "resolved", "closed"
    ]
    assert TICKET_FLOW.values != sorted(TICKET_FLOW.values)


# ── Applying a transition records it ─────────────────────────────────────


def test_applying_a_move_writes_a_timeline_entry(company, payroll_setup, hr_user):
    """Recorded by the flow rather than by each caller, so a status that moves
    without a timeline entry is a bug in one place rather than an omission in
    twenty."""
    from crm.models import Client, TimelineEntry

    client = Client.objects.create(name="Acme Trading", status="lead")
    flow = StatusFlow(
        states=[("lead", "Lead"), ("active", "Active")],
        transitions={"lead": {"active"}},
    )
    flow.apply(client, "active", timeline_model=TimelineEntry, actor=hr_user)

    entries = list(timeline_for(TimelineEntry, client))

    assert len(entries) == 1
    assert entries[0].kind == TimelineKind.STATUS
    assert (entries[0].from_value, entries[0].to_value) == ("lead", "active")


def test_a_no_op_move_writes_nothing(company, payroll_setup, hr_user):
    """"open → open" would pad the history and skew duration-in-status."""
    from crm.models import Client, TimelineEntry

    client = Client.objects.create(name="Acme Trading", status="lead")
    assert record_status_change(TimelineEntry, client, "lead", "lead") is None
    assert timeline_for(TimelineEntry, client).count() == 0


def test_an_illegal_move_changes_nothing(company, payroll_setup, hr_user):
    from crm.models import Client, TimelineEntry

    client = Client.objects.create(name="Acme Trading", status="lead")
    flow = StatusFlow(
        states=[("lead", "Lead"), ("active", "Active"), ("lost", "Lost")],
        transitions={"lead": {"active"}, "active": {"lost"}},
    )
    with pytest.raises(TransitionError):
        flow.apply(client, "lost", timeline_model=TimelineEntry, actor=hr_user)

    client.refresh_from_db()
    assert client.status == "lead"
    assert timeline_for(TimelineEntry, client).count() == 0


# ── Visibility is a field, not a convention ──────────────────────────────


def test_entries_are_internal_by_default(company, payroll_setup):
    """The safe direction to be wrong in — an internal note reaching a customer
    is the one unrecoverable mistake this module can make."""
    from crm.models import Client, TimelineEntry

    client = Client.objects.create(name="Acme Trading", status="lead")
    entry = record(TimelineEntry, client, body="They sounded hesitant.")

    assert entry.visibility == TimelineVisibility.INTERNAL


def test_a_customer_view_sees_only_customer_entries(company, payroll_setup):
    from crm.models import Client, TimelineEntry

    client = Client.objects.create(name="Acme Trading", status="lead")
    record(TimelineEntry, client, body="Internal: their budget is thin.")
    record(
        TimelineEntry, client, body="Thanks for your patience.",
        kind=TimelineKind.REPLY, visibility=TimelineVisibility.CUSTOMER,
    )

    internal = timeline_for(TimelineEntry, client).count()
    customer = list(timeline_for(TimelineEntry, client, include_internal=False))

    assert internal == 2
    assert len(customer) == 1
    assert "budget" not in customer[0].body


# ── Duration in status ───────────────────────────────────────────────────


def test_duration_is_none_before_anything_moves(company, payroll_setup):
    """Nothing has happened yet, which is different from "zero seconds"."""
    from crm.models import Client, TimelineEntry

    client = Client.objects.create(name="Acme Trading", status="lead")
    assert duration_in_current_status(TimelineEntry, client) is None


def test_duration_measures_since_the_last_status_change(company, payroll_setup, hr_user):
    """The number `updated_at` cannot give: a ticket answered yesterday and one
    untouched for a week look identical by modification time."""
    from crm.models import Client, TimelineEntry

    client = Client.objects.create(name="Acme Trading", status="lead")
    record_status_change(TimelineEntry, client, "lead", "active", actor=hr_user)
    # A note afterwards must not reset the clock — the status has not moved.
    record(TimelineEntry, client, body="Chased by email.")

    elapsed = duration_in_current_status(TimelineEntry, client)

    assert elapsed is not None
    assert elapsed.total_seconds() < 60


