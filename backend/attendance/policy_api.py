"""The attendance policy, as an API.

The model, the per-employee override and the enforcement all landed together;
what was missing was any way to *set* it without a database console. A setting
nobody can reach is a setting that does not exist — the company who bought
readers so people cannot clock each other in still had web check-in on.

Kept as a singleton view rather than a viewset, the same shape as
`CompanyProfileView`: there is one policy per company and "list the policies" is
not a question anybody has.
"""

from rest_framework import serializers
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from accounts.permissions import IsHRAdmin
from accounts.policy import Perm
from attendance.policy import AttendancePolicy, EmployeeAttendanceMethod


class AttendancePolicySerializer(serializers.ModelSerializer):
    permitted_sources = serializers.SerializerMethodField()

    class Meta:
        model = AttendancePolicy
        fields = [
            "id", "allow_web", "allow_biometric", "permitted_sources",
            # D‑05. Ships off; a company decides whether lateness costs money
            # and how much, because a default would dock pay under a rule
            # nobody agreed to.
            "lateness_deduction_enabled", "late_days_per_deduction",
        ]

    def get_permitted_sources(self, obj):
        """What the settings screen shows back, so the effect of the toggles is
        legible without the reader knowing the source names."""
        return list(obj.permitted_sources())


class EmployeeAttendanceMethodSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeAttendanceMethod
        fields = ["id", "employee", "employee_name", "allow_web", "allow_biometric", "note"]

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.employee_code


class AttendancePolicyView(RetrieveUpdateAPIView):
    """One policy per company, created on first read.

    Created rather than 404'd because "not configured" and "everything
    permitted" are the same state here — `attendance.policy.allows` treats a
    missing row as permissive — so materialising it on first view is the
    honest thing to show somebody who has come to change it.
    """

    serializer_class = AttendancePolicySerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    #: Read by the permission class — the capability this surface gates on.
    required_permission = Perm.ATTENDANCE_MANAGE

    def get_object(self):
        return AttendancePolicy.get_solo()


class EmployeeAttendanceMethodViewSet(ModelViewSet):
    """Exceptions to the company rule — the factory floor and the field team.

    A full CRUD surface rather than a field on the employee form, because these
    are exceptions and should read as exceptions: a short list somebody can
    scan, not a setting buried on two hundred profiles.
    """

    serializer_class = EmployeeAttendanceMethodSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    required_permission = Perm.ATTENDANCE_MANAGE

    def get_queryset(self):
        return EmployeeAttendanceMethod.objects.select_related("employee__user")
