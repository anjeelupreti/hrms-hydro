from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import (
    CreateModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.counts import StatusCountsMixin
from core.viewsets import AuditViewSetMixin
from helpdesk.models import Ticket, TicketComment
from helpdesk.serializers import TicketSerializer


def _is_hr(user):
    """Thin adapter over the one policy (accounts/policy.py).

    Kept as a local name so every call site in this file reads the same
    as it did; what it *means* is now decided in one place rather than
    re-derived here.
    """
    return can(user, Perm.WORKPLACE_MANAGE)


class TicketViewSet(
    StatusCountsMixin,
    AuditViewSetMixin,
    ListModelMixin,
    RetrieveModelMixin,
    CreateModelMixin,
    GenericViewSet,
):
    serializer_class = TicketSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = [
        "status", "category", "priority", "assignee", "target_department",
    ]
    search_fields = ["subject", "description", "requester__user__first_name", "requester__user__last_name"]
    ordering_fields = ["created_at", "priority", "status"]
    ordering = ["created_at"]

    def get_queryset(self):
        qs = Ticket.objects.select_related(
            "requester__user", "assignee__user", "target_department"
        ).prefetch_related("watchers__user").prefetch_related(
            "comments__created_by"
        )
        if _is_hr(self.request.user):
            return qs
        me = _requesting_employee(self.request.user)
        if me is None:
            return qs.none()
        # A watcher was added precisely so they could follow it, so they see
        # it too. Without this the field would be decoration: somebody named on
        # a ticket, unable to open it.
        return qs.filter(Q(requester=me) | Q(assignee=me) | Q(watchers=me)).distinct()

    def create(self, request, *args, **kwargs):
        me = _requesting_employee(request.user)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket = serializer.save(requester=me, created_by=request.user, updated_by=request.user)
        return Response(self.get_serializer(ticket).data, status=status.HTTP_201_CREATED)

    def _is_participant(self, request, ticket):
        me = _requesting_employee(request.user)
        return _is_hr(request.user) or (me is not None and me.id in (ticket.requester_id, ticket.assignee_id))

    def partial_update(self, request, *args, **kwargs):
        ticket = self.get_object()
        is_hr = _is_hr(request.user)
        me = _requesting_employee(request.user)
        is_requester = me is not None and ticket.requester_id == me.id

        if is_hr:
            for field in ("category", "priority"):
                if field in request.data:
                    setattr(ticket, field, request.data[field])
            if "assignee" in request.data:
                ticket.assignee_id = request.data["assignee"] or None
            if "status" in request.data:
                ticket.status = request.data["status"]
        elif is_requester:
            # The requester may only close/reopen their own ticket.
            if set(request.data) - {"status"} or request.data.get("status") not in (
                Ticket.Status.CLOSED,
                Ticket.Status.OPEN,
            ):
                return Response({"detail": "You can only open/close your own ticket."}, status=403)
            ticket.status = request.data["status"]
        else:
            return Response(status=status.HTTP_403_FORBIDDEN)

        ticket.resolved_at = (
            timezone.now() if ticket.status == Ticket.Status.RESOLVED else None
        )
        ticket.updated_by = request.user
        ticket.save()
        return Response(self.get_serializer(ticket).data)

    @action(detail=False, methods=["get"], url_path="queue-summary")
    def queue_summary(self, request, *args, **kwargs):
        """The state of the queue, in the terms a queue is actually judged by.

        Not a scoreboard of statuses — the filter chips under it already say how
        many are open. What nobody can see from a list capped at a page is
        **how long the oldest unanswered request has been sitting there**, and
        **how many have nobody's name on them**. Those are the two failures of a
        help desk; the counts are just its inventory.

        Scoped through `get_queryset()`, so somebody who can only see their own
        tickets gets a reading of their own tickets rather than the company's.
        """
        queryset = self.get_queryset()
        unresolved = queryset.exclude(status__in=[Ticket.Status.RESOLVED, Ticket.Status.CLOSED])

        oldest = unresolved.order_by("created_at").values_list("created_at", flat=True).first()
        now = timezone.now()
        week_ago = now - timedelta(days=7)

        return Response(
            {
                "unresolved": unresolved.count(),
                "unassigned": unresolved.filter(assignee__isnull=True).count(),
                "urgent": unresolved.filter(
                    priority__in=[Ticket.Priority.HIGH, Ticket.Priority.URGENT]
                ).count(),
                # Whole days, floored: "waiting 3 days" is a claim you can check.
                "oldest_open_days": (now - oldest).days if oldest else None,
                "resolved_this_week": queryset.filter(resolved_at__gte=week_ago).count(),
            }
        )

    @action(detail=True, methods=["post"])
    def comment(self, request, *args, **kwargs):
        ticket = self.get_object()
        if not self._is_participant(request, ticket):
            return Response(status=status.HTTP_403_FORBIDDEN)
        body = (request.data.get("body") or "").strip()
        if not body:
            return Response({"detail": "Comment can't be empty."}, status=400)
        TicketComment.objects.create(
            ticket=ticket, body=body, created_by=request.user, updated_by=request.user
        )
        # Re-fetch: comments were prefetched before this create, so serializing
        # `ticket` directly would omit the just-added comment.
        fresh = self.get_queryset().get(pk=ticket.pk)
        return Response(self.get_serializer(fresh).data, status=status.HTTP_201_CREATED)
