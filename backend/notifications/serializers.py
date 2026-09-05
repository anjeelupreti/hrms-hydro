from rest_framework import serializers

from notifications.models import (
    AgendaItem,
    Announcement,
    CompanyEvent,
    Holiday,
    MeetingAttendee,
    DecisionPosition,
    MeetingDecision,
    MeetingMinutes,
    MinutesSection,
    MinutesTemplate,
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
        fields = [
            "id", "employee", "employee_code", "employee_name", "rsvp_status",
            # Who actually came, which is not who accepted — see the model.
            "attendance", "attendance_marked_at",
        ]
        read_only_fields = [
            "id", "employee", "employee_code", "employee_name", "attendance_marked_at",
        ]

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


class AgendaItemSerializer(serializers.ModelSerializer):
    presenter_name = serializers.SerializerMethodField()

    class Meta:
        model = AgendaItem
        fields = [
            "id", "meeting", "order", "title", "detail",
            "presenter", "presenter_name", "raised_in_meeting",
        ]
        read_only_fields = ["id", "meeting", "presenter_name"]

    def get_presenter_name(self, obj):
        if obj.presenter is None:
            return None
        user = obj.presenter.user
        return user.get_full_name() or user.get_username()


class DecisionPositionSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    signature_url = serializers.SerializerMethodField()

    class Meta:
        model = DecisionPosition
        fields = [
            "id", "employee", "employee_name", "employee_code",
            "position", "signature_url", "reason", "answered_at",
        ]
        read_only_fields = fields

    def get_employee_name(self, obj):
        user = obj.employee.user
        return user.get_full_name() or user.get_username()

    def get_signature_url(self, obj):
        if obj.signature is None or not obj.signature.image:
            return None
        request = self.context.get("request")
        url = obj.signature.image.url
        return request.build_absolute_uri(url) if request else url


class MeetingDecisionSerializer(serializers.ModelSerializer):
    positions = DecisionPositionSerializer(many=True, read_only=True)
    #: What the reader may do with it, answered by the server so a button is
    #: never drawn where pressing it would be refused.
    my_position = serializers.SerializerMethodField()
    tally = serializers.SerializerMethodField()

    class Meta:
        model = MeetingDecision
        fields = [
            "id", "meeting", "agenda_item", "order", "text", "status",
            "circulated_at", "positions", "my_position", "tally",
        ]
        read_only_fields = ["id", "meeting", "status", "circulated_at", "positions"]

    def _me(self):
        request = self.context.get("request")
        return getattr(getattr(request, "user", None), "employee", None)

    def get_my_position(self, obj):
        me = self._me()
        if me is None:
            return None
        row = next((p for p in obj.positions.all() if p.employee_id == me.pk), None)
        return row.position if row else None

    def get_tally(self, obj):
        """The count, so a reader sees where a decision stands without doing
        the arithmetic on a list of names."""
        counts = {"consent": 0, "dissent": 0, "abstain": 0, "pending": 0}
        for row in obj.positions.all():
            counts[row.position] = counts.get(row.position, 0) + 1
        return counts


class MinutesSectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = MinutesSection
        fields = ["id", "order", "heading", "source", "hint"]


class MinutesTemplateSerializer(serializers.ModelSerializer):
    sections = MinutesSectionSerializer(many=True, read_only=True)

    class Meta:
        model = MinutesTemplate
        fields = ["id", "name", "is_default", "is_active", "sections"]


class MeetingMinutesSerializer(serializers.ModelSerializer):
    template_name = serializers.CharField(source="template.name", read_only=True, default=None)
    is_locked = serializers.BooleanField(read_only=True)
    #: The heading of the sheet: whose paper, and the facts of the meeting.
    #: Served with the minute so the page needs one request, not three.
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)
    company_address = serializers.SerializerMethodField()
    company_logo = serializers.SerializerMethodField()
    meeting_title = serializers.CharField(source="meeting.title", read_only=True)
    starts_at = serializers.DateTimeField(source="meeting.start_datetime", read_only=True)
    ends_at = serializers.DateTimeField(source="meeting.end_datetime", read_only=True)
    location = serializers.CharField(source="meeting.location", read_only=True)
    duration_minutes = serializers.SerializerMethodField()

    class Meta:
        model = MeetingMinutes
        fields = [
            "id", "meeting", "template", "template_name",
            "minute_id", "company", "company_name", "company_address", "company_logo",
            "meeting_title", "starts_at", "ends_at", "location", "duration_minutes",
            "content", "status", "finalised_at", "is_locked",
        ]
        read_only_fields = [
            "id", "meeting", "status", "finalised_at", "is_locked", "minute_id",
        ]

    def get_duration_minutes(self, obj):
        """Derived, never stored. A duration that disagrees with the start and
        end times is a fact with two answers."""
        meeting = obj.meeting
        if not (meeting.start_datetime and meeting.end_datetime):
            return None
        return int((meeting.end_datetime - meeting.start_datetime).total_seconds() // 60)

    def get_company_address(self, obj):
        company = obj.company
        if company is None:
            return ""
        parts = []
        for part in (company.address, company.district, company.province):
            if part and part.lower() not in ", ".join(parts).lower():
                parts.append(part)
        return ", ".join(parts)

    def get_company_logo(self, obj):
        logo = getattr(obj.company, "logo", None) if obj.company else None
        if not logo:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(logo.url) if request else logo.url

    def validate_content(self, value):
        """Same allow-list as a memorandum. Sanitised on the way in, so what is
        stored is what is safe to render."""
        from memoranda.sanitize import clean_html

        return clean_html(value)
