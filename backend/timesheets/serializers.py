from rest_framework import serializers

from timesheets.models import TimeEntry


class TimeEntrySerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    project_name = serializers.CharField(source="project.name", read_only=True)
    task_title = serializers.CharField(source="task.title", read_only=True, default=None)

    class Meta:
        model = TimeEntry
        fields = [
            "id", "employee", "employee_name", "project", "project_name",
            "task", "task_title", "date", "hours", "description", "billable",
            "status", "decided_at", "created_at",
        ]
        read_only_fields = [
            "id", "employee", "employee_name", "project_name", "task_title",
            "status", "decided_at", "created_at",
        ]

    def get_employee_name(self, obj):
        if obj.employee is None:
            return None
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()

    def validate_hours(self, value):
        if value <= 0 or value > 24:
            raise serializers.ValidationError("Hours must be between 0 and 24.")
        return value
