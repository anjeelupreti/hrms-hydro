from django.conf import settings
from django.db import models

from core.models import AuditModel


def chat_attachment_upload_path(instance, filename):
    return f"chat/{instance.message_id}/{filename}"


class Conversation(AuditModel):
    """A DM (exactly two members), a named group (2+ members), or your own thread.

    `type` is fixed at creation. For DMs `name` stays blank — the UI shows
    the *other* member's name; for groups `name` is required. There is no
    "channel vs DM" distinction beyond this flag: both are just a
    Conversation with memberships and messages.

    `SELF` is the one-member thread — the place you message yourself, the way
    Viber and WhatsApp both ended up providing. It is a separate type rather
    than a DM you happen to be alone in, because every piece of DM handling
    assumes somebody on the other end: the create serializer rejects a member
    list with no one else in it, and the display name resolves to the *other*
    member and falls back to "(empty)". A self-DM would have slipped through
    both as a nameless, broken-looking row. Naming the case fixes both at once.
    """

    class Type(models.TextChoices):
        DM = "dm", "Direct message"
        GROUP = "group", "Group"
        SELF = "self", "Your notes"

    type = models.CharField(max_length=10, choices=Type.choices)
    name = models.CharField(max_length=150, blank=True)

    class Meta:
        # -updated_at so the conversation list is naturally most-recent-first;
        # sending a message bumps updated_at (see consumers.py).
        ordering = ["-updated_at"]

    def __str__(self):
        return self.name or f"{self.get_type_display()} #{self.pk}"


class ConversationMembership(models.Model):
    """Who's in a conversation, plus their read cursor.

    `last_read_at` is the whole unread mechanism: unread count is messages
    newer than this timestamp not sent by the member. A plain model (not
    AuditModel) — membership rows aren't independently audited, the
    conversation is.
    """

    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="conversation_memberships",
    )
    last_read_at = models.DateTimeField(null=True, blank=True)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["conversation", "user"], name="unique_conversation_member"
            )
        ]

    def __str__(self):
        return f"{self.user} in {self.conversation}"


class Message(AuditModel):
    """A single chat message.

    Deletion is soft (`deleted_at` set, `body` cleared) so the thread keeps
    its shape — the UI renders a "message was deleted" tombstone rather than
    a gap, and a deleted message's content is genuinely gone (not just
    hidden). `edited_at` drives the "edited" marker. `sender` is kept
    explicit and non-null even though AuditModel has `created_by`: a message
    always has a human author, and the semantics read clearer than
    overloading created_by.
    """

    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages"
    )
    body = models.TextField(blank=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["conversation", "created_at"])]

    @property
    def is_deleted(self):
        return self.deleted_at is not None

    def __str__(self):
        return f"{self.sender} in {self.conversation}: {self.body[:40]}"


class ChatAttachment(models.Model):
    """A file attached to a chat message. Uploaded over REST (multipart)
    rather than the WebSocket, then the resulting message is broadcast to
    the conversation group like any other."""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to=chat_attachment_upload_path)
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=255, blank=True)

    def __str__(self):
        return self.filename
