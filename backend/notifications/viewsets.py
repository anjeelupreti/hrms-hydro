from django.conf import settings
from django.db import models
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin, UpdateModelMixin
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.permissions import IsHRAdminOrReadOnly
from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.viewsets import AuditViewSetMixin
from employees.models import Employee
from notifications import services
from notifications.models import (
    DecisionPosition,
    MeetingMinutes,
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
    AgendaItemSerializer,
    MeetingDecisionSerializer,
    MeetingMinutesSerializer,
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


class MeetingViewSet(ListModelMixin, RetrieveModelMixin, UpdateModelMixin, GenericViewSet):
    """Meetings are CompanyEvent rows (event_type=MEETING) plus attendees
    — a distinct viewset (not just CompanyEventViewSet with a filter)
    because scheduling a meeting is a normal everyone-action, unlike most
    calendar events which are HR-managed. See docs/development-plan.md."""

    serializer_class = CompanyEventSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = CompanyEvent.objects.filter(
            event_type=CompanyEvent.EventType.MEETING
        ).prefetch_related(
            "attendees__employee__user",
            "agenda_items__presenter__user",
            "decisions__positions__employee__user",
            "decisions__positions__signature",
        ).select_related("minutes")
        user = self.request.user
        if can(user, Perm.WORKPLACE_MANAGE):
            return qs
        employee = _requesting_employee(user)
        if employee is None:
            return qs.none()
        return qs.filter(attendees__employee=employee).distinct()

    def create(self, request, *args, **kwargs):
        serializer = MeetingCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        event = CompanyEvent.objects.create(
            title=data["title"],
            description=data["description"],
            event_type=CompanyEvent.EventType.MEETING,
            start_datetime=data["start_datetime"],
            end_datetime=data["end_datetime"],
            location=data["location"],
            company_id=data.get("company"),
            created_by=request.user,
            updated_by=request.user,
        )
        attendees = Employee.objects.filter(pk__in=data["attendee_ids"])
        services.invite_attendees(event, attendees, actor=request.user)
        return Response(CompanyEventSerializer(event).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        """Correct a meeting after it has happened.

        **This is why there is no "planned" and "actual" duration.** A meeting
        that was called for an hour and ran for two is one meeting whose end
        time was wrong; recording a second duration beside the first leaves two
        numbers and no rule for which one a minute should print. The times
        themselves are editable, and everything derived from them — the
        duration on the sheet included — follows.

        The company can be moved too, and only among the editor's own. A minute
        that has already been numbered keeps the company it was numbered in;
        see `MeetingMinutes.company`.
        """
        meeting = self.get_object()
        if not self._may_run(meeting):
            return Response(status=status.HTTP_403_FORBIDDEN)

        if "company" in request.data:
            check = MeetingCreateSerializer(context={"request": request})
            try:
                check.validate_company(request.data.get("company"))
            except ValidationError as error:
                return Response({"company": error.detail}, status=status.HTTP_400_BAD_REQUEST)

        serializer = CompanyEventSerializer(meeting, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        meeting = self.get_queryset().get(pk=meeting.pk)
        return Response(CompanyEventSerializer(meeting, context={"request": request}).data)

    def _may_run(self, meeting):
        """Whoever called the meeting, or anybody who manages the workplace.

        The organiser is `created_by` — `MeetingAttendee`'s docstring has said
        so since it was written, and there is still no separate field for it.
        """
        user = self.request.user
        return meeting.created_by_id == user.id or can(user, Perm.WORKPLACE_MANAGE)

    # ── The agenda ───────────────────────────────────────────────────────

    @action(detail=True, methods=["get", "post"], url_path="agenda")
    def agenda(self, request, *args, **kwargs):
        """Read it, or add to it — **at any point, not only when the meeting is
        called.** Half an agenda is known a week beforehand and the rest
        arrives in the room."""
        meeting = self.get_object()
        if request.method == "GET":
            return Response(
                AgendaItemSerializer(meeting.agenda_items.all(), many=True).data
            )
        if not self._may_run(meeting):
            return Response(status=status.HTTP_403_FORBIDDEN)

        serializer = AgendaItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Appended, and numbered densely from whatever is there — the order is
        # a plain index and stays one.
        last = meeting.agenda_items.aggregate(models.Max("order"))["order__max"]
        serializer.save(
            meeting=meeting,
            order=0 if last is None else last + 1,
            created_by=request.user,
            updated_by=request.user,
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"agenda/(?P<item_id>[0-9]+)",
    )
    def agenda_item(self, request, item_id=None, *args, **kwargs):
        """Edit or remove one item. Removing is real: an agenda item nobody
        discussed should not sit in the minute pretending it was."""
        meeting = self.get_object()
        if not self._may_run(meeting):
            return Response(status=status.HTTP_403_FORBIDDEN)
        item = meeting.agenda_items.filter(pk=item_id).first()
        if item is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if request.method == "DELETE":
            item.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = AgendaItemSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)

    # ── The register ─────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="attendance")
    def attendance(self, request, *args, **kwargs):
        """Mark who came.

        **Re-markable at any time.** The register is routinely taken from
        memory the following morning, and a system that only allowed it in the
        minutes after the meeting ended would be one nobody ever used.

        Takes `{"present": [employee_id, ...], "absent": [...]}`. Anybody not
        named is left as they were, so marking one late arrival does not blank
        everybody else.
        """
        meeting = self.get_object()
        if not self._may_run(meeting):
            return Response(status=status.HTTP_403_FORBIDDEN)

        present = set(request.data.get("present", []) or [])
        absent = set(request.data.get("absent", []) or [])
        overlap = present & absent
        if overlap:
            return Response(
                {"detail": "Somebody cannot be both present and absent."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        for rows, value in (
            (present, MeetingAttendee.Attendance.PRESENT),
            (absent, MeetingAttendee.Attendance.ABSENT),
        ):
            if rows:
                MeetingAttendee.objects.filter(event=meeting, employee_id__in=rows).update(
                    attendance=value, attendance_marked_at=now, updated_by=request.user
                )

        meeting = self.get_queryset().get(pk=meeting.pk)
        return Response(CompanyEventSerializer(meeting, context={"request": request}).data)

    # ── Decisions, and consenting to them ────────────────────────────────

    @action(detail=True, methods=["get", "post"], url_path="decisions")
    def decisions(self, request, *args, **kwargs):
        """The decisions taken. Written after the meeting; the agenda and the
        register are what they are written from."""
        meeting = self.get_object()
        if request.method == "GET":
            return Response(
                MeetingDecisionSerializer(
                    meeting.decisions.all(), many=True, context={"request": request}
                ).data
            )
        if not self._may_run(meeting):
            return Response(status=status.HTTP_403_FORBIDDEN)

        serializer = MeetingDecisionSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        last = meeting.decisions.aggregate(models.Max("order"))["order__max"]
        serializer.save(
            meeting=meeting,
            order=0 if last is None else last + 1,
            created_by=request.user,
            updated_by=request.user,
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["post"],
        url_path=r"decisions/(?P<decision_id>[0-9]+)/circulate",
    )
    def circulate_decision(self, request, decision_id=None, *args, **kwargs):
        """Ask people to consent or dissent.

        **Everybody invited, not only those who came.** Somebody who was absent
        still has a view on a decision taken in their name, and recording that
        they were asked and did not answer is worth more than not asking. Each
        is notified in the product and by email.
        """
        meeting = self.get_object()
        if not self._may_run(meeting):
            return Response(status=status.HTTP_403_FORBIDDEN)
        decision = meeting.decisions.filter(pk=decision_id).first()
        if decision is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        services.circulate_decision(decision, actor=request.user)
        meeting = self.get_queryset().get(pk=meeting.pk)
        return Response(
            MeetingDecisionSerializer(
                meeting.decisions.get(pk=decision.pk), context={"request": request}
            ).data
        )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"decisions/(?P<decision_id>[0-9]+)/respond",
    )
    def respond_to_decision(self, request, decision_id=None, *args, **kwargs):
        """Consent, dissent or abstain — your own position and nobody else's.

        **Consent stamps your approved signature; dissent requires a reason.**
        Those are not symmetrical: agreeing is signing your name to something,
        and a dissent that does not say why tells a reader nothing.
        """
        meeting = self.get_object()
        decision = meeting.decisions.filter(pk=decision_id).first()
        if decision is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        me = _requesting_employee(request.user)
        row = DecisionPosition.objects.filter(decision=decision, employee=me).first()
        if row is None:
            return Response(
                {"detail": "You were not asked to respond to this decision."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            services.record_position(
                row,
                position=request.data.get("position"),
                reason=request.data.get("reason", ""),
                actor=request.user,
            )
        except ValueError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)

        meeting = self.get_queryset().get(pk=meeting.pk)
        return Response(
            MeetingDecisionSerializer(
                meeting.decisions.get(pk=decision.pk), context={"request": request}
            ).data
        )

    # ── The minute ───────────────────────────────────────────────────────

    @action(detail=True, methods=["get", "post", "patch"], url_path="minutes")
    def minutes(self, request, *args, **kwargs):
        """Read, draft or edit the minute.

        **POST drafts it from the template**, which is why decisions come
        first: the agenda and the decision register are what a minute is
        written *from*. A minute drafted before them is a summary of what
        somebody remembers.

        POSTing again on an existing minute does not overwrite it — that would
        throw away the writing — it returns what is there.
        """
        meeting = self.get_object()
        existing = getattr(meeting, "minutes", None)

        if request.method == "GET":
            if existing is None:
                return Response({"detail": "No minute yet."}, status=status.HTTP_404_NOT_FOUND)
            return Response(MeetingMinutesSerializer(existing, context={"request": request}).data)

        if not self._may_run(meeting):
            return Response(status=status.HTTP_403_FORBIDDEN)

        if request.method == "POST":
            if existing is not None:
                return Response(
                    MeetingMinutesSerializer(existing, context={"request": request}).data
                )
            template = services.default_minutes_template()
            minute = MeetingMinutes.objects.create(
                meeting=meeting,
                template=template,
                content=services.build_minutes_body(meeting, template),
                created_by=request.user,
                updated_by=request.user,
            )
            services.mint_minute_id(minute)
            return Response(
                MeetingMinutesSerializer(minute, context={"request": request}).data,
                status=status.HTTP_201_CREATED,
            )

        if existing is None:
            return Response({"detail": "No minute yet."}, status=status.HTTP_404_NOT_FOUND)
        if existing.is_locked:
            return Response(
                {"detail": "This minute is final. It is a record now and cannot be changed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = MeetingMinutesSerializer(
            existing, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="minutes/finalise")
    def finalise_minutes(self, request, *args, **kwargs):
        """Fix the minute. After this it is evidence and cannot be edited."""
        meeting = self.get_object()
        if not self._may_run(meeting):
            return Response(status=status.HTTP_403_FORBIDDEN)
        minute = getattr(meeting, "minutes", None)
        if minute is None:
            return Response({"detail": "No minute yet."}, status=status.HTTP_404_NOT_FOUND)
        if minute.is_locked:
            return Response({"detail": "Already final."}, status=status.HTTP_400_BAD_REQUEST)

        minute.status = MeetingMinutes.Status.FINAL
        minute.finalised_at = timezone.now()
        minute.updated_by = request.user
        minute.save(update_fields=["status", "finalised_at", "updated_by", "updated_at"])

        for attendee in meeting.attendees.select_related("employee__user"):
            services.notify(
                attendee.employee.user,
                "minutes_final",
                f'The minute of "{meeting.title}" has been finalised.',
                email_subject="Meeting minute finalised",
            )
        return Response(MeetingMinutesSerializer(minute, context={"request": request}).data)

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
