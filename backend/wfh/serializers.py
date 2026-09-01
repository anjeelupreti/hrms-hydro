from rest_framework import serializers

from wfh.models import WFHRequest


class WFHRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    department_name = serializers.CharField(source="employee.department.name", read_only=True, default=None)
    days = serializers.IntegerField(read_only=True)
    decided_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WFHRequest
        fields = [
            "id",
            "employee",
            "employee_name",
            "employee_code",
            "department_name",
            "start_date",
            "end_date",
            "days",
            "work_location",
            "location_note",
            "reason",
            "status",
            "decided_by_name",
            "decided_at",
            "created_at",
        ]
        read_only_fields = ["status", "decided_by_name", "decided_at", "created_at"]

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()

    def get_decided_by_name(self, obj):
        if obj.decided_by is None:
            return None
        return obj.decided_by.get_full_name() or obj.decided_by.get_username()


class WFHCreateSerializer(serializers.Serializer):
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    work_location = serializers.ChoiceField(choices=WFHRequest.WorkLocation.choices, default=WFHRequest.WorkLocation.HOME)
    location_note = serializers.CharField(required=False, allow_blank=True, default="")
    reason = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError("End date can't be before start date.")
        return attrs
