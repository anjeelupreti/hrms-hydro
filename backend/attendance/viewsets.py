from datetime import timedelta

from django.db.models import Count
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.mixins import (
    CreateModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
    UpdateModelMixin,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.permissions import IsHRAdminOrReadOnly
from accounts.policy import Perm, can
from attendance.models import (
    AttendanceDeviceEvent,
    AttendanceEditLog,
    AttendanceLog,
    Device,
    RegularisationRequest,
    Shift,
    ShiftAssignment,
)
from attendance.permissions import AttendanceLogPermission, _requesting_employee
from attendance.policy import AttendanceSourceError
from attendance.punches import (
    PunchError,
    close_session,
    day_history,
    day_summary,
    open_session,
    record_presence,
)
from attendance.regularisation import (
    RegularisationError,
    approve_regularisation,
    reject_regularisation,
)
from attendance.serializers import (
    AttendanceDeviceEventSerializer,
    AttendanceEditLogSerializer,
    AttendanceLogSerializer,
    DaySummarySerializer,
    DeviceSerializer,
    RegularisationRequestSerializer,
    ShiftAssignmentSerializer,
    ShiftSerializer,
)
from core.counts import StatusCountsMixin
from core.exports import XlsxExportMixin
from core.filters import IdsLookupMixin
from core.viewsets import AuditViewSetMixin
from employees.scoping import scope_to_visible
from organization.models import CompanyProfile


def _parse_date(raw):
    """`YYYY-MM-DD` or nothing. Raises `ValueError` for anything else.

    A bad date is refused rather than silently falling back to a default —
    a range quietly different from the one asked for is worse than an error,
    because the numbers still look plausible.
    """
    from datetime import date as date_cls

    return date_cls.fromisoformat(raw) if raw else None

ATTENDANCE_TRACKED_FIELDS = ["check_in_time", "check_out_time", "status"]


class ShiftViewSet(IdsLookupMixin, AuditViewSetMixin, ModelViewSet):
    queryset = Shift.objects.all()
    serializer_class = ShiftSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    filter_backends = [filters.SearchFilter]
    search_fields = ["name"]


class ShiftAssignmentViewSet(AuditViewSetMixin, ModelViewSet):
    serializer_class = ShiftAssignmentSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["employee", "shift"]

    def get_queryset(self):
        qs = ShiftAssignment.objects.select_related("employee", "shift")
        user = self.request.user
        if can(user, Perm.ATTENDANCE_MANAGE):
            return qs
        employee = _requesting_employee(user)
        if employee is None:
            return qs.none()
        return qs.filter(employee=employee)


class AttendanceLogViewSet(
    XlsxExportMixin, AuditViewSetMixin, ListModelMixin, RetrieveModelMixin, UpdateModelMixin, GenericViewSet
):
    """No create/destroy routes — records are only ever created via the
    check-in action (or device-event processing), never a plain POST."""

    serializer_class = AttendanceLogSerializer
    permission_classes = [IsAuthenticated, AttendanceLogPermission]
    # SearchFilter as well as the field filters: this list is server-paginated,
    # so "find Sita's records" has to be answered by the database — filtering
    # the page the browser happens to be holding would search 25 of 4,000 rows.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # date supports range lookups (gte/lte) so the calendar can export a month.
    filterset_fields = {"employee": ["exact"], "status": ["exact"], "date": ["exact", "gte", "lte"]}
    search_fields = [
        "employee__employee_code",
        "employee__user__first_name",
        "employee__user__last_name",
    ]

    export_filename = "attendance.xlsx"
    export_title = "Attendance"
    export_headers = ["Employee", "Date", "Status", "Check in", "Check out"]
    export_highlight_header = "Status"
    export_validations = {"Status": ["Present", "Late", "Absent", "Half Day"]}

    def get_export_rows(self, queryset):
        fmt = lambda dt: dt.strftime("%Y-%m-%d %H:%M") if dt else ""  # noqa: E731
        return [
            [
                log.employee.user.get_full_name() or log.employee.user.get_username(),
                log.date.isoformat(),
                log.get_status_display(),
                fmt(log.check_in_time),
                fmt(log.check_out_time),
            ]
            for log in queryset.order_by("-date")
        ]

    def get_queryset(self):
        qs = AttendanceLog.objects.select_related(
            "employee__user", "employee__manager"
        # The serializer nests every punch now, so without this a month of one
        # person's attendance issues thirty extra queries — one per day — and a
        # department's month issues thirty times that.
        ).prefetch_related("sessions")
        return scope_to_visible(qs, self.request.user)

    def perform_update(self, serializer):
        before = {f: getattr(serializer.instance, f) for f in ATTENDANCE_TRACKED_FIELDS}
        instance = serializer.save(updated_by=self.request.user)
        entries = [
            AttendanceEditLog(
                attendance_log=instance,
                field=field,
                from_value=str(before[field]) if before[field] is not None else "",
                to_value=str(getattr(instance, field)) if getattr(instance, field) is not None else "",
                actor=self.request.user,
            )
            for field in ATTENDANCE_TRACKED_FIELDS
            if before[field] != getattr(instance, field)
        ]
        if entries:
            AttendanceEditLog.objects.bulk_create(entries)

    @action(detail=True, methods=["get"])
    def edit_logs(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = AttendanceEditLogSerializer(instance.edit_logs.select_related("actor"), many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="check-in")
    def check_in(self, request, *args, **kwargs):
        employee = _requesting_employee(request.user)
        if employee is None:
            return Response(
                {"detail": "Your account has no employee profile."}, status=status.HTTP_400_BAD_REQUEST
            )

        # A day has as many punches as it has. The policy check lives inside
        # `open_session`, so the webhook and this endpoint are refused by the
        # same rule rather than by two copies of it.
        try:
            open_session(employee, actor=request.user, note=request.data.get("note", ""))
        except AttendanceSourceError as exc:
            return Response({"detail": exc.messages[0]}, status=status.HTTP_403_FORBIDDEN)
        except PunchError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            DaySummarySerializer(day_summary(employee)).data, status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=["post"], url_path="check-out")
    def check_out(self, request, *args, **kwargs):
        employee = _requesting_employee(request.user)
        if employee is None:
            return Response(
                {"detail": "Your account has no employee profile."}, status=status.HTTP_400_BAD_REQUEST
            )

        # Closes the open stretch rather than the day — somebody clocking out
        # for lunch has not finished, and the next punch continues the same day.
        try:
            close_session(employee, actor=request.user)
        except PunchError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(DaySummarySerializer(day_summary(employee)).data)

    @action(detail=False, methods=["post"], url_path="heartbeat")
    def heartbeat(self, request, *args, **kwargs):
        """"I am still here." Sent by the browser while the clock runs.

        **Never closes anything.** It records how far the open session has got,
        so that when the tab closes — or the laptop sleeps, or the browser
        crashes — the nightly sweep can end the session *where the person
        actually stopped* rather than at a fixed office hour that would truncate
        a late night.

        Answers 204 either way. A beat for somebody who is not clocked in is not
        an error worth reporting to a background timer; it just means there was
        nothing to mark, and the client stops.
        """
        employee = _requesting_employee(request.user)
        if employee is not None:
            record_presence(employee)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path="my-today")
    def my_today(self, request, *args, **kwargs):
        employee = _requesting_employee(request.user)
        if employee is None:
            return Response(
                {"detail": "Your account has no employee profile."}, status=status.HTTP_400_BAD_REQUEST
            )
        # The whole day, not just whether a row exists. The widget needs the
        # punches and the running total to say anything useful, and asking for
        # them separately is three requests to render one card.
        return Response(DaySummarySerializer(day_summary(employee)).data)

    @action(detail=False, methods=["get"], url_path="person-summary")
    def person_summary(self, request, *args, **kwargs):
        """One person's attendance, as a reading rather than a strip of dots.

        The profile's attendance tab drew a month grid and nothing else — two
        dots on an otherwise empty row, with no answer to the question somebody
        opens that tab with: *am I turning up on time?* A grid shows which days
        had a record; it cannot say nineteen of twenty, or that the average
        arrival is eight minutes past.

        **Scoped through `get_queryset()`,** which already encodes who may read
        whose attendance — an employee their own, a manager their reports', HR
        everyone. So `?employee=` here cannot become a second, ungated way to
        somebody's movements: an employee asking for a colleague's id gets an
        empty summary, because the queryset never contained those rows.

        Counted over a window rather than "this month" so the figure does not
        collapse to nothing on the first of the month, which is exactly when
        somebody is most likely to look.
        """
        from datetime import timedelta

        window = min(int(request.query_params.get("days") or 30), 92)
        since = timezone.localdate() - timedelta(days=window)

        queryset = self.get_queryset().filter(date__gte=since)
        employee_id = request.query_params.get("employee")
        if employee_id:
            queryset = queryset.filter(employee_id=employee_id)
        else:
            employee = _requesting_employee(request.user)
            if employee is None:
                return Response(
                    {"detail": "Your account has no employee profile."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            queryset = queryset.filter(employee=employee)

        counts = {row["status"]: row["n"] for row in queryset.values("status").annotate(n=Count("id"))}
        present = counts.get(AttendanceLog.Status.PRESENT, 0)
        late = counts.get(AttendanceLog.Status.LATE, 0)
        absent = counts.get(AttendanceLog.Status.ABSENT, 0)
        half = counts.get(AttendanceLog.Status.HALF_DAY, 0)

        # Days with a record at all. Not the same as working days — a day
        # nobody logged is silent here, and calling it "absent" would invent an
        # absence out of a missing row.
        recorded = present + late + absent + half
        turned_up = present + late + half

        # Average arrival, in minutes past midnight, over the days there was one.
        # A mean of `check_in_time` is meaningless across dates, so it is
        # computed from the time-of-day component only.
        # `values_list`, not `.only()`: this queryset carries `select_related`
        # for the list view, and deferring a field that is also being traversed
        # raises. Pulling one column is cheaper here anyway — nothing on the
        # model is needed except the timestamps.
        arrivals = list(
            queryset.exclude(check_in_time__isnull=True).values_list("check_in_time", flat=True)
        )
        if arrivals:
            local = [timezone.localtime(a) for a in arrivals]
            minutes = sum(a.hour * 60 + a.minute for a in local) / len(local)
            average_arrival = f"{int(minutes // 60):02d}:{int(minutes % 60):02d}"
        else:
            average_arrival = None

        return Response(
            {
                "days": window,
                "recorded": recorded,
                "present": present,
                "late": late,
                "absent": absent,
                "half_day": half,
                "turned_up": turned_up,
                # Of the days with a record, how many were on time. `None`
                # rather than 100 when there is nothing to judge — a perfect
                # score for somebody who has never been recorded is a lie.
                "punctuality": round(present / turned_up * 100) if turned_up else None,
                "average_arrival": average_arrival,
            }
        )

    @action(detail=False, methods=["get"], url_path="my-history")
    def my_history(self, request, *args, **kwargs):
        """Your own punches, day by day.

        **Own only, and deliberately not parameterised by employee.** Somebody
        else's arrival times are a record of their movements; HR reads those
        through the attendance screens, which are already gated. A `?employee=`
        here would be a second, ungated way to the same data.

        Defaults to the last 30 days and is capped at 92. An unbounded range
        over a busy company is a slow query nobody asked for — the same reason
        the date-conversion batch endpoint refuses an unbounded list.
        """
        from datetime import timedelta

        employee = _requesting_employee(request.user)
        if employee is None:
            return Response(
                {"detail": "Your account has no employee profile."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        today = timezone.localdate()
        try:
            end = _parse_date(request.query_params.get("end")) or today
            start = _parse_date(request.query_params.get("start")) or end - timedelta(days=29)
        except ValueError:
            return Response(
                {"detail": "Dates must be YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if start > end:
            return Response(
                {"detail": "The start date is after the end date."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if (end - start).days > 92:
            return Response(
                {"detail": "Ask for at most 92 days at a time."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        days = day_history(employee, start, end)
        return Response(
            {
                "start": start,
                "end": end,
                "days": DaySummarySerializer(days, many=True).data,
                # Served rather than summed in the browser: a total computed
                # over one page is not a fact about the range (§2.6).
                "seconds_worked": sum(d["seconds_worked"] for d in days),
                "days_with_punches": len(days),
            }
        )


    @action(detail=False, methods=["get"])
    def arrivals(self, request, *args, **kwargs):
        """When people actually arrive, across the day.

        **Not another trend line.** "78% were on time over twelve weeks" is a
        number that goes in a report and changes nothing: it does not say
        whether the office starts at nine, at half past, or at ten, and those
        are three different companies with the same percentage.

        This is the distribution — every check-in of the last four weeks placed
        in the half-hour it happened in. Read against the official start time it
        answers the question a manager can act on: *is the start time we publish
        the one people keep?* An office whose mass sits forty minutes past its
        own start does not have a lateness problem, it has a start-time problem,
        and no amount of late-arrival counting will show that.

        **Four weeks, not twelve.** A habit is what people are doing now. A
        quarter of data averages over the last time the rule was enforced.
        """
        today = timezone.localdate()
        since = today - timedelta(days=28)

        punches = (
            self.filter_queryset(self.get_queryset())
            .filter(date__gte=since, date__lte=today, check_in_time__isnull=False)
            .values_list("check_in_time", flat=True)
        )

        # Half-hour buckets. Finer than that and a company of ninety produces a
        # comb of ones; coarser and the difference between 09:05 and 09:50 —
        # which is the whole question — disappears into one bar.
        buckets: dict[int, int] = {}
        minutes: list[int] = []
        for punched in punches:
            local = timezone.localtime(punched) if timezone.is_aware(punched) else punched
            since_midnight = local.hour * 60 + local.minute
            minutes.append(since_midnight)
            slot = (since_midnight // 30) * 30
            buckets[slot] = buckets.get(slot, 0) + 1

        if not minutes:
            return Response(
                {"slots": [], "office_start": None, "median": None, "total": 0, "after_start": None}
            )

        # The window is drawn from the data, not from a fixed 00:00–24:00 axis:
        # eighteen empty hours either side would squeeze the part anybody cares
        # about into a fifth of the width. One empty slot of padding each side
        # keeps the first and last bars from sitting flush against the edge.
        low = (min(buckets) // 30) * 30 - 30
        high = (max(buckets) // 30) * 30 + 30

        company = CompanyProfile.get_solo()
        start = company.office_start_time
        start_minutes = start.hour * 60 + start.minute if start else None

        ordered = sorted(minutes)
        median = ordered[len(ordered) // 2]

        return Response(
            {
                "slots": [
                    {
                        "minute": slot,
                        "label": f"{slot // 60:02d}:{slot % 60:02d}",
                        "count": buckets.get(slot, 0),
                    }
                    for slot in range(max(low, 0), min(high, 24 * 60 - 30) + 30, 30)
                ],
                "office_start": start_minutes,
                # The typical arrival, which is the figure the distribution is
                # really about — an average is dragged around by one person who
                # came in at 4am to fix something.
                "median": median,
                "total": len(minutes),
                "after_start": (
                    sum(1 for m in minutes if m > start_minutes) if start_minutes is not None else None
                ),
            }
        )


class AttendanceDeviceEventViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """Read-only: HR admins can inspect staged device events. Creation
    happens only via the process_attendance_device_events management
    command (simulating a real device push) — never via API, since an
    open create endpoint would let anyone inject fake attendance events
    impersonating any employee."""

    queryset = AttendanceDeviceEvent.objects.all()
    serializer_class = AttendanceDeviceEventSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["processed", "reported_device_id", "device"]


class DeviceViewSet(AuditViewSetMixin, ModelViewSet):
    """Manage attendance terminals.

    HR-admin only for writes. The token is the sensitive part: it is generated
    server-side, returned exactly once on create or rotate, and stored only as
    a hash — so a leaked device list is not a leaked set of credentials.
    """

    queryset = Device.objects.all()
    serializer_class = DeviceSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["device_type", "is_active"]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        token = Device.generate_secret()
        device = serializer.save()
        device.set_secret(token)
        device.save(update_fields=["secret_hash"])

        payload = self.get_serializer(device).data
        # The only moment this value is ever visible.
        payload["token"] = token
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="rotate-token")
    def rotate_token(self, request, *args, **kwargs):
        """Issue a replacement token. The previous one stops working
        immediately — the device must be reconfigured before its next push."""
        device = self.get_object()
        token = device.rotate_secret()
        payload = self.get_serializer(device).data
        payload["token"] = token
        return Response(payload)


class RegularisationRequestViewSet(
    StatusCountsMixin,
    AuditViewSetMixin,
    ListModelMixin,
    RetrieveModelMixin,
    CreateModelMixin,
    GenericViewSet,
):
    """An employee disputing their own attendance, and HR deciding.

    No update or destroy: a submitted dispute is a claim on the record, and
    editing or deleting it after the fact would undo the thing it exists to
    provide. Withdrawing is `cancel`, which leaves the trail intact.
    """

    serializer_class = RegularisationRequestSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["status", "employee", "date"]
    search_fields = [
        "employee__employee_code",
        "employee__user__first_name",
        "employee__user__last_name",
        "reason",
    ]
    ordering_fields = ["date", "created_at", "status"]
    ordering = ["-date"]

    def get_queryset(self):
        qs = RegularisationRequest.objects.select_related("employee__user", "reviewed_by")
        user = self.request.user
        if can(user, Perm.ATTENDANCE_MANAGE):
            return qs
        employee = _requesting_employee(user)
        if employee is None:
            return qs.none()
        # An employee sees only their own disputes — somebody else's attendance
        # argument is not their business.
        return qs.filter(employee=employee)

    def perform_create(self, serializer):
        """Always for the requester themselves.

        Taken from the session rather than the payload, so an employee cannot
        file a dispute against somebody else's attendance by changing an id.
        """
        employee = _requesting_employee(self.request.user)
        if employee is None:
            raise ValidationError("You have no employee record, so there is no attendance to dispute.")
        serializer.save(employee=employee, created_by=self.request.user, updated_by=self.request.user)

    @action(detail=True, methods=["post"])
    def approve(self, request, *args, **kwargs):
        if not can(request.user, Perm.ATTENDANCE_MANAGE):
            return Response(status=status.HTTP_403_FORBIDDEN)
        instance = self.get_object()
        try:
            approve_regularisation(
                instance, actor=request.user, note=(request.data.get("note") or "").strip()
            )
        except RegularisationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, *args, **kwargs):
        if not can(request.user, Perm.ATTENDANCE_MANAGE):
            return Response(status=status.HTTP_403_FORBIDDEN)
        note = (request.data.get("note") or "").strip()
        if not note:
            # A rejection with no reason gives the employee nothing to correct
            # or appeal, and turns the request into a dead end rather than an
            # answer.
            return Response(
                {"detail": "Give a reason for the rejection."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        instance = self.get_object()
        try:
            reject_regularisation(instance, actor=request.user, note=note)
        except RegularisationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, *args, **kwargs):
        """The requester withdrawing their own dispute."""
        instance = self.get_object()
        own = _requesting_employee(request.user)
        if own is None or instance.employee_id != own.pk:
            return Response(status=status.HTTP_403_FORBIDDEN)
        if instance.status != RegularisationRequest.Status.PENDING:
            return Response(
                {"detail": f"This request is already {instance.get_status_display().lower()}."},
                status=status.HTTP_409_CONFLICT,
            )
        instance.status = RegularisationRequest.Status.CANCELLED
        instance.updated_by = request.user
        instance.save(update_fields=["status", "updated_by", "updated_at"])
        return Response(self.get_serializer(instance).data)
