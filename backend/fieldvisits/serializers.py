from rest_framework import serializers

from fieldvisits.models import FieldVisit, FieldVisitAttachment, FieldVisitParticipant, Site


def _name(employee):
    if employee is None:
        return None
    user = employee.user
    return user.get_full_name() or user.get_username()


class FieldVisitParticipantSerializer(serializers.ModelSerializer):
    """One more person who went. `name` is optional on input — picking an
    employee fills it in — and always present on output."""

    name = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = FieldVisitParticipant
        fields = ["id", "visit", "employee", "name", "organisation", "role"]
        read_only_fields = ["visit"]

    def validate(self, attrs):
        name = attrs.get("name") or getattr(self.instance, "name", "")
        employee = attrs.get("employee") or getattr(self.instance, "employee", None)
        if not name and employee is None:
            raise serializers.ValidationError(
                {"name": "Give a name, or pick an employee to take it from."}
            )
        return attrs


class FieldVisitAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = FieldVisitAttachment
        fields = ["id", "visit", "file", "file_url", "caption", "created_at"]
        read_only_fields = ["visit", "created_at"]

    def get_file_url(self, obj):
        return obj.file.url if obj.file else None


class FieldVisitSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    approver_name = serializers.SerializerMethodField()
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    purpose_display = serializers.CharField(source="get_purpose_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    participants = FieldVisitParticipantSerializer(many=True, read_only=True)
    attachments = FieldVisitAttachmentSerializer(many=True, read_only=True)
    days = serializers.IntegerField(read_only=True)
    is_locked = serializers.BooleanField(read_only=True)

    site_name = serializers.CharField(source="site.name", read_only=True, default=None)

    class Meta:
        model = FieldVisit
        fields = [
            "id", "employee", "employee_name", "employee_code",
            "company", "company_name", "project", "project_name",
            "purpose", "purpose_display", "title", "destination", "district",
            # Optional, and the reason the approver list is what it is: a site
            # brings its own supervisors into the choice. See
            # `services.eligible_approvers`.
            "site", "site_name",
            "starts_on", "ends_on", "days", "description", "report",
            "transport", "estimated_cost",
            "status", "status_display", "approver", "approver_name",
            "decided_at", "decision_note", "completed_at",
            "expense_claim", "participants", "attachments", "is_locked",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            # Everything the travel order owns. A visit whose status could be
            # PATCHed would have two ways to become approved, and only one of
            # them notifies anybody or counts for attendance.
            "employee", "status", "decided_at", "decision_note", "completed_at",
            "created_at", "updated_at",
        ]

    def get_employee_name(self, obj):
        return _name(obj.employee)

    def get_approver_name(self, obj):
        return _name(obj.approver)

    def validate(self, attrs):
        starts = attrs.get("starts_on") or getattr(self.instance, "starts_on", None)
        ends = attrs.get("ends_on") or getattr(self.instance, "ends_on", None)
        if starts and ends and ends < starts:
            raise serializers.ValidationError({"ends_on": "A visit cannot end before it starts."})
        if self.instance is not None and self.instance.is_locked:
            raise serializers.ValidationError(
                "This visit has been decided. Reopen it by raising a new one."
            )
        return attrs


class EligibleApproverSerializer(serializers.Serializer):
    """Read-only: who this person may ask, for the picker on the request form."""

    id = serializers.IntegerField()
    name = serializers.SerializerMethodField()
    employee_code = serializers.CharField()

    def get_name(self, obj):
        return _name(obj)


class SiteSerializer(serializers.ModelSerializer):
    """A place people are sent to, and the people who sign off going there."""

    supervisor_names = serializers.SerializerMethodField()
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)
    #: How many trips have been made here. What tells a coordinator which sites
    #: are live and which are a row somebody created once.
    visit_count = serializers.SerializerMethodField()

    class Meta:
        model = Site
        fields = [
            "id", "name", "code", "company", "company_name",
            "district", "province", "address", "description",
            "supervisors", "supervisor_names", "is_active", "visit_count",
        ]

    def get_supervisor_names(self, obj):
        return [
            {"id": e.pk, "name": _name(e), "employee_code": e.employee_code}
            for e in obj.supervisors.all()
        ]

    def get_visit_count(self, obj):
        return obj.visits.count()
