from rest_framework import serializers

from mail.models import EmailAttachment, EmailMessage


class EmailAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailAttachment
        fields = ["id", "filename", "content_type"]


class EmailMessageListSerializer(serializers.ModelSerializer):
    """Lightweight — no bodies, for the inbox list."""

    snippet = serializers.SerializerMethodField()

    class Meta:
        model = EmailMessage
        fields = [
            "id",
            "folder",
            "from_email",
            "from_name",
            "to",
            "subject",
            "snippet",
            "date",
            "is_read",
            "is_outgoing",
            "has_attachments",
        ]

    def get_snippet(self, obj):
        return (obj.body_text or "")[:140].strip()


class EmailMessageDetailSerializer(serializers.ModelSerializer):
    attachments = EmailAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = EmailMessage
        fields = [
            "id",
            "folder",
            "from_email",
            "from_name",
            "to",
            "cc",
            "subject",
            "body_text",
            "body_html",
            "date",
            "is_read",
            "is_outgoing",
            "has_attachments",
            "attachments",
        ]


class SendEmailSerializer(serializers.Serializer):
    to = serializers.CharField()
    subject = serializers.CharField(allow_blank=True, default="")
    body = serializers.CharField(allow_blank=True, default="")
    cc = serializers.CharField(allow_blank=True, required=False, default="")
