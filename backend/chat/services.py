"""Shared chat helpers used by both the REST viewsets and the WS consumer.

Group names are namespaced by kind — `chat_conv_<id>` for a conversation,
`chat_user_<id>` for one person's own feed — so the two never collide on the
channel layer.
"""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def conv_group(conversation_id: int) -> str:
    return f"chat_conv_{conversation_id}"


def user_group(user_id: int) -> str:
    return f"chat_user_{user_id}"


def sender_display(user) -> str:
    return user.get_full_name() or user.get_username()


def message_to_dict(message) -> dict:
    """Canonical wire shape for a message — identical between the REST
    history endpoint and the live WS events, so the frontend has exactly
    one Message type. A soft-deleted message reports an empty body."""
    return {
        "id": message.id,
        "conversation": message.conversation_id,
        "sender_id": message.sender_id,
        "sender_name": sender_display(message.sender),
        "body": "" if message.deleted_at else message.body,
        "created_at": message.created_at.isoformat(),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
        "deleted_at": message.deleted_at.isoformat() if message.deleted_at else None,
        "is_deleted": message.deleted_at is not None,
        "attachments": []
        if message.deleted_at
        else [
            {
                "id": att.id,
                "filename": att.filename,
                "content_type": att.content_type,
            }
            for att in message.attachments.all()
        ],
    }


def broadcast_message(message, client_id: str | None = None):
    """Push a message (e.g. one created with an attachment, or sent over the
    REST fallback) to its conversation group, exactly like the WS send path
    does. `client_id` echoes the sender's optimistic placeholder id so their
    own socket can reconcile it instead of showing the message twice."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        conv_group(message.conversation_id),
        {"type": "chat.message", "message": message_to_dict(message), "client_id": client_id},
    )


def notify_conversation_created(conversation_id: int, member_ids, payload: dict):
    """Push a brand-new conversation to each member's personal group so any
    currently-connected socket can join the new conversation group live
    (without reconnecting). Called from the REST create endpoint, which is
    sync — hence async_to_sync around the channel layer."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    for uid in member_ids:
        async_to_sync(channel_layer.group_send)(
            user_group(uid),
            {"type": "conversation.new", "conversation_id": conversation_id, "payload": payload},
        )
