"""The API over `employees.change_requests`.

Kept in its own module rather than appended to `employees/viewsets.py`, which is
already long enough that finding anything in it is a scroll. Same reasoning the
attendance policy uses in `attendance/policy_api.py`.
"""

from django.db.models import Case, IntegerField, Value, When
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.viewsets import AuditViewSetMixin
from employees import change_requests as service

#: The sensitive half of the allow-list, read from the registry rather than
#: restated. A second list here would drift the moment somebody adds a field.
SENSITIVE_FIELD_NAMES = [f.name for f in service.REQUESTABLE_FIELDS if f.sensitive]
from employees.models import Employee, EmployeeChangeRequest
from employees.serializers import EmployeeChangeRequestSerializer
from core.counts import StatusCountsMixin


class EmployeeChangeRequestViewSet(
    StatusCountsMixin, AuditViewSetMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet
):
    """Changes an employee has asked for, and HR's queue of them.

    **No writable serializer, and no `update` at all.** Every transition runs
    through the service, because the rules that matter — the field allow-list,
    and that a requester cannot approve their own request — have to hold for
    any caller. A writable serializer would be a second way in that skips them.
    """

    serializer_class = EmployeeChangeRequestSerializer
    permission_classes = [IsAuthenticated]
    # `SearchFilter` is named explicitly: DEFAULT_FILTER_BACKENDS is
    # DjangoFilterBackend alone, so `search_fields` alone would be inert.
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["status", "employee", "field"]
    search_fields = [
        "field",
        "employee__user__first_name",
        "employee__user__last_name",
        "employee__employee_code",
    ]
    # Sensitive first, then oldest — an account change must never sit below a
    # month-old address change just because the address was asked for first.
    #
    # Ordered here rather than in the browser because the browser can only sort
    # the page it holds. Sorting a page and calling it a priority queue puts the
    # most urgent request on page four with nothing to indicate it.
    ordering = ["-sensitivity", "created_at"]

    def get_queryset(self):
        queryset = EmployeeChangeRequest.objects.select_related(
            "employee__user", "created_by", "decided_by"
        ).annotate(
            # `is_sensitive` is derived in the serializer from the field
            # registry, so it is not a column and cannot be ordered on. The
            # registry stays the single source of truth; this projects it into
            # SQL so the ordering survives pagination.
            sensitivity=Case(
                When(field__in=SENSITIVE_FIELD_NAMES, then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            )
        ).order_by("-sensitivity", "created_at")

        # The "Decided" tab wants everything that is no longer waiting. It used
        # to drop pending rows in the browser, which was correct only while the
        # whole queue fitted in one response: paginated, a page that happens to
        # be all pending renders as an empty tab under a non-zero count.
        decided = self.request.query_params.get("decided")
        if decided in ("1", "true", "True"):
            queryset = queryset.exclude(status=EmployeeChangeRequest.Status.PENDING)
        if can(self.request.user, Perm.PEOPLE_MANAGE):
            return queryset
        # Everybody else sees their own and nothing else — an empty list rather
        # than a 403, because somebody else's request to change their bank
        # details is not information this person was refused, it is information
        # that is none of their business.
        employee = _requesting_employee(self.request.user)
        return queryset.filter(employee=employee) if employee else queryset.none()

    def _target_employee(self, request):
        """Yourself, or somebody else if you manage people.

        HR filing on an employee's behalf is deliberately allowed — people do
        ring up and read out a new account number — and it is still a request,
        so by the rule in `approve` whoever filed it cannot approve it.
        """
        employee = _requesting_employee(request.user)
        target_id = request.data.get("employee") or request.query_params.get("employee")
        if target_id and can(request.user, Perm.PEOPLE_MANAGE):
            return Employee.objects.filter(pk=target_id).first()
        return employee

    @action(detail=False, methods=["get"])
    def fields(self, request, *args, **kwargs):
        """What may be asked about, and what it says now.

        Served rather than hardcoded in the browser: the allow-list is a
        security rule, and a second copy in the client is a copy that can drift.
        """
        employee = self._target_employee(request)
        return Response(
            [
                {
                    "name": field.name,
                    "label": field.label,
                    "sensitive": field.sensitive,
                    "current": service.current_value(employee, field.name)
                    if employee
                    else "",
                    # The legal values, so the form can offer a picker over a
                    # constrained column rather than a text box.
                    #
                    # `None` for free-text fields, so the client can tell
                    # "choose one of these" from "type something" rather than
                    # guessing from an empty list.
                    "choices": service.choices_for(field.name),
                    # The other half of the same idea. A date typed into a free
                    # text box is rejected — correctly, and only after somebody
                    # has typed it. Saying so here lets the client offer the
                    # calendar it offers everywhere else, so the format is
                    # never something to get wrong.
                    "is_date": service.is_date_field(field.name),
                }
                for field in service.REQUESTABLE_FIELDS
            ]
        )

    def create(self, request, *args, **kwargs):
        employee = self._target_employee(request)
        if employee is None:
            return Response(
                {"detail": "Your account has no employee record."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            created = service.submit(
                employee,
                request.data.get("field", ""),
                request.data.get("new_value", ""),
                actor=request.user,
                reason=request.data.get("reason", "") or "",
            )
        except service.ChangeRequestError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(created).data, status=status.HTTP_201_CREATED)

    def _decide(self, request, decider):
        if not can(request.user, Perm.PEOPLE_MANAGE):
            return Response(status=status.HTTP_403_FORBIDDEN)
        try:
            row = decider(
                self.get_object(), request.user, request.data.get("note", "") or ""
            )
        except service.ChangeRequestError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(row).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, *args, **kwargs):
        return self._decide(request, service.approve)

    @action(detail=True, methods=["post"])
    def reject(self, request, *args, **kwargs):
        return self._decide(request, service.reject)

    @action(detail=True, methods=["post"])
    def withdraw(self, request, *args, **kwargs):
        """Take back your own request — §R2, and only your own."""
        row = self.get_object()
        if row.created_by_id != request.user.id and not can(request.user, Perm.PEOPLE_ADMIN):
            return Response(status=status.HTTP_403_FORBIDDEN)
        try:
            row = service.withdraw(row, request.user)
        except service.ChangeRequestError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(row).data)
