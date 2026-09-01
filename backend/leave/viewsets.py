from datetime import date, timedelta

from django.db.models import Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.permissions import IsHRAdminOrReadOnly
from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.counts import StatusCountsMixin
from core.exports import XlsxExportMixin
from core.filters import IdsLookupMixin
from core.removal import SafeDestroyMixin
from core.viewsets import AuditViewSetMixin
from employees.scoping import scope_to_visible
from leave.models import ApprovalAction, ApprovalChain, LeaveBalance, LeaveRequest, LeaveType
from leave.serializers import (
    ApprovalActionSerializer,
    ApprovalChainSerializer,
    DecisionSerializer,
    LeaveBalanceSerializer,
    LeaveRequestCreateSerializer,
    LeaveRequestSerializer,
    LeaveTypeSerializer,
)
from leave.services import _current_step, can_act_on_step, decide, submit_leave_request


class LeaveTypeViewSet(IdsLookupMixin, SafeDestroyMixin, AuditViewSetMixin, ModelViewSet):
    # Leave requests point at a type with PROTECT, and balances cascade — so a
    # type with any history is deactivated, never deleted.
    removal_label = "leave type"
    queryset = LeaveType.objects.all()
    serializer_class = LeaveTypeSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "code"]


class ApprovalChainViewSet(AuditViewSetMixin, ModelViewSet):
    queryset = ApprovalChain.objects.prefetch_related("steps")
    serializer_class = ApprovalChainSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]


class LeaveBalanceViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    serializer_class = LeaveBalanceSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["employee", "leave_type", "year"]

    def get_queryset(self):
        qs = LeaveBalance.objects.select_related("employee", "leave_type")
        return scope_to_visible(qs, self.request.user)


