from django.db import transaction
from rest_framework import serializers

from accounts.models import User
from chat import services
from chat.models import Conversation, ConversationMembership


class MessageSerializer(serializers.Serializer):
    """Read-only. Delegates to services.message_to_dict so the REST history
    payload is byte-for-byte the same shape as the live WS events — the
    frontend has exactly one Message type."""

    def to_representation(self, instance):
        return services.message_to_dict(instance)


class ParticipantSerializer(serializers.Serializer):
    """A user you can start a conversation with (the new-chat picker)."""

    def to_representation(self, user):
        return {
            "user_id": user.id,
            "name": services.sender_display(user),
            "role": user.role,
        }


class ConversationSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    members = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = ["id", "type", "name", "display_name", "members", "last_message", "unread_count", "updated_at"]

    def _me(self):
        return self.context["request"].user

    def get_display_name(self, conv):
        # DMs have no stored name — show the *other* member's name. Groups
        # use their stored name.
        if conv.type == Conversation.Type.SELF:
            # Named here rather than stored, so it stays in one place and can be
            # translated later without a data migration.
            return "Your notes"
        if conv.type == Conversation.Type.DM:
            me = self._me()
            others = [m.user for m in conv.memberships.all() if m.user_id != me.id]
            return services.sender_display(others[0]) if others else "(empty)"
        return conv.name

    def get_members(self, conv):
        return [
            {"user_id": m.user_id, "name": services.sender_display(m.user)}
            for m in conv.memberships.all()
        ]

    def get_last_message(self, conv):
        # One query per conversation — a personal conversation list is small
        # (tens at most), so this stays cheap; revisit with a DISTINCT ON
        # prefetch if it ever grows.
        message = conv.messages.select_related("sender").order_by("-created_at").first()
        return services.message_to_dict(message) if message else None

    def get_unread_count(self, conv):
        me = self._me()
        membership = next((m for m in conv.memberships.all() if m.user_id == me.id), None)
        if membership is None:
            return 0
        qs = conv.messages.filter(deleted_at__isnull=True).exclude(sender_id=me.id)
        if membership.last_read_at:
            qs = qs.filter(created_at__gt=membership.last_read_at)
        return qs.count()


class ConversationCreateSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=Conversation.Type.choices)
    member_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)
    name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    def validate(self, attrs):
        me = self.context["request"].user
        other_ids = [uid for uid in dict.fromkeys(attrs["member_ids"]) if uid != me.id]
        if not other_ids:
            raise serializers.ValidationError("Pick at least one other person.")

        valid_ids = set(
            User.objects.filter(id__in=other_ids, is_active=True).values_list("id", flat=True)
        )
        missing = set(other_ids) - valid_ids
        if missing:
            raise serializers.ValidationError(f"Unknown user(s): {sorted(missing)}")

        if attrs["type"] == Conversation.Type.DM:
            if len(other_ids) != 1:
                raise serializers.ValidationError("A direct message has exactly one other person.")
        elif not (attrs.get("name") or "").strip():
            raise serializers.ValidationError("A group needs a name.")

        attrs["other_ids"] = other_ids
        return attrs

    @transaction.atomic
    def create(self, validated):
        me = self.context["request"].user
        other_ids = validated["other_ids"]

        # DM dedupe: reuse an existing 1:1 conversation between exactly these
        # two people rather than spawning duplicates.
        if validated["type"] == Conversation.Type.DM:
            existing = (
                Conversation.objects.filter(type=Conversation.Type.DM, memberships__user=me)
                .filter(memberships__user_id=other_ids[0])
                .first()
            )
            if existing:
                self._created_new = False
                return existing

        conv = Conversation.objects.create(
            type=validated["type"],
            name=validated.get("name", "").strip(),
            created_by=me,
            updated_by=me,
        )
        member_ids = [me.id, *other_ids]
        ConversationMembership.objects.bulk_create(
            [ConversationMembership(conversation=conv, user_id=uid) for uid in member_ids]
        )
        self._created_new = True
        self._member_ids = member_ids
        return conv
