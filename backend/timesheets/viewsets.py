from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import (
    CreateModelMixin,
    DestroyModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
    UpdateModelMixin,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.viewsets import AuditViewSetMixin
from timesheets.models import TimeEntry
from timesheets.serializers import TimeEntrySerializer


def _week_start(day):
    """The Sunday starting `day`'s week.

    **Sunday, not Monday — and that is the point.** Nepal's working week runs
    Sunday to Friday with Saturday as the weekend. A Monday anchor opens the
    week on Monday and pushes Sunday, a *working* day, to the far side of the
    weekend: the six days somebody actually works end up split across two
    screens, which is the one thing this view exists to prevent.

    The ISO week is the right anchor for a payroll period, which is a span of
    calendar days. It is the wrong one for a screen whose whole job is to show
    a person their working week in one row.
    """
    # isoweekday(): Sunday is 7, Monday is 1 — so Sunday steps back nothing.
    return day - timedelta(days=day.isoweekday() % 7)


def _is_hr(user):
    """Thin adapter over the one policy (accounts/policy.py).

    Kept as a local name so every call site in this file reads the same
    as it did; what it *means* is now decided in one place rather than
    re-derived here.
    """
    return can(user, Perm.WORKPLACE_MANAGE)


class TimeEntryViewSet(
    AuditViewSetMixin,
    ListModelMixin,
    RetrieveModelMixin,
    CreateModelMixin,
    UpdateModelMixin,
    DestroyModelMixin,
    GenericViewSet,
):
    serializer_class = TimeEntrySerializer
    permission_classes = [IsAuthenticated]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by what the time was spent on, or whose it is.
    search_fields = ["description", "project__name", "employee__user__first_name", "employee__user__last_name", "employee__employee_code"]
    filterset_fields = ["project", "status", "employee", "billable"]

    def get_queryset(self):
        qs = TimeEntry.objects.select_related("employee__user", "project", "task")
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start:
            qs = qs.filter(date__gte=start)
        if end:
            qs = qs.filter(date__lte=end)
        if _is_hr(self.request.user):
            return qs
        me = _requesting_employee(self.request.user)
        return qs.filter(employee=me) if me else qs.none()

    def create(self, request, *args, **kwargs):
        me = _requesting_employee(request.user)
        if me is None:
            return Response({"detail": "Your account has no employee profile."}, status=400)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entry = serializer.save(employee=me, created_by=request.user, updated_by=request.user)
        return Response(self.get_serializer(entry).data, status=status.HTTP_201_CREATED)

    def _owned(self, request):
        entry = self.get_object()
        me = _requesting_employee(request.user)
        if not (_is_hr(request.user) or (me and entry.employee_id == me.id)):
            return None
        return entry

    def update(self, request, *args, **kwargs):
        entry = self._owned(request)
        if entry is None:
            return Response(status=status.HTTP_403_FORBIDDEN)
        if entry.status == TimeEntry.Status.APPROVED and not _is_hr(request.user):
            return Response({"detail": "Approved entries can't be edited."}, status=400)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        entry = self._owned(request)
        if entry is None:
            return Response(status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    def _decide(self, request, new_status):
        if not _is_hr(request.user):
            return Response({"detail": "HR only."}, status=status.HTTP_403_FORBIDDEN)
        entry = self.get_object()
        entry.status = new_status
        entry.decided_by = request.user
        entry.decided_at = timezone.now()
        entry.save(update_fields=["status", "decided_by", "decided_at"])
        return Response(self.get_serializer(entry).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, *args, **kwargs):
        return self._decide(request, TimeEntry.Status.APPROVED)

    @action(detail=True, methods=["post"])
    def reject(self, request, *args, **kwargs):
        return self._decide(request, TimeEntry.Status.REJECTED)

    @action(detail=False, methods=["get"])
    def week(self, request, *args, **kwargs):
        """One person's week, day by day — **including the days with nothing on
        them.**

        This is the endpoint the timesheet was missing. A list of entries can
        only show what somebody logged; the question a timesheet exists to
        answer is what they *didn't*, and an absent row is invisible in a list
        by definition. Somebody who forgot Tuesday sees six rows and no hint
        that a seventh is missing.

        **A blank day is only a gap if it was a working day.** Nepal's weekend
        is Saturday, festivals move year to year, and both are already
        configured per company — so this reads `CompanyProfile.working_days` and
        the `Holiday` table rather than assuming Monday–Friday. Getting that
        wrong would mark every Saturday as a missed day and train people to
        ignore the warning, which is worse than not showing one.

        Scoped through `get_queryset()`: an employee gets their own week, HR can
        ask for somebody else's with `?employee=`.
        """
        from leave.services import holidays_between, is_working_day, working_day_set

        start = parse_date(request.query_params.get("start") or "") or _week_start(
            timezone.localdate()
        )
        end = start + timedelta(days=6)

        queryset = self.filter_queryset(self.get_queryset()).filter(date__gte=start, date__lte=end)

        # One query for the whole week, then bucketed in Python — seven queries
        # for seven days is the shape this replaces.
        logged = {
            row["date"]: row
            for row in queryset.values("date").annotate(
                hours=Sum("hours"), entries=Count("id")
            )
        }
        approved = dict(
            queryset.filter(status=TimeEntry.Status.APPROVED)
            .values_list("date")
            .annotate(hours=Sum("hours"))
        )

        working = working_day_set()
        holidays = holidays_between(start, end)
        today = timezone.localdate()

        days = []
        for offset in range(7):
            day = start + timedelta(days=offset)
            row = logged.get(day, {})
            hours = row.get("hours") or Decimal("0")
            expected = is_working_day(day, working, holidays)
            days.append(
                {
                    "date": day.isoformat(),
                    "hours": str(hours),
                    "approved_hours": str(approved.get(day) or Decimal("0")),
                    "entries": row.get("entries", 0),
                    "working_day": expected,
                    # A day that has not happened yet is not a gap. Without this
                    # every Friday is reported missing from Monday onwards.
                    "missing": expected and hours == 0 and day <= today,
                }
            )

        total = sum((Decimal(d["hours"]) for d in days), Decimal("0"))
        return Response(
            {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "total_hours": str(total),
                "billable_hours": str(
                    queryset.filter(billable=True).aggregate(n=Sum("hours"))["n"] or Decimal("0")
                ),
                "days": days,
                "missing_days": sum(1 for d in days if d["missing"]),
                "working_days": sum(1 for d in days if d["working_day"]),
            }
        )

    @action(detail=False, methods=["get"])
    def summary(self, request, *args, **kwargs):
        """Hours grouped by project over the current queryset (respects the
        same start/end/employee/status filters), plus a grand total."""
        qs = self.filter_queryset(self.get_queryset())
        by_project = (
            qs.values("project", "project__name")
            .annotate(hours=Sum("hours"))
            .order_by("-hours")
        )
        total = qs.aggregate(total=Sum("hours"))["total"] or 0
        return Response({
            "total_hours": total,
            "by_project": [
                {"project": r["project"], "project_name": r["project__name"], "hours": r["hours"]}
                for r in by_project
            ],
        })
