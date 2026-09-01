from rest_framework import serializers

from training.models import Enrollment, TrainingProgram, TrainingSession


def _employee_name(employee):
    return employee.user.get_full_name() or employee.user.get_username()


def _requesting_employee(context):
    request = context.get("request")
    if request is None:
        return None
    return getattr(request.user, "employee", None)


class TrainingProgramSerializer(serializers.ModelSerializer):
    session_count = serializers.IntegerField(source="sessions.count", read_only=True)

    class Meta:
        model = TrainingProgram
        fields = [
            "id",
            "title",
            "description",
            "category",
            "delivery_mode",
            "is_active",
            "session_count",
        ]


class TrainingSessionSerializer(serializers.ModelSerializer):
    program_title = serializers.CharField(source="program.title", read_only=True)
    trainer_name = serializers.SerializerMethodField()
    seats_taken = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)
    my_enrollment = serializers.SerializerMethodField()

    class Meta:
        model = TrainingSession
        fields = [
            "id",
            "program",
            "program_title",
            "start_datetime",
            "end_datetime",
            "location",
            "capacity",
            "trainer",
            "trainer_name",
            "status",
            "seats_taken",
            "is_full",
            "my_enrollment",
        ]

    def get_trainer_name(self, obj):
        return _employee_name(obj.trainer) if obj.trainer else None

    def get_my_enrollment(self, obj):
        employee = _requesting_employee(self.context)
        if employee is None:
            return None
        enrollment = next((e for e in obj.enrollments.all() if e.employee_id == employee.id), None)
        return {"id": enrollment.id, "status": enrollment.status} if enrollment else None


class EnrollmentSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    program_title = serializers.CharField(source="session.program.title", read_only=True)
    session_start = serializers.DateTimeField(source="session.start_datetime", read_only=True)
    session_end = serializers.DateTimeField(source="session.end_datetime", read_only=True)
    trainer_name = serializers.SerializerMethodField()
    has_certificate = serializers.SerializerMethodField()

    class Meta:
        model = Enrollment
        fields = [
            "id",
            "session",
            "employee",
            "employee_name",
            "employee_code",
            "program_title",
            "session_start",
            "session_end",
            "trainer_name",
            "status",
            "score",
            "feedback",
            "decided_at",
            "completed_at",
            "certificate_issued_at",
            "has_certificate",
            "created_at",
        ]
        read_only_fields = fields

    def get_employee_name(self, obj):
        return _employee_name(obj.employee)

    def get_trainer_name(self, obj):
        trainer = obj.session.trainer
        return _employee_name(trainer) if trainer else None

    def get_has_certificate(self, obj):
        from documents.models import Document
        from documents.services import latest_document_for

        return latest_document_for(obj, kind=Document.Kind.CERTIFICATE) is not None


class CompleteEnrollmentSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[Enrollment.Status.COMPLETED, Enrollment.Status.NO_SHOW])
    score = serializers.IntegerField(min_value=0, max_value=100, required=False, allow_null=True)
    feedback = serializers.CharField(required=False, allow_blank=True, default="")
