from datetime import date, timedelta

from django.db.models import Q
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.policy import Perm, can
from attendance.models import AttendanceLog
from attendance.permissions import _requesting_employee
from employees.models import Employee
from leave.models import LeaveRequest
from notifications.models import Holiday


class AttendanceCalendarView(APIView):
    """Merges AttendanceLog + approved LeaveRequest spans + Holiday into
    one per-employee/per-day status grid — built server-side so the
    frontend calendar grid doesn't stitch together three separate API
    calls (and doesn't need to re-implement the precedence rules below).

    Precedence when a date has more than one candidate status: holiday
    (applies to everyone, overrides all) > on_leave > the actual
    AttendanceLog status. A date with none of these is simply absent
    from `cells` — deliberately not defaulting to "absent" for weekends,
    since this app doesn't hardcode which day(s) are the weekend (see
    docs/development-plan.md on avoiding country-specific assumptions).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        start_raw = request.query_params.get("start")
        end_raw = request.query_params.get("end")
        if not start_raw or not end_raw:
            return Response({"detail": "start and end query params (YYYY-MM-DD) are required."}, status=400)
        try:
            start = date.fromisoformat(start_raw)
            end = date.fromisoformat(end_raw)
        except ValueError:
            return Response({"detail": "start/end must be YYYY-MM-DD."}, status=400)

        user = request.user
        employees_qs = Employee.objects.select_related("user")
        employee_filter = request.query_params.get("employee")
        is_hr = can(user, Perm.ATTENDANCE_MANAGE)

        if is_hr:
            if employee_filter:
                employees_qs = employees_qs.filter(pk=employee_filter)
        else:
            requester = _requesting_employee(user)
            if requester is None:
                return Response({"employees": [], "holidays": [], "cells": []})
            employees_qs = employees_qs.filter(Q(pk=requester.pk) | Q(manager=requester))
            if employee_filter:
                employees_qs = employees_qs.filter(pk=employee_filter)

        employees = list(employees_qs)
        employee_ids = [e.id for e in employees]

        holidays = list(Holiday.objects.filter(date__gte=start, date__lte=end).values("date", "name"))

        merged = {}
        for log in AttendanceLog.objects.filter(employee_id__in=employee_ids, date__gte=start, date__lte=end):
            merged[(log.employee_id, log.date)] = log.status

        leave_requests = LeaveRequest.objects.filter(
            employee_id__in=employee_ids,
            status=LeaveRequest.Status.APPROVED,
            start_date__lte=end,
            end_date__gte=start,
        )
        for leave_request in leave_requests:
            day = max(leave_request.start_date, start)
            last = min(leave_request.end_date, end)
            while day <= last:
                merged[(leave_request.employee_id, day)] = "on_leave"
                day += timedelta(days=1)

        for holiday in holidays:
            for employee_id in employee_ids:
                merged[(employee_id, holiday["date"])] = "holiday"

        cells = [
            {"employee": employee_id, "date": day.isoformat(), "status": status}
            for (employee_id, day), status in merged.items()
        ]

        return Response(
            {
                "employees": [
                    {
                        "id": e.id,
                        "employee_code": e.employee_code,
                        "full_name": e.user.get_full_name() or e.user.get_username(),
                    }
                    for e in employees
                ],
                "holidays": [{"date": h["date"].isoformat(), "name": h["name"]} for h in holidays],
                "cells": cells,
            }
        )