class LeaveRequestViewSet(StatusCountsMixin, XlsxExportMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet):
    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated]
    # Server-paginated, so search has to run in the database rather than over
    # whichever page the client is currently showing.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = {
        "employee": ["exact"],
        "leave_type": ["exact"],
        "status": ["exact"],
        "start_date": ["exact", "gte", "lte"],
    }
    search_fields = [
        "employee__employee_code",
        "employee__user__first_name",
        "employee__user__last_name",
        "leave_type__name",
        "reason",
    ]

    export_filename = "leave-requests.xlsx"
    export_title = "Leave Requests"
    export_headers = ["Employee", "Type", "From", "To", "Days", "Paid", "Status"]
    export_highlight_header = "Status"
    export_validations = {
        "Status": ["Pending", "Approved", "Rejected", "Cancelled"],
        "Paid": ["Paid", "Unpaid"],
    }

    def get_export_rows(self, queryset):
        return [
            [
                r.employee.user.get_full_name() or r.employee.user.get_username(),
                r.leave_type.name,
                r.start_date.isoformat(),
                r.end_date.isoformat(),
                str(r.days_requested),
                "Paid" if r.is_paid else "Unpaid",
                r.get_status_display(),
            ]
            for r in queryset
        ]

    def get_queryset(self):
        qs = LeaveRequest.objects.select_related("employee__user", "employee__manager", "leave_type")
        return scope_to_visible(qs, self.request.user)

    @action(detail=False, methods=["get"], url_path="pending-my-action")
    def pending_my_action(self, request, *args, **kwargs):
        """Pending requests where the current step resolves to this user
        specifically — computed server-side since the approver-resolution
        logic (manager vs. any-HR-admin) isn't something the frontend can
        replicate correctly on its own."""
        candidates = self.get_queryset().filter(status=LeaveRequest.Status.PENDING)
        mine = [r for r in candidates if can_act_on_step(request.user, r, _current_step(r))]
        return Response(LeaveRequestSerializer(mine, many=True).data)

    def create(self, request, *args, **kwargs):
        serializer = LeaveRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        requester_employee = _requesting_employee(request.user)
        is_hr = can(request.user, Perm.LEAVE_APPROVE)

        employee = requester_employee
        requested_employee_id = request.data.get("employee")
        if is_hr and requested_employee_id:
            from employees.models import Employee

            employee = Employee.objects.filter(pk=requested_employee_id).first()
            if employee is None:
                return Response({"employee": "Not found."}, status=status.HTTP_400_BAD_REQUEST)
        if employee is None:
            return Response(
                {"detail": "Your account has no employee profile."}, status=status.HTTP_400_BAD_REQUEST
            )

        leave_request = submit_leave_request(
            employee=employee,
            leave_type=data["leave_type"],
            start_date=data["start_date"],
            end_date=data["end_date"],
            half_day=data["half_day"],
            reason=data["reason"],
        )
        return Response(
            LeaveRequestSerializer(leave_request).data, status=status.HTTP_201_CREATED
        )

    def _decide(self, request, decision):
        leave_request = self.get_object()
        if leave_request.status != LeaveRequest.Status.PENDING:
            return Response(
                {"detail": "This request has already been decided."}, status=status.HTTP_400_BAD_REQUEST
            )

        step = _current_step(leave_request)
        if step is None or not can_act_on_step(request.user, leave_request, step):
            return Response(
                {"detail": "You're not the approver for this request's current step."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = DecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        leave_request = decide(leave_request, request.user, decision, serializer.validated_data["comment"])
        return Response(LeaveRequestSerializer(leave_request).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, *args, **kwargs):
        return self._decide(request, ApprovalAction.Decision.APPROVED)

    @action(detail=True, methods=["post"])
    def reject(self, request, *args, **kwargs):
        return self._decide(request, ApprovalAction.Decision.REJECTED)

    @action(detail=True, methods=["post"])
    def cancel(self, request, *args, **kwargs):
        leave_request = self.get_object()
        employee = _requesting_employee(request.user)
        is_owner = employee is not None and leave_request.employee_id == employee.id
        is_hr = can(request.user, Perm.LEAVE_APPROVE)
        if not (is_owner or is_hr):
            return Response(status=status.HTTP_403_FORBIDDEN)
        if leave_request.status != LeaveRequest.Status.PENDING:
            return Response(
                {"detail": "Only pending requests can be cancelled."}, status=status.HTTP_400_BAD_REQUEST
            )
        leave_request.status = LeaveRequest.Status.CANCELLED
        leave_request.updated_by = request.user
        leave_request.save(update_fields=["status", "updated_by", "updated_at"])
        return Response(LeaveRequestSerializer(leave_request).data)

    @action(detail=False, methods=["get"], url_path="day-count")
    def day_count(self, request, *args, **kwargs):
        """What a date range would actually cost, before anybody commits to it.

        **Computed here rather than in the browser**, for the same reason the
        approver resolution above is. Weekends and public holidays are not
        charged, and which days those are comes from the company's working week
        and its holiday table. A second implementation in the frontend would be
        a second answer to the same question, and the two would drift the first
        time a company changed either — leaving somebody told they were spending
        four days while their balance dropped by two.
        """
        from leave.services import calculate_days

        start_raw = request.query_params.get("start")
        end_raw = request.query_params.get("end")
        if not start_raw or not end_raw:
            return Response(
                {"detail": "start and end query params (YYYY-MM-DD) are required."},
                status=400,
            )
        try:
            start = date.fromisoformat(start_raw)
            end = date.fromisoformat(end_raw)
        except ValueError:
            return Response({"detail": "Dates must be YYYY-MM-DD."}, status=400)
        if end < start:
            return Response({"detail": "The end date is before the start date."}, status=400)

        half_day = request.query_params.get("half_day") in ("1", "true", "True")
        days = calculate_days(start, end, half_day)
        return Response(
            {
                "days": str(days),
                # Stated so the form can explain a number that will otherwise
                # look like a miscount — "4 days off, 2 charged" is only
                # reassuring if it says which two were not.
                "calendar_days": (end - start).days + 1,
            }
        )

    @action(detail=True, methods=["get"])
    def actions(self, request, *args, **kwargs):
        leave_request = self.get_object()
        serializer = ApprovalActionSerializer(leave_request.actions.select_related("actor"), many=True)
        return Response(serializer.data)


    @action(detail=False, methods=["get"])
    def trend(self, request, *args, **kwargs):
        """Leave taken per month, by type, over the last twelve months.

        **The series the leave screen never had.** Every figure on that page was
        a count as of today — pending, approved, remaining — and none of them
        answer the question a manager plans around: *when* does this company
        take leave. Leave is seasonal here in a way that is not a guess (Dashain
        and Tihar move a large fraction of the year's days into two months), and
        a roster built without knowing that is a roster that breaks.

        **Approved only.** A pending request is a request, not a day off, and
        counting it would make the busiest months look busier still — which is
        exactly when somebody is deciding whether to approve one more.

        **Bucketed by the month the leave *starts*.** A request spanning a month
        boundary is rare and splitting it would cost a per-day expansion of
        every row; attributing it to its start is the approximation, and it is
        named here rather than left for somebody to discover.
        """
        today = timezone.localdate()
        # Twelve months back, from the first of that month.
        start = (today.replace(day=1) - timedelta(days=365)).replace(day=1)

        rows = (
            self.get_queryset()
            .filter(status=LeaveRequest.Status.APPROVED, start_date__gte=start)
            .annotate(month=TruncMonth("start_date"))
            .values("month", "leave_type__name")
            .annotate(days=Sum("days_requested"))
            .order_by("month")
        )

        # A month with no leave is a fact — it is the quiet month a planner is
        # looking for — so the buckets are built from the calendar, not from
        # whatever rows happened to exist.
        buckets: dict[str, dict] = {}
        cursor = start
        while cursor <= today:
            buckets[cursor.isoformat()] = {"month": cursor.isoformat(), "total": 0.0}
            cursor = (cursor + timedelta(days=32)).replace(day=1)

        types: set[str] = set()
        for row in rows:
            key = row["month"].date().isoformat() if hasattr(row["month"], "date") else row["month"].isoformat()
            bucket = buckets.setdefault(key, {"month": key, "total": 0.0})
            name = row["leave_type__name"] or "Other"
            days = float(row["days"] or 0)
            bucket[name] = bucket.get(name, 0.0) + days
            bucket["total"] += days
            types.add(name)

        return Response(
            {
                # Named so the chart does not have to discover its own series
                # by walking every bucket looking for keys.
                "types": sorted(types),
                "months": [buckets[k] for k in sorted(buckets)],
            }
        )
