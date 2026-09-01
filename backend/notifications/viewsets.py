from django.conf import settings
from django.db import models
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin, UpdateModelMixin
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.permissions import IsHRAdminOrReadOnly
from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.viewsets import AuditViewSetMixin
from employees.models import Employee
from notifications import services
from notifications.models import (
    Announcement,
    CompanyEvent,
    Holiday,
    MeetingAttendee,
    Notification,
    NotificationPreference,
    PushSubscription,
    ReminderRule,
)
from notifications.serializers import (
    AnnouncementSerializer,
    CompanyEventSerializer,
    HolidaySerializer,
    MeetingCreateSerializer,
    NotificationPreferenceSerializer,
    NotificationSerializer,
    PushSubscriptionSerializer,
    ReminderRuleSerializer,
)
from core.archiving import ArchiveMixin


class NotificationViewSet(ListModelMixin, GenericViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, *args, **kwargs):
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=["is_read"])
        return Response(NotificationSerializer(notification).data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request, *args, **kwargs):
        self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response(status=204)

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request, *args, **kwargs):
        count = self.get_queryset().filter(is_read=False).count()
        return Response({"count": count})

    @action(detail=False, methods=["get", "patch"], url_path="preferences")
    def preferences(self, request, *args, **kwargs):
        prefs, _ = NotificationPreference.objects.get_or_create(user=request.user)
        if request.method == "PATCH":
            serializer = NotificationPreferenceSerializer(prefs, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)
        return Response(NotificationPreferenceSerializer(prefs).data)

    @action(detail=False, methods=["get"], url_path="vapid-public-key")
    def vapid_public_key(self, request, *args, **kwargs):
        return Response({"key": settings.VAPID_PUBLIC_KEY})

    @action(detail=False, methods=["post"], url_path="push-subscribe")
    def push_subscribe(self, request, *args, **kwargs):
        serializer = PushSubscriptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        PushSubscription.objects.update_or_create(
            user=request.user,
            endpoint=data["endpoint"],
            defaults={"p256dh": data["keys"]["p256dh"], "auth": data["keys"]["auth"]},
        )
        NotificationPreference.objects.update_or_create(
            user=request.user, defaults={"push_enabled": True}
        )
        return Response(status=201)

    @action(detail=False, methods=["post"], url_path="push-unsubscribe")
    def push_unsubscribe(self, request, *args, **kwargs):
        endpoint = request.data.get("endpoint")
        if endpoint:
            PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        if not PushSubscription.objects.filter(user=request.user).exists():
            NotificationPreference.objects.update_or_create(
                user=request.user, defaults={"push_enabled": False}
            )
        return Response(status=204)


class HolidayViewSet(AuditViewSetMixin, ModelViewSet):
    queryset = Holiday.objects.all()
    serializer_class = HolidaySerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]


class CompanyEventViewSet(AuditViewSetMixin, ModelViewSet):
    serializer_class = CompanyEventSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]

    def get_queryset(self):
        qs = CompanyEvent.objects.prefetch_related("attendees__employee__user")
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start:
            qs = qs.filter(end_datetime__gte=start)
        if end:
            qs = qs.filter(start_datetime__lte=end)
        return qs


class MeetingViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """Meetings are CompanyEvent rows (event_type=MEETING) plus attendees
    — a distinct viewset (not just CompanyEventViewSet with a filter)
    because scheduling a meeting is a normal everyone-action, unlike most
    calendar events which are HR-managed. See docs/development-plan.md."""

    serializer_class = CompanyEventSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = CompanyEvent.objects.filter(event_type=CompanyEvent.EventType.MEETING).prefetch_related(
            "attendees__employee__user"
        )
        user = self.request.user
        if can(user, Perm.WORKPLACE_MANAGE):
            return qs
        employee = _requesting_employee(user)
        if employee is None:
            return qs.none()
        return qs.filter(attendees__employee=employee).distinct()

    def create(self, request, *args, **kwargs):
        serializer = MeetingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        event = CompanyEvent.objects.create(
            title=data["title"],
            description=data["description"],
            event_type=CompanyEvent.EventType.MEETING,
            start_datetime=data["start_datetime"],
            end_datetime=data["end_datetime"],
            location=data["location"],
            created_by=request.user,
            updated_by=request.user,
        )
        attendees = Employee.objects.filter(pk__in=data["attendee_ids"])
        services.invite_attendees(event, attendees, actor=request.user)
        return Response(CompanyEventSerializer(event).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="rsvp")
    def rsvp(self, request, *args, **kwargs):
        event = self.get_object()
        employee = _requesting_employee(request.user)
        if employee is None:
            return Response(status=status.HTTP_403_FORBIDDEN)
        attendee = MeetingAttendee.objects.filter(event=event, employee=employee).first()
        if attendee is None:
            return Response({"detail": "You're not invited to this meeting."}, status=status.HTTP_403_FORBIDDEN)
        new_status = request.data.get("rsvp_status")
        if new_status not in MeetingAttendee.RsvpStatus.values:
            return Response({"detail": "Invalid rsvp_status."}, status=status.HTTP_400_BAD_REQUEST)
        services.respond_to_invite(attendee, new_status, actor=request.user)
        # self.get_object() prefetched `attendees` onto this `event`
        # instance; re-serializing it directly would return that cached
        # (now-stale) prefetch rather than the row just updated above —
        # re-fetch fresh so the response reflects the real DB state.
        event = self.get_queryset().get(pk=event.pk)
        return Response(CompanyEventSerializer(event).data)


class AnnouncementViewSet(ArchiveMixin, AuditViewSetMixin, ModelViewSet):
    """Read-open (every employee should see active announcements),
    write-restricted to HR/managers — a broadcast, not a personal note."""

    serializer_class = AnnouncementSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]

    def get_queryset(self):
        qs = Announcement.objects.select_related("department")
        if self.request.query_params.get("active") == "true":
            now = timezone.now()
            qs = qs.filter(models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=now))
        return qs

    def perform_create(self, serializer):
        announcement = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        services.publish_announcement(announcement)


class ReminderRuleViewSet(
    AuditViewSetMixin,
    ListModelMixin,
    RetrieveModelMixin,
    UpdateModelMixin,
    GenericViewSet,
):
    """The company's own reminder rules — readable by all, editable by HR.

    **No create and no delete.** The set of rules is the set of registry kinds,
    seeded once; a rule somebody deleted would silently come back the next time
    the seed command ran, and a rule somebody created could name a kind that
    does not exist. Turning one off is `is_enabled`, which is the thing anybody
    actually wants.

    Readable by everyone because a reminder rule describes what the company will
    send *you* — being unable to see why an email arrived is its own small
    frustration.
    """

    serializer_class = ReminderRuleSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]

    def get_queryset(self):
        return ReminderRule.objects.all()

    @action(detail=False, methods=["get"])
    def preview(self, request, *args, **kwargs):
        """What would go out today, rendered against real data, sending nothing.

        Exists because the alternative is finding out by switching a rule on and
        waiting until tomorrow — and the first thing anybody wants to know about
        a message template is whether it reads properly with a real name in it.
        """
        from notifications.reminders import run_reminders

        result = run_reminders(dry_run=True)
        return Response(result["previews"])
