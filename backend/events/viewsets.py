from django.db.models import Count
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from accounts.permissions import IsHRAdminOrReadOnly
from accounts.policy import Perm
from core.viewsets import AuditViewSetMixin
from events.models import Event, EventAttachment, EventStakeholder
from events.serializers import (
    EventAttachmentSerializer,
    EventListSerializer,
    EventSerializer,
    EventStakeholderSerializer,
)


class EventFilterSet(django_filters.FilterSet):
    """Past and upcoming as a filter, because that is how the page is read.

    Computed against `ends_at` where there is one, so a two-day inspection does
    not move to "past" on its first evening.
    """

    when = django_filters.CharFilter(method="filter_when")
    from_date = django_filters.DateFilter(field_name="starts_at", lookup_expr="date__gte")
    to_date = django_filters.DateFilter(field_name="starts_at", lookup_expr="date__lte")

    class Meta:
        model = Event
        fields = ["kind", "status", "company", "organiser"]

    def filter_when(self, queryset, name, value):
        now = timezone.now()
        if value == "upcoming":
            return queryset.filter(starts_at__gte=now).order_by("starts_at")
        if value == "past":
            return queryset.filter(starts_at__lt=now)
        return queryset


class EventViewSet(AuditViewSetMixin, ModelViewSet):
    """The company's events.

    Readable by anybody signed in — an event is a thing the company did, and
    the people who were at it are entitled to find it again. Writing needs
    `workplace.manage`, and creating or deleting additionally needs an admin
    role, which is the split every other module gets.
    """

    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    required_permission = Perm.WORKPLACE_MANAGE
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = EventFilterSet
    search_fields = ["title", "subject_matter", "description", "location", "outcome"]
    ordering_fields = ["starts_at", "title", "status"]
    # Named on the view: `OrderingFilter` leaves an annotated queryset
    # unordered when none is declared, and paging an unordered list is how one
    # row shows up on two pages. Newest first, because the page opens on what
    # just happened.
    ordering = ["-starts_at"]

    def get_queryset(self):
        return (
            Event.objects.select_related("organiser__user", "company")
            .prefetch_related("stakeholders__employee__user", "attachments")
            .annotate(
                stakeholder_count=Count("stakeholders", distinct=True),
                attachment_count=Count("attachments", distinct=True),
            )
        )

    def get_serializer_class(self):
        return EventListSerializer if self.action == "list" else EventSerializer

    @action(detail=False, methods=["get"])
    def timeline(self, request, *args, **kwargs):
        """Upcoming and past in one payload, each already in reading order.

        Two lists rather than one sorted run, because the page reads outward
        from now in both directions: the next thing is at the top of one column
        and the most recent thing at the top of the other. Sorting one list and
        splitting it in the browser would put the *furthest* future event
        first, which is the least interesting row on the page.
        """
        queryset = self.filter_queryset(self.get_queryset())
        now = timezone.now()
        upcoming = queryset.filter(starts_at__gte=now).order_by("starts_at")
        past = queryset.filter(starts_at__lt=now).order_by("-starts_at")
        limit = 50
        return Response({
            "upcoming": EventListSerializer(upcoming[:limit], many=True).data,
            "past": EventListSerializer(past[:limit], many=True).data,
            "upcoming_total": upcoming.count(),
            "past_total": past.count(),
        })

    # ── Stakeholders ─────────────────────────────────────────────────────

    @action(detail=True, methods=["get", "post"])
    def stakeholders(self, request, *args, **kwargs):
        event = self.get_object()
        if request.method == "GET":
            rows = event.stakeholders.select_related("employee__user")
            return Response(EventStakeholderSerializer(rows, many=True).data)

        serializer = EventStakeholderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(event=event)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"stakeholders/(?P<stakeholder_id>[0-9]+)",
    )
    def stakeholder_detail(self, request, stakeholder_id=None, *args, **kwargs):
        event = self.get_object()
        row = event.stakeholders.filter(pk=stakeholder_id).first()
        if row is None:
            return Response({"detail": "No such stakeholder."}, status=status.HTTP_404_NOT_FOUND)
        if request.method == "DELETE":
            row.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = EventStakeholderSerializer(row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    # ── Attachments ──────────────────────────────────────────────────────

    @action(
        detail=True,
        methods=["get", "post"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def attachments(self, request, *args, **kwargs):
        event = self.get_object()
        if request.method == "GET":
            return Response(
                EventAttachmentSerializer(event.attachments.all(), many=True).data
            )
        serializer = EventAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(
            event=event,
            uploaded_by=request.user,
            created_by=request.user,
            updated_by=request.user,
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["delete"],
        url_path=r"attachments/(?P<attachment_id>[0-9]+)",
    )
    def attachment_detail(self, request, attachment_id=None, *args, **kwargs):
        event = self.get_object()
        row = event.attachments.filter(pk=attachment_id).first()
        if row is None:
            return Response({"detail": "No such attachment."}, status=status.HTTP_404_NOT_FOUND)
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
