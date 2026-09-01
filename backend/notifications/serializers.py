from rest_framework import serializers

from notifications.models import (
    Announcement,
    CompanyEvent,
    Holiday,
    MeetingAttendee,
    Notification,
    NotificationPreference,
    ReminderRule,
)


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "verb", "message", "is_read", "created_at"]
        read_only_fields = ["id", "verb", "message", "created_at"]


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ["email_enabled", "in_app_enabled", "push_enabled"]


class PushSubscriptionSerializer(serializers.Serializer):
    endpoint = serializers.CharField()
    keys = serializers.DictField(child=serializers.CharField())


class HolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Holiday
        fields = ["id", "name", "date"]


class MeetingAttendeeSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)

    class Meta:
        model = MeetingAttendee
        fields = ["id", "employee", "employee_code", "employee_name", "rsvp_status"]
        read_only_fields = ["id", "employee", "employee_code", "employee_name"]

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()


class CompanyEventSerializer(serializers.ModelSerializer):
    attendees = MeetingAttendeeSerializer(many=True, read_only=True)

    class Meta:
        model = CompanyEvent
        fields = [
            "id",
            "title",
            "description",
            "event_type",
            "start_datetime",
            "end_datetime",
            "all_day",
            "location",
            "attendees",
        ]

    def validate(self, attrs):
        start = attrs.get("start_datetime", getattr(self.instance, "start_datetime", None))
        end = attrs.get("end_datetime", getattr(self.instance, "end_datetime", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_datetime": "Must be on or after the start."})
        return attrs


class MeetingCreateSerializer(serializers.Serializer):
    """Creates the underlying CompanyEvent (event_type=MEETING) and
    invites the given attendees in one call — the frontend shouldn't
    need to know these are two separate models under the hood."""

    title = serializers.CharField()
    description = serializers.CharField(required=False, allow_blank=True, default="")
    start_datetime = serializers.DateTimeField()
    end_datetime = serializers.DateTimeField()
    location = serializers.CharField(required=False, allow_blank=True, default="")
    attendee_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=True, default=list)

    def validate(self, attrs):
        if attrs["end_datetime"] < attrs["start_datetime"]:
            raise serializers.ValidationError({"end_datetime": "Must be on or after the start."})
        return attrs


class AnnouncementSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    posted_by = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = [
            "id",
            "title",
            "body",
            "department",
            "department_name",
            "pinned",
            "expires_at",
            "posted_by",
            "created_at",
        ]
        read_only_fields = ["id", "posted_by", "created_at"]

    def get_posted_by(self, obj):
        if obj.created_by is None:
            return None
        return obj.created_by.get_full_name() or obj.created_by.get_username()


class ReminderRuleSerializer(serializers.ModelSerializer):
    """A rule, plus everything the settings screen needs to render it.

    The label, the description and the variable list come from the registry
    rather than the database, so a screen never has to hold a second copy of
    what a kind means — and adding a kind cannot leave the UI describing it
    wrongly, because there is nothing to update.
    """

    label = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    variables = serializers.SerializerMethodField()

    class Meta:
        model = ReminderRule
        fields = [
            "id", "kind", "label", "description", "variables",
            "is_enabled", "lead_days", "subject", "body",
        ]
        # `kind` names a registry entry and is set when the rule is seeded.
        # Editable, it would let somebody point a configured message at a
        # different query and quietly change who receives it.
        read_only_fields = ["id", "kind", "label", "description", "variables"]

    def _kind(self, obj):
        from notifications.reminders import get_kind

        return get_kind(obj.kind)

    def get_label(self, obj):
        kind = self._kind(obj)
        return kind.label if kind else obj.kind

    def get_description(self, obj):
        kind = self._kind(obj)
        return kind.description if kind else "This reminder is no longer available."

    def get_variables(self, obj):
        kind = self._kind(obj)
        return list(kind.variables) if kind else []

    def validate_lead_days(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Lead days must be a list of whole days.")
        cleaned = []
        for entry in value:
            try:
                days = int(entry)
            except (TypeError, ValueError) as exc:
                # `from exc` so the traceback distinguishes a bad input from a
                # fault in the handling of one.
                raise serializers.ValidationError(
                    f"{entry!r} is not a number of days."
                ) from exc
            if days < 0:
                raise serializers.ValidationError("A reminder cannot fire after the event.")
            if days > 365:
                # A year is already generous. Beyond it the reminder is about a
                # date nobody has confirmed yet, and the noise costs more than
                # the warning is worth.
                raise serializers.ValidationError("Lead time cannot exceed 365 days.")
            cleaned.append(days)
        if not cleaned:
            raise serializers.ValidationError("Give at least one lead time.")
        return sorted(set(cleaned), reverse=True)

    def validate(self, attrs):
        """Refuse a template naming a variable the kind does not offer.

        Caught here rather than at send time: an unknown name renders as itself,
        so `{employe_name}` would go out in a real email to real staff and
        nobody would know until somebody received it.
        """
        from notifications.reminders import PLACEHOLDER, get_kind

        kind = get_kind(self.instance.kind if self.instance else attrs.get("kind"))
        if kind is None:
            return attrs
        allowed = set(kind.variables)
        for field_name in ("subject", "body"):
            text = attrs.get(field_name)
            if not text:
                continue
            unknown = set(PLACEHOLDER.findall(text)) - allowed
            if unknown:
                raise serializers.ValidationError({
                    field_name: (
                        f"Unknown placeholder(s): {', '.join(sorted(unknown))}. "
                        f"Available: {', '.join(sorted(allowed))}."
                    )
                })
        return attrs
