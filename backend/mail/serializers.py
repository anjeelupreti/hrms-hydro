from rest_framework import serializers

from mail.models import (
    EmailAttachment,
    EmailMessage,
    IncomingLetter,
    LetterAttachment,
    OutgoingLetter,
)


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


class LetterAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    filename = serializers.SerializerMethodField()

    class Meta:
        model = LetterAttachment
        fields = ["id", "file", "file_url", "filename", "caption", "uploaded_at"]
        read_only_fields = ["id", "file_url", "filename", "uploaded_at"]
        extra_kwargs = {"file": {"write_only": True}}

    def get_file_url(self, obj):
        request = self.context.get("request")
        return request.build_absolute_uri(obj.file.url) if request else obj.file.url

    def get_filename(self, obj):
        return obj.file.name.split("/")[-1]


class OutgoingLetterSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)
    attachments = LetterAttachmentSerializer(many=True, read_only=True)
    reply_count = serializers.SerializerMethodField()

    class Meta:
        model = OutgoingLetter
        fields = [
            "id", "ref", "company", "company_name", "letter_date", "subject", "body",
            "addressed_to", "recipients", "cc",
            "status", "sent_at", "error", "attachments", "reply_count",
            "created_at",
        ]
        read_only_fields = ["id", "status", "sent_at", "error", "attachments", "created_at"]

    def get_reply_count(self, obj):
        return obj.replies.count()

    def validate_ref(self, value):
        """**Typed, and unique within the company.** The office keeps its own
        numbering convention; what a register cannot tolerate is two letters
        under one number."""
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Give the letter a reference number.")
        return value

    def validate_recipients(self, value):
        return _clean_emails(value, "recipients")

    def validate_cc(self, value):
        return _clean_emails(value, "cc")


class IncomingLetterSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)
    attachments = LetterAttachmentSerializer(many=True, read_only=True)
    notify_names = serializers.SerializerMethodField()
    in_reply_to_ref = serializers.CharField(source="in_reply_to.ref", read_only=True, default=None)

    class Meta:
        model = IncomingLetter
        fields = [
            "id", "ref", "company", "company_name",
            "letter_date", "received_on", "received_via",
            "subject", "from_office", "from_person", "from_email",
            "notify", "notify_names", "note",
            "in_reply_to", "in_reply_to_ref",
            "attachments", "created_at",
        ]
        read_only_fields = ["id", "attachments", "created_at"]

    def get_notify_names(self, obj):
        return [
            {
                "id": e.pk,
                "name": e.user.get_full_name() or e.user.get_username(),
                "employee_code": e.employee_code,
            }
            for e in obj.notify.all()
        ]

    def validate_ref(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Give the letter a reference number.")
        return value


def _clean_emails(value, field):
    """Trimmed, de-duplicated, and actually addresses.

    A register that accepted "ram sharma" as a recipient would look like it had
    sent something to a person and have posted nothing at all.
    """
    from django.core.validators import validate_email
    from django.core.exceptions import ValidationError as DjangoValidationError

    cleaned = []
    for raw in value or []:
        address = (raw or "").strip()
        if not address:
            continue
        try:
            validate_email(address)
        except DjangoValidationError:
            raise serializers.ValidationError(f"{address} is not an email address.")
        if address not in cleaned:
            cleaned.append(address)
    return cleaned
