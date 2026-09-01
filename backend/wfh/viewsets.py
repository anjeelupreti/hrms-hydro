from django.db.models import Q
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, mixins, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.counts import StatusCountsMixin
from core.exports import XlsxExportMixin
from employees.models import Employee
from wfh import services
from wfh.models import WFHRequest
from wfh.serializers import WFHCreateSerializer, WFHRequestSerializer


def _is_hr(user):
    """Thin adapter over the one policy (accounts/policy.py).

    Kept as a local name so every call site in this file reads the same
    as it did; what it *means* is now decided in one place rather than
    re-derived here.
    """
    return can(user, Perm.WORKPLACE_MANAGE)


class WFHRequestViewSet(StatusCountsMixin, 
    XlsxExportMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, GenericViewSet
):
    serializer_class = WFHRequestSerializer
    permission_classes = [IsAuthenticated]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by where somebody worked from, why, or who asked.
    search_fields = ["reason", "location_note", "employee__user__first_name", "employee__user__last_name", "employee__employee_code"]
    filterset_fields = {
        "status": ["exact"],
        "employee": ["exact"],
        "start_date": ["exact", "gte", "lte"],
    }

    export_filename = "wfh-requests.xlsx"
    export_title = "WFH Requests"
    export_headers = ["Employee", "Department", "From", "To", "Days", "Location", "Reason", "Status"]
    export_highlight_header = "Status"
    export_validations = {"Status": ["Pending", "Approved", "Rejected", "Cancelled"]}

    def get_export_rows(self, queryset):
        return [
            [
                r.employee.user.get_full_name() or r.employee.user.get_username(),
                r.employee.department.name if r.employee.department else "",
                r.start_date.isoformat(),
                r.end_date.isoformat(),
                r.days,
                r.location_note or r.get_work_location_display(),
                r.reason,
                r.get_status_display(),
            ]
            for r in queryset
        ]

    def get_queryset(self):
        qs = WFHRequest.objects.select_related(
            "employee__user", "employee__department", "decided_by"
        )
        user = self.request.user
        if _is_hr(user):
            return qs
        employee = _requesting_employee(user)
        # Own requests + direct reports' (for managers).
        return qs.filter(Q(employee=employee) | Q(employee__manager=employee)) if employee else qs.none()

    def create(self, request, *args, **kwargs):
        employee = getattr(request.user, "employee", None)
        if employee is None:
            return Response(
                {"detail": "Your account has no employee profile."}, status=status.HTTP_400_BAD_REQUEST
            )
        write = WFHCreateSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        wfh = services.request_wfh(employee, actor=request.user, **write.validated_data)
        return Response(WFHRequestSerializer(wfh).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def approve(self, request, **kwargs):
        wfh = self.get_object()
        if not services.can_decide(request.user, wfh):
            return Response(status=status.HTTP_403_FORBIDDEN)
        services.decide(wfh, approve=True, actor=request.user)
        return Response(WFHRequestSerializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, **kwargs):
        wfh = self.get_object()
        if not services.can_decide(request.user, wfh):
            return Response(status=status.HTTP_403_FORBIDDEN)
        services.decide(wfh, approve=False, actor=request.user)
        return Response(WFHRequestSerializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, **kwargs):
        wfh = self.get_object()
        is_owner = wfh.employee.user_id == request.user.id
        if not (is_owner or _is_hr(request.user)):
            return Response(status=status.HTTP_403_FORBIDDEN)
        services.cancel(wfh, actor=request.user)
        return Response(WFHRequestSerializer(self.get_object()).data)

    @action(detail=False, methods=["get"])
    def summary(self, request, **kwargs):
        today = timezone.localdate()
        scoped = self.get_queryset()
        remote_today = scoped.filter(
            status=WFHRequest.Status.APPROVED, start_date__lte=today, end_date__gte=today
        )
        active_total = Employee.objects.filter(
            employment_status=Employee.EmploymentStatus.ACTIVE
        ).count()
        remote_count = remote_today.count()
        return Response(
            {
                "remote_today": WFHRequestSerializer(remote_today, many=True).data,
                "remote_count": remote_count,
                "onsite_count": max(0, active_total - remote_count),
                "pending_count": scoped.filter(status=WFHRequest.Status.PENDING).count(),
                "remote_percent": round((remote_count / active_total) * 100) if active_total else 0,
            }
        )
