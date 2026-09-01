from django.db.models import Q
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import (
    CreateModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
    UpdateModelMixin,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from checklists.models import Checklist, ChecklistTask, ChecklistTemplate
from checklists.serializers import (
    ChecklistSerializer,
    ChecklistTaskSerializer,
    ChecklistTemplateSerializer,
    MyChecklistTaskSerializer,
)
from core.viewsets import AuditViewSetMixin
from core.archiving import ArchiveMixin


def _is_hr(user):
    """Thin adapter over the one policy (accounts/policy.py).

    Kept as a local name so every call site in this file reads the same
    as it did; what it *means* is now decided in one place rather than
    re-derived here.
    """
    return can(user, Perm.WORKPLACE_MANAGE)


class ChecklistTemplateViewSet(AuditViewSetMixin, ModelViewSet):
    """HR-managed onboarding/offboarding templates (writable nested items).
    Readable by any authenticated user; writes are HR-only."""

    serializer_class = ChecklistTemplateSerializer
    permission_classes = [IsAuthenticated]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by what the template is for.
    search_fields = ["name", "description"]
    filterset_fields = ["kind", "is_active"]

    def get_queryset(self):
        return ChecklistTemplate.objects.prefetch_related("items")

    def _deny_if_not_hr(self, request):
        if not _is_hr(request.user):
            return Response({"detail": "HR only."}, status=status.HTTP_403_FORBIDDEN)
        return None

    def create(self, request, *args, **kwargs):
        return self._deny_if_not_hr(request) or super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        return self._deny_if_not_hr(request) or super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        return self._deny_if_not_hr(request) or super().destroy(request, *args, **kwargs)


class ChecklistViewSet(
    ArchiveMixin, AuditViewSetMixin, ListModelMixin, RetrieveModelMixin, CreateModelMixin, GenericViewSet
):
    serializer_class = ChecklistSerializer
    permission_classes = [IsAuthenticated]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by whose checklist it is.
    search_fields = ["title", "employee__user__first_name", "employee__user__last_name", "employee__employee_code"]
    filterset_fields = ["kind", "status", "employee"]

    def get_queryset(self):
        qs = Checklist.objects.select_related("employee__user").prefetch_related("tasks__assignee__user")
        if _is_hr(self.request.user):
            return qs
        me = _requesting_employee(self.request.user)
        if me is None:
            return qs.none()
        # A non-HR user sees checklists that are about them or that have a
        # task assigned to them.
        return qs.filter(Q(employee=me) | Q(tasks__assignee=me)).distinct()

    def create(self, request, *args, **kwargs):
        if not _is_hr(request.user):
            return Response({"detail": "HR only."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def cancel(self, request, *args, **kwargs):
        if not _is_hr(request.user):
            return Response({"detail": "HR only."}, status=status.HTTP_403_FORBIDDEN)
        checklist = self.get_object()
        checklist.status = Checklist.Status.CANCELLED
        checklist.save(update_fields=["status"])
        return Response(self.get_serializer(checklist).data)


class ChecklistTaskViewSet(AuditViewSetMixin, UpdateModelMixin, GenericViewSet):
    """Update individual tasks (mark done/reopen, reassign, set due date) and
    the signed-in user's own task queue. HR edits anything; a non-HR user may
    only toggle the status of a task assigned to them."""

    serializer_class = ChecklistTaskSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = ChecklistTask.objects.select_related("checklist", "assignee__user")
        if _is_hr(self.request.user):
            return qs
        me = _requesting_employee(self.request.user)
        if me is None:
            return qs.none()
        return qs.filter(Q(assignee=me) | Q(checklist__employee=me)).distinct()

    def partial_update(self, request, *args, **kwargs):
        task = self.get_object()
        is_hr = _is_hr(request.user)
        me = _requesting_employee(request.user)
        is_assignee = me is not None and task.assignee_id == me.id

        if not is_hr:
            # Non-HR: only the assignee, and only the status field.
            if not is_assignee or set(request.data) - {"status"}:
                return Response({"detail": "You can only update the status of your own task."}, status=403)

        new_status = request.data.get("status")
        if new_status in (ChecklistTask.Status.DONE, ChecklistTask.Status.PENDING):
            task.mark(new_status == ChecklistTask.Status.DONE)

        # HR may also reassign / set due date.
        if is_hr:
            if "assignee" in request.data:
                task.assignee_id = request.data.get("assignee") or None
            if "due_date" in request.data:
                task.due_date = request.data.get("due_date") or None
            task.save(update_fields=["assignee", "due_date"])

        task.checklist.refresh_status()
        return Response(self.get_serializer(task).data)

    @action(detail=False, methods=["get"])
    def mine(self, request, *args, **kwargs):
        me = _requesting_employee(request.user)
        qs = (
            ChecklistTask.objects.none()
            if me is None
            else ChecklistTask.objects.filter(
                assignee=me, checklist__status=Checklist.Status.ACTIVE
            ).select_related("checklist__employee__user")
        )
        return Response(MyChecklistTaskSerializer(qs, many=True).data)
