from rest_framework import serializers

from events.models import Event, EventAttachment, EventStakeholder


class EventStakeholderSerializer(serializers.ModelSerializer):
    """One person on the list.

    `name` is not required on input: picking an employee fills it in, and the
    model's `save` is where that happens so the API and the admin and a
    management command all get it. It is always present on output.
    """

    name = serializers.CharField(required=False, allow_blank=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)

    class Meta:
        model = EventStakeholder
        fields = [
            "id", "event", "employee", "name", "employee_code", "organisation",
            "role", "role_display", "email", "phone", "attended", "note",
        ]
        read_only_fields = ["event"]

    def validate(self, attrs):
        # One of the two has to identify somebody. A row with neither is an
        # empty line in an attendance record, which is worse than no line.
        name = attrs.get("name") or getattr(self.instance, "name", "")
        employee = attrs.get("employee") or getattr(self.instance, "employee", None)
        if not name and employee is None:
            raise serializers.ValidationError(
                {"name": "Give a name, or pick an employee to take it from."}
            )
        return attrs


class EventAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = EventAttachment
        fields = ["id", "event", "file", "file_url", "caption", "uploaded_by_name", "created_at"]
        read_only_fields = ["event", "created_at"]

    def get_file_url(self, obj):
        return obj.file.url if obj.file else None

    def get_uploaded_by_name(self, obj):
        if obj.uploaded_by is None:
            return None
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.get_username()


class EventListSerializer(serializers.ModelSerializer):
    """The shape the timeline reads.

    Carries counts rather than the nested lists — a timeline of two hundred
    events does not need eleven stakeholders each, and "3 files · 15 people" is
    what the row actually shows.
    """

    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    organiser_name = serializers.SerializerMethodField()
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)
    stakeholder_count = serializers.IntegerField(read_only=True)
    attachment_count = serializers.IntegerField(read_only=True)
    is_past = serializers.BooleanField(read_only=True)

    class Meta:
        model = Event
        fields = [
            "id", "title", "kind", "kind_display", "status", "status_display",
            "subject_matter", "starts_at", "ends_at", "is_all_day", "location",
            "company", "company_name", "organiser", "organiser_name",
            "stakeholder_count", "attachment_count", "is_past",
        ]

    def get_organiser_name(self, obj):
        if obj.organiser is None:
            return None
        user = obj.organiser.user
        return user.get_full_name() or user.get_username()


class EventSerializer(EventListSerializer):
    """The whole thing, for the detail view."""

    stakeholders = EventStakeholderSerializer(many=True, read_only=True)
    attachments = EventAttachmentSerializer(many=True, read_only=True)

    class Meta(EventListSerializer.Meta):
        fields = EventListSerializer.Meta.fields + [
            "description", "outcome", "stakeholders", "attachments",
            "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate(self, attrs):
        starts = attrs.get("starts_at") or getattr(self.instance, "starts_at", None)
        ends = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends < starts:
            raise serializers.ValidationError({"ends_at": "An event cannot end before it starts."})
        return attrs
