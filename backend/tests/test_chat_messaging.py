"""Chat send paths — the WebSocket consumer and the REST fallback.

There were no tests here, which is exactly how the following shipped: the
consumer's `database_sync_to_async` helpers returned a `Message` *model*, and
the caller — running on the event loop — then called `message_to_dict()` on
it. That walks `message.attachments`, a lazy queryset, so it raised
`SynchronousOnlyOperation` and Channels closed the socket with 1011. The row
had already been committed by that point, so the visible symptom was the worst
kind: messages that saved to the database and were never delivered to anyone,
including the sender.

The tests below pin both halves of the fix — the helpers hand back a fully
materialised payload, and there is a REST path that works when the socket
doesn't.
"""

import asyncio
import json

import pytest
from channels.layers import get_channel_layer
from django.core.exceptions import SynchronousOnlyOperation

from chat import services
from chat.consumers import ChatConsumer
from chat.models import Conversation, ConversationMembership, Message


@pytest.fixture
def dm(company, hr_user, employee_user):
    """A two-person DM both fixture users belong to."""
    conv = Conversation.objects.create(type=Conversation.Type.DM)
    ConversationMembership.objects.create(conversation=conv, user=hr_user)
    ConversationMembership.objects.create(conversation=conv, user=employee_user)
    return conv


def _consumer(company, user):
    """A ChatConsumer with just the state its DB helpers read.

    Constructed directly rather than through a WebsocketCommunicator: the
    helpers are what regressed, and reaching them this way keeps the test free
    of an event loop and a channel layer.
    """
    consumer = ChatConsumer()
    consumer.user_id = user.id
    consumer.user = user
    return consumer


def _call(consumer, name, *args):
    """Run one of the consumer's DB helpers, synchronously.

    `ChatConsumer.__dict__[name]` is the `SyncToAsync` wrapper itself and
    `.func` is the undecorated method — reaching it through normal attribute
    access instead would hit `SyncToAsync.__get__` and hand back a coroutine.
    Going around the wrapper is deliberate: it closes old connections, which
    would drop the connection this test's transaction is running on.

    What the wrapper does at runtime is covered separately by
    `test_a_returned_payload_survives_the_event_loop`.
    """
    return ChatConsumer.__dict__[name].func(consumer, *args)


def _serialise_on_the_loop(payload):
    """json.dumps the payload from inside a coroutine.

    This is the crossing that matters. A dict of primitives serialises fine
    here; anything still attached to the ORM raises SynchronousOnlyOperation
    the moment it is walked.
    """

    async def run():
        return json.dumps(payload)

    return asyncio.run(run())


# ── The regression ───────────────────────────────────────────────────────


def test_create_message_returns_a_materialised_payload(company, hr_user, dm):
    """Not a Message instance — a dict with no lazy relations left in it.

    This is the assertion that would have caught the bug: returning the model
    typechecks fine and works in every sync test, and only fails once the
    caller is on the event loop.
    """
    consumer = _consumer(company, hr_user)

    payload = _call(consumer, "_create_message", dm.id, "hello there")

    assert isinstance(payload, dict)
    assert payload["body"] == "hello there"
    assert payload["conversation"] == dm.id
    assert payload["sender_id"] == hr_user.id
    assert payload["attachments"] == []


def test_edit_and_delete_also_return_payloads(company, hr_user, dm):
    """The edit/delete paths broke the same way and are fixed the same way."""
    consumer = _consumer(company, hr_user)

    created = _call(consumer, "_create_message", dm.id, "first draft")
    edited = _call(consumer, "_edit_message", created["id"], "second draft")
    deleted = _call(consumer, "_delete_message", created["id"])

    assert edited["body"] == "second draft"
    assert edited["edited_at"] is not None
    # The consumer routes the broadcast by payload["conversation"], so this key
    # has to survive — it replaced `message.conversation_id`.
    assert edited["conversation"] == dm.id

    assert deleted["is_deleted"] is True
    assert deleted["body"] == ""  # deleted content is gone, not merely hidden


def test_a_returned_payload_survives_the_event_loop(company, hr_user, dm):
    """The end-to-end shape of the rule.

    `_handle_send` takes what the helper returns and broadcasts it from the
    event loop. If the helper hands back a model with a lazy `attachments`
    relation attached, serialising there raises.
    """
    consumer = _consumer(company, hr_user)

    payload = _call(consumer, "_create_message", dm.id, "across the boundary")

    assert json.loads(_serialise_on_the_loop(payload))["body"] == "across the boundary"


def test_message_to_dict_cannot_run_on_the_event_loop(company, hr_user, dm):
    """Why the helpers must serialise before handing back.

    If this ever stops raising, Django has changed its async-safety rules and
    the constraint the consumer is built around no longer applies.
    """
    message = Message.objects.select_related("sender").create(
        conversation=dm, sender=hr_user, body="from a thread"
    )

    async def serialise_on_the_loop():
        return services.message_to_dict(message)

    with pytest.raises(SynchronousOnlyOperation):
        asyncio.run(serialise_on_the_loop())


# ── The REST fallback ────────────────────────────────────────────────────


def test_rest_send_creates_and_returns_the_message(company, hr_client, hr_user, dm):
    """Message creation lives outside the consumer, so a blocked socket
    degrades to REST rather than to a send button that does nothing."""
    response = hr_client.post(
        f"/api/v1/chat/conversations/{dm.id}/messages/",
        {"body": "sent over http", "client_id": "abc-123"},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["body"] == "sent over http"
    assert response.data["sender_id"] == hr_user.id

    assert Message.objects.filter(conversation=dm, body="sent over http").exists()


def test_rest_send_rejects_an_empty_body(company, hr_client, dm):
    response = hr_client.post(
        f"/api/v1/chat/conversations/{dm.id}/messages/", {"body": "   "}, format="json"
    )
    assert response.status_code == 400


def test_rest_send_refuses_a_conversation_you_are_not_in(company, employee_client, hr_user):
    """Membership is the whole access check — get_queryset filters to
    conversations you belong to, so a non-member 404s rather than posting."""
    private = Conversation.objects.create(type=Conversation.Type.GROUP, name="HR only")
    ConversationMembership.objects.create(conversation=private, user=hr_user)

    response = employee_client.post(
        f"/api/v1/chat/conversations/{private.id}/messages/", {"body": "let me in"}, format="json"
    )

    assert response.status_code == 404
    assert not Message.objects.filter(conversation=private).exists()


def test_rest_send_broadcasts_with_the_client_id(company, hr_client, dm, monkeypatch):
    """The sender's optimistic placeholder is reconciled by client_id.

    If the broadcast dropped it, a message sent over REST would show up twice
    for its own sender the moment their socket came back — once as the
    placeholder, once as the echo.
    """
    sent = []

    async def spy(group, payload):
        sent.append((group, payload))

    layer = get_channel_layer()
    monkeypatch.setattr(layer, "group_send", spy)

    response = hr_client.post(
        f"/api/v1/chat/conversations/{dm.id}/messages/",
        {"body": "reconcile me", "client_id": "opt-1"},
        format="json",
    )

    assert response.status_code == 201
    assert sent, "the message was never broadcast"
    group, payload = sent[0]
    assert group == services.conv_group(dm.id)
    assert payload["client_id"] == "opt-1"
    assert payload["message"]["body"] == "reconcile me"
