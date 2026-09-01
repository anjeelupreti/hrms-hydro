from datetime import timedelta

from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.policy import Perm, can
from attendance.models import AttendanceLog
from attendance.permissions import _requesting_employee
from core.calendars import company_calendar
from employees.models import Employee
from employees.scoping import scope_to_visible
from employees.serializers import EmployeeListSerializer
from leave.models import LeaveBalance, LeaveRequest
from leave.serializers import LeaveRequestSerializer
from leave.services import can_act_on_step, get_default_chain
from payroll.models import PayrollRun


def _scope_employee_qs(user):
    """Everyone, or a manager's own team.

    **Never scoped to a single person.** A *company* dashboard narrowed to one
    employee reports a company of one, which is a page pretending to be two
    different things rather than a permission model. Access is gated instead
    (see the permission class below), leaving the one genuine scope: a manager
    sees their own team.
    """
    if can(user, Perm.DASHBOARD_VIEW):
        return Employee.objects.all()
    employee = _requesting_employee(user)
    if employee is None:
        return Employee.objects.none()
    return Employee.objects.filter(Q(id=employee.id) | Q(manager=employee))


def _today_is_working(today):
    """Whether the company is open today, by its own calendar.

    Read by the attendance headline so it can tell "nobody came in" from
    "nobody was supposed to". Without it the largest figure on the page reads
    "0 present of 95" every weekend — correct, and saying nothing. The trend
    chart makes the same distinction by returning `null` rather than 0 for a
    non-working day.

    Weekends come from `CompanyProfile.working_days` and holidays from the
    company's own list, so a company working Sunday to Friday reads correctly
    rather than against a hardcoded Saturday/Sunday. Served rather than derived
    in the browser: a client-side `getDay() === 6` is wrong for any company that
    does not keep the default week.

    Reuses `leave.services` rather than restating the rule — a second copy is
    how a company ends up charged leave for a day the dashboard called closed.

    Best-effort: a workspace with no profile yet is treated as open, because
    asserting a closed day we cannot substantiate is worse than showing the
    raw count.
    """
    try:
        from leave.services import holidays_between, is_working_day, working_day_set

        return is_working_day(
            today, working=working_day_set(), holidays=holidays_between(today, today)
        )
    except Exception:  # noqa: BLE001 — a headline caption is not worth a 500
        return True


class CanViewDashboard(BasePermission):
    """The dashboard refuses rather than shrinking.

    Employees do not land here at all — the portal is their dashboard — so this
    page can finally assume its audience, and the company-of-one bug disappears
    because the ambiguity that caused it is gone.
    """

    def has_permission(self, request, view):
        return can(request.user, Perm.DASHBOARD_VIEW)


class DashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated, CanViewDashboard]

    def get(self, request, **kwargs):
        today = timezone.localdate()
        is_hr = can(request.user, Perm.DASHBOARD_VIEW)
        scope = _scope_employee_qs(request.user)
        active_scope = scope.filter(employment_status=Employee.EmploymentStatus.ACTIVE)

        present_today = AttendanceLog.objects.filter(
            employee__in=active_scope,
            date=today,
            status__in=[AttendanceLog.Status.PRESENT, AttendanceLog.Status.LATE],
        ).count()
        absent_today = AttendanceLog.objects.filter(
            employee__in=active_scope, date=today, status=AttendanceLog.Status.ABSENT
        ).count()
        on_leave_today = LeaveRequest.objects.filter(
            employee__in=active_scope,
            status=LeaveRequest.Status.APPROVED,
            start_date__lte=today,
            end_date__gte=today,
        ).count()

        pending_qs = LeaveRequest.objects.filter(
            status=LeaveRequest.Status.PENDING
        ).select_related("employee__manager")
        # Was hand-rolled here without the `employee is None` guard the other
        # call sites had, which leaked every unmanaged employee's requests to
        # any user without an employee profile.
        pending_qs = scope_to_visible(pending_qs, request.user)
        # Resolve the approval chain's steps ONCE (was re-querying get_default_chain
        # + chain.steps per row, and each can_act_on_step hit employee.manager).
        steps_by_seq = {s.sequence: s for s in get_default_chain().steps.all()}
        pending_my_approval = sum(
            1
            for r in pending_qs
            if steps_by_seq.get(r.current_step)
            and can_act_on_step(request.user, r, steps_by_seq[r.current_step])
        )

        todays_birthdays = active_scope.filter(
            date_of_birth__month=today.month, date_of_birth__day=today.day
        )
        upcoming_leaves = (
            LeaveRequest.objects.filter(
                employee__in=active_scope,
                status=LeaveRequest.Status.APPROVED,
                start_date__gte=today,
            )
            .select_related("employee__user", "leave_type")
            .order_by("start_date")[:5]
        )

        recent_employees = (
            active_scope.select_related("user", "department", "designation").order_by("-date_joined")[:5]
        )

        # One aggregate query for the whole 7-day window (grouped by
        # date+status) rather than 2 queries per day — the initial version
        # of this loop issued 14 separate COUNT queries and was the main
        # reason the dashboard felt slow to load.
        trend_start = today - timedelta(days=6)
        attendance_counts = (
            AttendanceLog.objects.filter(employee__in=active_scope, date__gte=trend_start, date__lte=today)
            .values("date", "status")
            .annotate(count=Count("id"))
        )
        present_by_date = {}
        absent_by_date = {}
        # Late is counted separately as well as within present. It *is*
        # attendance — somebody late was at work — so folding it into present
        # is right for "how many turned up", and hiding it entirely means the
        # dashboard cannot show the one attendance problem a manager can
        # actually act on. Both numbers, and the reader decides.
        late_by_date = {}
        for row in attendance_counts:
            if row["status"] in (AttendanceLog.Status.PRESENT, AttendanceLog.Status.LATE):
                present_by_date[row["date"]] = present_by_date.get(row["date"], 0) + row["count"]
            if row["status"] == AttendanceLog.Status.LATE:
                late_by_date[row["date"]] = late_by_date.get(row["date"], 0) + row["count"]
            elif row["status"] == AttendanceLog.Status.ABSENT:
                absent_by_date[row["date"]] = row["count"]

        attendance_trend = []
        for days_ago in range(6, -1, -1):
            day = today - timedelta(days=days_ago)
            attendance_trend.append(
                {
                    "date": day.isoformat(),
                    "present": present_by_date.get(day, 0),
                    "late": late_by_date.get(day, 0),
                    "absent": absent_by_date.get(day, 0),
                }
            )

        # ── Attendance heatmap: department by day ────────────────────────
        #
        # A line of company-wide totals hides where a problem lives. Ninety per
        # cent present looks fine until it turns out Support is at sixty and
        # everyone else is at ninety-eight — which is a fact about one team,
        # not about the company, and a trend line can never show it.
        #
        # Two weeks rather than the trend's one: a single week cannot separate
        # "Tuesday was bad" from "Tuesdays are bad", and the second is the
        # actionable one.
        #
        # Still one query. Grouping by department and date in the database is
        # the difference between this and a nested loop issuing a COUNT per
        # department per day — 14 × 8 of them on Acme.
        heatmap_start = today - timedelta(days=13)
        heat_rows = (
            AttendanceLog.objects.filter(
                employee__in=active_scope, date__gte=heatmap_start, date__lte=today
            )
            .values("date", "employee__department__name", "status")
            .annotate(count=Count("id"))
        )

        heat = {}
        for row in heat_rows:
            key = (row["employee__department__name"] or "Unassigned", row["date"])
            bucket = heat.setdefault(key, {"present": 0, "total": 0})
            bucket["total"] += row["count"]
            if row["status"] in (AttendanceLog.Status.PRESENT, AttendanceLog.Status.LATE):
                bucket["present"] += row["count"]

        heat_days = [heatmap_start + timedelta(days=i) for i in range(14)]
        heat_departments = sorted({name for name, _ in heat})
        attendance_heatmap = {
            "days": [d.isoformat() for d in heat_days],
            "rows": [
                {
                    "department": name,
                    # `None`, never zero. A day with nothing logged is a day
                    # nobody recorded — a weekend, a holiday — and drawing that
                    # as 0% attendance paints every Saturday as a crisis.
                    "cells": [
                        None
                        if not heat.get((name, day), {}).get("total")
                        else round(100 * heat[(name, day)]["present"] / heat[(name, day)]["total"])
                        for day in heat_days
                    ],
                }
                for name in heat_departments
            ],
        }

        # ── Workforce by tenure ──────────────────────────────────────────
        #
        # Headcount answers "how many"; this answers "how long", which is the
        # question behind retention. A company of 106 with everybody under a
        # year is a different company from one with half its people past three
        # — and the single headcount figure is identical in both.
        #
        # Split by gender because that is the composition an HR report is
        # actually asked for, and because a band that skews hard one way is
        # invisible in a total. Unrecorded gender is its own bucket rather
        # than being dropped: 40 people with no value recorded is a fact about
        # the data, and silently omitting them would misstate the headcount.
        tenure_bands = [
            ("Under 1 year", 0, 365),
            ("1–2 years", 365, 730),
            ("2–3 years", 730, 1095),
            ("3–5 years", 1095, 1825),
            ("5+ years", 1825, 10**6),
        ]
        tenure_rows = active_scope.values("gender", "date_joined")
        tenure_counts = {label: {"male": 0, "female": 0, "other": 0} for label, _, _ in tenure_bands}
        for row in tenure_rows:
            if not row["date_joined"]:
                continue
            days = (today - row["date_joined"]).days
            for label, low, high in tenure_bands:
                if low <= days < high:
                    key = row["gender"] if row["gender"] in ("male", "female") else "other"
                    tenure_counts[label][key] += 1
                    break

        workforce_tenure = [
            {
                "band": label,
                "male": tenure_counts[label]["male"],
                "female": tenure_counts[label]["female"],
                "other": tenure_counts[label]["other"],
            }
            # Longest tenure first, so the pyramid reads with the base at the
            # bottom the way one is normally drawn.
            for label, _, _ in reversed(tenure_bands)
        ]

        # ── Leave used against leave allowed, by department ──────────────
        #
        # A leave total answers "how much was taken" and hides the only thing
        # worth acting on: whether a team is *running out*. Twelve days used
        # means nothing until you know whether they had fourteen or twenty-two.
        #
        # A dot plot puts both on one line per department — allowance as the
        # track, taken as the mark — so a team near its limit is visible as a
        # dot near the end rather than as a number somebody has to divide.
        #
        # Entitlement is allocated plus carried forward: a person carrying five
        # days from last year genuinely has five more to take, and comparing
        # usage against allocation alone would report them as over.
        # `fiscal_year_of(today)`, not `today.year`. A leave balance is stored
        # against the fiscal year it belongs to, which on a Bikram Sambat
        # company is 2083 while the calendar year is 2026 — filtering on the
        # calendar year matched nothing at all and reported every department as
        # having no allowance. Same shape as D‑06, and written here first time
        # by making exactly that assumption.
        fiscal_year = company_calendar().fiscal_year_of(today)
        balances = (
            LeaveBalance.objects.filter(
                employee__in=active_scope, year=fiscal_year
            )
            .values("employee__department__name")
            .annotate(
                allowed=Sum("allocated_days") + Sum("carried_forward_days"),
                used=Sum("used_days"),
            )
            .order_by("employee__department__name")
        )
        leave_usage = [
            {
                "department": row["employee__department__name"] or "Unassigned",
                "allowed": float(row["allowed"] or 0),
                "used": float(row["used"] or 0),
            }
            for row in balances
            # A department with no allowance has nothing to plot against, and a
            # track of length zero would draw every mark at the same place.
            if (row["allowed"] or 0) > 0
        ]

        # Same idea: one aggregate query grouped by leave type, instead of
        # one COUNT query per LeaveType row.
        year_start = today.replace(month=1, day=1)
        leave_counts = (
            LeaveRequest.objects.filter(
                employee__in=active_scope,
                status__in=[LeaveRequest.Status.APPROVED, LeaveRequest.Status.PENDING],
                start_date__gte=year_start,
            )
            .values("leave_type__name")
            .annotate(count=Count("id"))
            .order_by("leave_type__name")
        )
        leave_breakdown = [
            {"leave_type": row["leave_type__name"], "count": row["count"]} for row in leave_counts
        ]

        # Active employees grouped by department (one aggregate query) —
        # feeds the dashboard's department-distribution donut.
        dept_counts = (
            active_scope.values("department__name").annotate(count=Count("id")).order_by("-count")
        )
        department_distribution = [
            {"department": row["department__name"] or "Unassigned", "count": row["count"]}
            for row in dept_counts
        ]

        # Who's on leave today (the list, not just the count).
        on_leave_today_list = [
            {
                "employee": lr.employee.user.get_full_name() or lr.employee.user.get_username(),
                "employee_id": lr.employee_id,
                "leave_type": lr.leave_type.name,
                "end_date": lr.end_date.isoformat(),
            }
            for lr in LeaveRequest.objects.filter(
                employee__in=active_scope,
                status=LeaveRequest.Status.APPROVED,
                start_date__lte=today,
                end_date__gte=today,
            ).select_related("employee__user", "leave_type")[:8]
        ]

        # Upcoming birthdays (next 60 days) as a leaderboard — used when
        # there's nobody with a birthday *today*.
        upcoming_birthdays = []
        for emp in active_scope.exclude(date_of_birth__isnull=True).select_related("user"):
            dob = emp.date_of_birth
            try:
                next_bday = dob.replace(year=today.year)
            except ValueError:  # Feb 29
                next_bday = dob.replace(year=today.year, day=28)
            if next_bday < today:
                next_bday = next_bday.replace(year=today.year + 1)
            days_until = (next_bday - today).days
            if days_until <= 60:
                upcoming_birthdays.append(
                    {
                        "employee": emp.user.get_full_name() or emp.user.get_username(),
                        "employee_id": emp.id,
                        "date": next_bday.isoformat(),
                        "days_until": days_until,
                    }
                )
        upcoming_birthdays.sort(key=lambda b: b["days_until"])
        upcoming_birthdays = upcoming_birthdays[:5]

        # This month's attendance breakdown (present/late/absent/half_day) —
        # surfaces punctuality, not just today's snapshot.
        month_start = today.replace(day=1)
        month_rows = (
            AttendanceLog.objects.filter(employee__in=active_scope, date__gte=month_start, date__lte=today)
            .values("status")
            .annotate(c=Count("id"))
        )
        month_map = {row["status"]: row["c"] for row in month_rows}
        attendance_month = {
            "present": month_map.get(AttendanceLog.Status.PRESENT, 0),
            "late": month_map.get(AttendanceLog.Status.LATE, 0),
            "absent": month_map.get(AttendanceLog.Status.ABSENT, 0),
            "half_day": month_map.get(AttendanceLog.Status.HALF_DAY, 0),
        }

        # Payroll snapshot — HR only (net totals are sensitive).
        payroll_summary = None
        if is_hr:
            latest = PayrollRun.objects.first()  # ordered -year, -month
            latest_data = None
            if latest is not None:
                agg = latest.payslips.aggregate(net=Sum("net_pay"))
                latest_data = {
                    "period_year": latest.period_year,
                    "period_month": latest.period_month,
                    # Named by the server, so the dashboard card does not
                    # need a conversion table to say "Shrawan 2083".
                    "period_label": latest.period_label,
                    "status": latest.status,
                    "payslip_count": latest.payslips.count(),
                    "net_total": float(agg["net"] or 0),
                }
            # The last six runs, oldest first, for the card's sparkline.
            #
            # One month's net total is a number with nothing to compare it to.
            # Payroll moves for reasons somebody should notice — a joiner, a
            # leaver, a bonus month — and the shape of the last half-year is
            # what makes an unusual month look unusual.
            #
            # Annotated in one query rather than a `net_pay` sum per run, which
            # would be six round trips for a strip 60 pixels wide.
            history = [
                {
                    "period_label": run.period_label,
                    "net_total": float(run.net or 0),
                }
                # Ordered explicitly, not left to `Meta.ordering`: annotating
                # an aggregate puts the ordering fields into the GROUP BY, and
                # the direction that comes back is not reliably the model's.
                # Take the newest six, then reverse — a chart of periods reads
                # oldest to newest.
                for run in reversed(
                    list(
                        PayrollRun.objects.annotate(net=Sum("payslips__net_pay"))
                        .order_by("-period_year", "-period_month")[:6]
                    )
                )
            ]
            payroll_summary = {
                "draft_count": PayrollRun.objects.filter(status=PayrollRun.Status.DRAFT).count(),
                "latest": latest_data,
                "history": history,
            }

        # Top 5 most recent check-ins today (live "who's in" feed).
        recent_checkins = [
            {
                "employee": log.employee.user.get_full_name() or log.employee.user.get_username(),
                "employee_id": log.employee_id,
                "time": log.check_in_time.isoformat(),
                "status": log.status,
            }
            for log in AttendanceLog.objects.filter(
                employee__in=active_scope, date=today, check_in_time__isnull=False
            )
            .select_related("employee__user")
            .order_by("-check_in_time")[:5]
        ]

        return Response(
            {
                "total_employees": active_scope.count(),
                # So the hero can say "closed today" instead of printing a zero
                # that is accurate and useless. See `_today_is_working`.
                "today_is_working": _today_is_working(today),
                "present_today": present_today,
                "absent_today": absent_today,
                "on_leave_today": on_leave_today,
                "pending_my_approval": pending_my_approval,
                "todays_birthdays": EmployeeListSerializer(todays_birthdays, many=True).data,
                "upcoming_leaves": LeaveRequestSerializer(upcoming_leaves, many=True).data,
                "recent_employees": EmployeeListSerializer(recent_employees, many=True).data,
                "attendance_trend": attendance_trend,
                "attendance_heatmap": attendance_heatmap,
                "workforce_tenure": workforce_tenure,
                "leave_usage": leave_usage,
                "leave_breakdown": leave_breakdown,
                "department_distribution": department_distribution,
                "on_leave_today_list": on_leave_today_list,
                "upcoming_birthdays": upcoming_birthdays,
                "recent_checkins": recent_checkins,
                "attendance_month": attendance_month,
                "payroll_summary": payroll_summary,
            }
        )
