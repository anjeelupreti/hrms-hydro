"""Cross-module reporting.

One endpoint, many report `type`s, all returning the same generic shape
(`summary` cards + `columns`/`rows` table) so the frontend renders any
report — and exports it — without per-report UI. HR-only; reports touch
compensation and everyone's attendance/leave.

**One envelope, many reports.** Every entry in `REPORT_TYPES` costs a builder
method and a catalogue entry, and answers in the same shape — `summary` cards,
`columns`, `rows`, and an optional `chart` — so the screen that renders one
renders all of them.

**`chart` is `{kind, title, unit, points}`**, with `kind` one of `columns`
(ordered, usually time) or `bars` (ranked categories). Two kinds deliberately:
those are the two the frontend draws well, and a third invented here would be a
chart nothing can render. A table alone has no shape — you cannot see a trend, a
skew or an outlier in a spreadsheet with a header.
"""

from collections import OrderedDict
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from assets.models import Asset
from attendance.models import AttendanceLog
from employees.models import Department, Employee, LifecycleEvent
from expenses.models import ExpenseClaim
from leave.models import LeaveRequest
from payroll.models import PayrollRun, Payslip
from payroll.periods import period_window
from payroll.permissions import IsHRAdmin
from helpdesk.models import Ticket
from projects.models import ProjectTask
from recruitment.models import Candidate
from timesheets.models import TimeEntry
from training.models import Enrollment, TrainingSession
from wfh.models import WFHRequest

REPORT_TYPES = [
    "team",
    "headcount",
    "attendance",
    "leave",
    "wfh",
    "payroll",
    "expenses",
    "statutory",
    "recruitment",
    "training",
    "assets",
    "helpdesk",
    "projects",
    "timesheets",
]

#: Which reports accept a department, so the frontend can offer the control
#: only where it does something.
#:
#: On a workforce of a hundred across eight departments the question is almost
#: always about *one* team, and exporting to filter in Excel is the thing a
#: report exists to avoid.
#:
#: Declared rather than inferred: a department filter offered on the asset
#: register would silently do nothing, and a control that does nothing is worse
#: than one that is absent. The screen reads this set to decide whether to show
#: the picker at all.
DEPARTMENT_FILTERABLE = {
    "team",
    "headcount",
    "attendance",
    "leave",
    "wfh",
    "expenses",
    "statutory",
    "training",
    "helpdesk",
    "timesheets",
}


def _name(employee):
    return employee.user.get_full_name() or employee.user.get_username()


def _parse(value, fallback):
    if not value:
        return fallback
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return fallback


#: A chart needs something to compare against. One bar is not a chart.
MIN_POINTS = 2


def _chart(kind, title, points, unit="count"):
    """One chart spec, or `None` when there is nothing worth drawing.

    Returning `None` rather than an empty chart matters: a frame with no bars
    in it reads as a broken chart, where no chart at all reads as a table-only
    report — which is what it is.

    **One bar is not a chart, and neither are four of identical length.**
    Comparison is the entire job of a chart: below two points there is nothing
    to compare, and a set of equal values has no difference to encode — four
    full-width bars all reading "6 enrolments" take 220px to say what four table
    rows already said, and look exactly like a chart whose scaling has broken.
    In both cases `None` is returned and the table stands alone.
    """
    points = [p for p in points if p["value"]]
    if len(points) < MIN_POINTS:
        return None
    if len({p["value"] for p in points}) == 1:
        return None
    return {"kind": kind, "title": title, "unit": unit, "points": points}


def _months_between(start, end):
    """`(year, month)` for every month the range touches, in order.

    Gregorian months, deliberately, even on a Bikram Sambat company: this groups
    *the range the caller asked for*, and the caller sends Gregorian dates. A BS
    company picks a BS month in the UI, which arrives here as the Gregorian span
    of that month — grouping it again by a second calendar would put a boundary
    in a place neither party asked for.
    """
    months = []
    cursor = start.replace(day=1)
    last = end.replace(day=1)
    while cursor <= last:
        months.append((cursor.year, cursor.month))
        cursor = (cursor + timedelta(days=32)).replace(day=1)
    return months


MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class ReportView(APIView):
    permission_classes = [IsAuthenticated, IsHRAdmin]

    #: Set per request in `get`. `None` means every department.
    department = None

    def _people(self):
        """The employees this report covers, department filter applied.

        One place, because the filter has to mean the same thing in ten reports
        — and "employees in department X" written ten times is ten chances for
        one of them to forget the resigned-and-terminated exclusion that the
        others make.
        """
        people = Employee.objects.select_related("user", "department")
        if self.department is not None:
            people = people.filter(department_id=self.department)
        return people

    def _limit(self, queryset, field="employee"):
        """Narrow any queryset with an employee FK to the filtered department."""
        if self.department is None:
            return queryset
        return queryset.filter(**{f"{field}__department_id": self.department})

    def get(self, request, *args, **kwargs):
        report_type = request.query_params.get("type", "team")
        if report_type not in REPORT_TYPES:
            return Response({"detail": f"Unknown report type '{report_type}'."}, status=400)

        today = date.today()
        start = _parse(request.query_params.get("start"), today.replace(day=1))
        end = _parse(request.query_params.get("end"), today)

        # Set before dispatch rather than threaded through fourteen signatures.
        # DRF builds a fresh view instance per request, so this is per-request
        # state and not shared — the same reason `self.request` is safe.
        raw_department = request.query_params.get("department")
        try:
            self.department = (
                int(raw_department)
                if raw_department and report_type in DEPARTMENT_FILTERABLE
                else None
            )
        except (TypeError, ValueError):
            return Response({"detail": "department must be a number."}, status=400)

        builder = getattr(self, f"_report_{report_type}")
        built = builder(start, end)
        # Every builder returns `(summary, columns, rows)`; the ones with a
        # picture return a fourth. Unpacked rather than required, so adding a
        # chart to a report is a one-line change and not a signature change
        # every other builder has to follow.
        summary, columns, rows = built[0], built[1], built[2]
        chart = built[3] if len(built) > 3 else None

        if request.query_params.get("export") == "xlsx":
            from core.exports import xlsx_response

            title = f"{report_type.title()} Report"
            return xlsx_response(
                f"{report_type}-report-{end.isoformat()}.xlsx",
                columns,
                rows,
                title=title,
                subtitle=f"{start.isoformat()} to {end.isoformat()}",
            )

        return Response(
            {
                "type": report_type,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "summary": summary,
                "columns": columns,
                "rows": rows,
                "chart": chart,
            }
        )

    # --- people --------------------------------------------------------------

    def _report_team(self, start, end):
        qs = self._people()
        total = qs.count()
        active = qs.filter(employment_status=Employee.EmploymentStatus.ACTIVE).count()
        on_leave = qs.filter(employment_status=Employee.EmploymentStatus.ON_LEAVE).count()
        new_hires = qs.filter(date_joined__gte=start, date_joined__lte=end).count()
        summary = [
            {"label": "Total employees", "value": total},
            {"label": "Active", "value": active},
            {"label": "On leave", "value": on_leave},
            {"label": "New hires (range)", "value": new_hires},
        ]
        columns = ["Department", "Headcount", "Active"]

        # One grouped query for both counts. Per-department counting in the
        # loop below would be two queries each, and the company with the most
        # departments is exactly the one it would be slowest for.
        grouped = {
            row["department"]: row
            for row in qs.values("department").annotate(
                head=Count("id"),
                act=Count("id", filter=Q(employment_status=Employee.EmploymentStatus.ACTIVE)),
            )
        }
        # The rows here are one per department rather than one per person, so
        # narrowing the *people* alone would leave every department on screen
        # with zeroes in it. The department filter has to narrow this list too,
        # or a filter that changes nothing visible reads as a broken one.
        departments = Department.objects.all()
        if self.department is not None:
            departments = departments.filter(pk=self.department)

        rows = []
        for dept in departments:
            row = grouped.get(dept.id)
            rows.append([dept.name, row["head"] if row else 0, row["act"] if row else 0])
        # Only when looking at everybody: "(Unassigned)" is not part of the
        # department somebody asked for.
        unassigned = grouped.get(None) if self.department is None else None
        if unassigned:
            rows.append(["(Unassigned)", unassigned["head"], unassigned["act"]])

        chart = _chart(
            "bars",
            "Headcount by department",
            [{"label": r[0], "value": r[1]} for r in rows],
            unit="person",
        )
        return summary, columns, rows, chart

    def _report_headcount(self, start, end):
        """Who joined, who left, and where the number ended up.

        **The `team` report is a snapshot and cannot answer this.** "How many
        people do we have" and "are we growing" are different questions, and
        the second one is the one a board asks. Joiners come from
        `Employee.date_joined`; leavers from an *applied* resignation or
        termination, because a pending one is a request and counting it reports
        a departure that has not happened.
        """
        joiners = self._people().filter(date_joined__gte=start, date_joined__lte=end)
        exits = self._limit(LifecycleEvent.objects.select_related("employee__user")).filter(
            event_type__in=[
                LifecycleEvent.EventType.RESIGNATION,
                LifecycleEvent.EventType.TERMINATION,
            ],
            status=LifecycleEvent.Status.APPLIED,
            effective_date__gte=start,
            effective_date__lte=end,
        )

        joined_count = joiners.count()
        left_count = exits.count()
        headcount_now = self._people().filter(
            employment_status__in=[
                Employee.EmploymentStatus.ACTIVE,
                Employee.EmploymentStatus.ON_LEAVE,
            ]
        ).count()

        summary = [
            {"label": "Joined", "value": joined_count},
            {"label": "Left", "value": left_count},
            {"label": "Net change", "value": joined_count - left_count},
            {"label": "Headcount now", "value": headcount_now},
        ]

        columns = ["Person", "Movement", "Date", "Department", "Reason"]
        rows = []
        for employee in joiners.select_related("user", "department"):
            rows.append(
                [
                    _name(employee),
                    "Joined",
                    employee.date_joined.isoformat(),
                    employee.department.name if employee.department else "—",
                    "",
                ]
            )
        for event in exits:
            rows.append(
                [
                    _name(event.employee),
                    event.get_event_type_display(),
                    (event.last_working_date or event.effective_date).isoformat(),
                    event.employee.department.name if event.employee.department else "—",
                    # Truncated: a resignation reason can be a paragraph, and a
                    # table cell holding a paragraph destroys the row height for
                    # every other row.
                    (event.reason or "")[:120],
                ]
            )
        rows.sort(key=lambda r: r[2])

        # Net change per month — the shape of the year, which the totals hide.
        # Joins and exits both land on the month they happened in.
        buckets = OrderedDict(
            ((year, month), 0) for year, month in _months_between(start, end)
        )
        for joined in joiners.values_list("date_joined", flat=True):
            key = (joined.year, joined.month)
            if key in buckets:
                buckets[key] += 1
        for event in exits:
            when = event.last_working_date or event.effective_date
            key = (when.year, when.month)
            if key in buckets:
                buckets[key] -= 1
        chart = _chart(
            "columns",
            "Net change by month",
            [
                {"label": f"{MONTH_LABEL[month - 1]} {str(year)[2:]}", "value": value}
                for (year, month), value in buckets.items()
            ],
            unit="person",
        )
        return summary, columns, rows, chart

    # --- time ----------------------------------------------------------------

    def _report_attendance(self, start, end):
        logs = self._limit(AttendanceLog.objects.filter(date__gte=start, date__lte=end))
        by_status = {r["status"]: r["n"] for r in logs.values("status").annotate(n=Count("id"))}
        summary = [
            {"label": "Present", "value": by_status.get("present", 0)},
            {"label": "Late", "value": by_status.get("late", 0)},
            {"label": "Absent", "value": by_status.get("absent", 0)},
            {"label": "Half day", "value": by_status.get("half_day", 0)},
        ]
        columns = ["Employee", "Present", "Late", "Absent", "Half day"]
        agg = (
            logs.values("employee")
            .annotate(
                present=Count("id", filter=Q(status="present")),
                late=Count("id", filter=Q(status="late")),
                absent=Count("id", filter=Q(status="absent")),
                half=Count("id", filter=Q(status="half_day")),
            )
            .order_by("-present")
        )
        emp_map = {e.id: _name(e) for e in self._people()}
        rows = [
            [emp_map.get(a["employee"], "—"), a["present"], a["late"], a["absent"], a["half"]]
            for a in agg
        ]
        # Ranked by lateness, not by attendance. A list of who was present is a
        # list of everybody; the report is read to find the exceptions.
        chart = _chart(
            "bars",
            "Most late arrivals",
            [{"label": r[0], "value": r[2]} for r in rows[:12]],
            unit="day",
        )
        return summary, columns, rows, chart

    def _report_leave(self, start, end):
        reqs = self._limit(
            LeaveRequest.objects.select_related("employee__user", "leave_type")
        ).filter(start_date__lte=end, end_date__gte=start)
        approved = reqs.filter(status="approved")
        days_approved = approved.aggregate(d=Sum("days_requested"))["d"] or Decimal("0")
        summary = [
            {"label": "Requests", "value": reqs.count()},
            {"label": "Approved", "value": approved.count()},
            {"label": "Pending", "value": reqs.filter(status="pending").count()},
            {"label": "Days approved", "value": float(days_approved)},
        ]
        columns = ["Employee", "Type", "From", "To", "Days", "Status"]
        rows = [
            [
                _name(r.employee),
                r.leave_type.name,
                r.start_date.isoformat(),
                r.end_date.isoformat(),
                float(r.days_requested),
                r.get_status_display(),
            ]
            for r in reqs.order_by("-start_date")
        ]
        by_type = (
            approved.values("leave_type__name")
            .annotate(days=Sum("days_requested"))
            .order_by("-days")
        )
        chart = _chart(
            "bars",
            "Approved days by leave type",
            [
                {"label": row["leave_type__name"], "value": float(row["days"] or 0)}
                for row in by_type
            ],
            unit="day",
        )
        return summary, columns, rows, chart

    def _report_wfh(self, start, end):
        reqs = self._limit(WFHRequest.objects.select_related("employee__user")).filter(
            start_date__lte=end, end_date__gte=start
        )
        approved = reqs.filter(status="approved")
        remote_days = sum(r.days for r in approved)
        summary = [
            {"label": "Requests", "value": reqs.count()},
            {"label": "Approved", "value": approved.count()},
            {"label": "Pending", "value": reqs.filter(status="pending").count()},
            {"label": "Remote days (approved)", "value": remote_days},
        ]
        columns = ["Employee", "From", "To", "Days", "Location", "Status"]
        rows = [
            [
                _name(r.employee),
                r.start_date.isoformat(),
                r.end_date.isoformat(),
                r.days,
                r.get_work_location_display(),
                r.get_status_display(),
            ]
            for r in reqs.order_by("-start_date")
        ]
        per_person = {}
        for request in approved:
            per_person[_name(request.employee)] = (
                per_person.get(_name(request.employee), 0) + request.days
            )
        chart = _chart(
            "bars",
            "Remote days by person",
            [
                {"label": label, "value": value}
                for label, value in sorted(per_person.items(), key=lambda kv: -kv[1])[:12]
            ],
            unit="day",
        )
        return summary, columns, rows, chart

    # --- money ---------------------------------------------------------------

    def _report_payroll(self, start, end):
        # A run's month [first, last] overlaps the requested [start, end].
        runs = []
        for r in PayrollRun.objects.all():
            # Through `period_window`, so a report and the payroll it
            # reports on cannot disagree about which days a run covered. Any
            # local derivation is free to drift from it (D‑06).
            month_start, month_end, _ = period_window(r)
            if month_start <= end and month_end >= start:
                runs.append(r)
        columns = ["Period", "Payslips", "Gross", "Deductions", "Net"]
        rows = []
        gross_total = deductions_total = net_total = Decimal("0")
        payslip_total = 0
        for r in runs:
            agg = Payslip.objects.filter(payroll_run=r).aggregate(
                n=Count("id"),
                g=Sum("gross_earnings"),
                d=Sum("total_deductions"),
                net=Sum("net_pay"),
            )
            g = agg["g"] or Decimal("0")
            d = agg["d"] or Decimal("0")
            net = agg["net"] or Decimal("0")
            gross_total += g
            deductions_total += d
            net_total += net
            payslip_total += agg["n"] or 0
            rows.append([r.period_label, agg["n"] or 0, float(g), float(d), float(net)])
        summary = [
            {"label": "Runs", "value": len(runs)},
            {"label": "Payslips", "value": payslip_total},
            {"label": "Gross total", "value": float(gross_total)},
            {"label": "Net total", "value": float(net_total)},
        ]
        # Net paid per period, in period order — a run of months is a sequence,
        # so it gets columns rather than a ranking.
        chart = _chart(
            "columns",
            "Net paid by period",
            [{"label": row[0], "value": row[4]} for row in rows],
            unit="currency",
        )
        return summary, columns, rows, chart

    def _report_expenses(self, start, end):
        """Claims raised in the range, and what happened to them.

        Filtered on `expense_date`, not on when the claim was typed in: a
        December dinner claimed in January belongs to December, which is the
        month somebody is reconciling against.
        """
        claims = self._limit(ExpenseClaim.objects.select_related("employee__user")).filter(
            expense_date__gte=start, expense_date__lte=end
        )
        totals = {
            status: value or Decimal("0")
            for status, value in claims.values_list("status")
            .annotate(total=Sum("amount"))
            .values_list("status", "total")
        }
        approved_value = totals.get(ExpenseClaim.Status.APPROVED, Decimal("0"))
        reimbursed_value = totals.get(ExpenseClaim.Status.REIMBURSED, Decimal("0"))

        summary = [
            {"label": "Claims", "value": claims.count()},
            {"label": "Claimed", "value": float(claims.aggregate(t=Sum("amount"))["t"] or 0)},
            # Approved-but-unpaid is the number that matters: it is money the
            # company owes and has not moved. "Total claimed" includes things
            # that were rejected and will never be paid.
            {"label": "Owed (approved)", "value": float(approved_value)},
            {"label": "Reimbursed", "value": float(reimbursed_value)},
        ]
        columns = ["Employee", "Title", "Category", "Date", "Amount", "Status"]
        rows = [
            [
                _name(claim.employee),
                claim.title,
                claim.get_category_display(),
                claim.expense_date.isoformat(),
                float(claim.amount),
                claim.get_status_display(),
            ]
            for claim in claims.order_by("-expense_date")
        ]
        by_category = claims.values("category").annotate(total=Sum("amount")).order_by("-total")
        labels = dict(ExpenseClaim.Category.choices)
        chart = _chart(
            "bars",
            "Claimed by category",
            [
                {"label": labels.get(row["category"], row["category"]), "value": float(row["total"] or 0)}
                for row in by_category
            ],
            unit="currency",
        )
        return summary, columns, rows, chart

    # --- workplace -----------------------------------------------------------

    def _report_recruitment(self, start, end):
        """Candidates who entered the pipeline in the range.

        **No conversion rates, and the stage counts are occupancy.** `stage` is
        where somebody is *now*, so four people in Screening and three in
        Applied is normal — the four moved on. A funnel drawn over this prints
        percentages above 100, which the dashboard's own hiring card learned
        the hard way.
        """
        candidates = Candidate.objects.select_related("job").filter(
            created_at__date__gte=start, created_at__date__lte=end
        )
        by_stage = {
            row["stage"]: row["n"]
            for row in candidates.values("stage").annotate(n=Count("id"))
        }
        hired = by_stage.get(Candidate.Stage.HIRED, 0)
        summary = [
            {"label": "Candidates", "value": candidates.count()},
            {"label": "Hired", "value": hired},
            {"label": "Declined our offer", "value": by_stage.get(Candidate.Stage.DECLINED, 0)},
            {"label": "Not taken forward", "value": by_stage.get(Candidate.Stage.REJECTED, 0)},
        ]
        columns = ["Candidate", "Role", "Stage", "Source", "Rating", "Applied"]
        rows = [
            [
                candidate.name,
                candidate.job.title,
                candidate.get_stage_display(),
                candidate.source or "—",
                candidate.rating if candidate.rating is not None else "—",
                candidate.created_at.date().isoformat(),
            ]
            for candidate in candidates.order_by("-created_at")
        ]
        labels = dict(Candidate.Stage.choices)
        # In pipeline order, not ranked: applied → screening → interview →
        # offer → hired is a sequence, and sorting it by size destroys the one
        # thing the reader is looking for.
        chart = _chart(
            "columns",
            "Where candidates are now",
            [
                {"label": labels[stage], "value": by_stage.get(stage, 0)}
                for stage in [
                    Candidate.Stage.APPLIED,
                    Candidate.Stage.SCREENING,
                    Candidate.Stage.INTERVIEW,
                    Candidate.Stage.OFFER,
                    Candidate.Stage.HIRED,
                ]
            ],
            unit="candidate",
        )
        return summary, columns, rows, chart

    def _report_training(self, start, end):
        sessions = TrainingSession.objects.select_related("program").filter(
            start_datetime__date__gte=start, start_datetime__date__lte=end
        )
        # Materialised once: the per-session loop below scans this list for
        # each session, and re-evaluating the queryset every pass would be one
        # query per session — the `_report_team` fault in a different shape.
        enrolments = list(
            self._limit(
                Enrollment.objects.select_related("employee__user", "session__program")
            ).filter(session__in=sessions)
        )
        finished = [e for e in enrolments if e.status == Enrollment.Status.COMPLETED]

        summary = [
            {"label": "Sessions", "value": sessions.count()},
            {"label": "Enrolments", "value": len(enrolments)},
            {"label": "Completed", "value": len(finished)},
            # Distinct people, not completions: somebody who finished three
            # courses is one person trained, and counting them three times is
            # how a training budget gets justified with a number that is wrong.
            {"label": "People trained", "value": len({e.employee_id for e in finished})},
        ]
        # A session has no name of its own — it is a run of a programme on a
        # date, which is exactly what `__str__` says — so the programme is the
        # identifying column and the date distinguishes two runs of it.
        columns = ["Programme", "When", "Trainer", "Status", "Enrolled", "Completed"]
        rows = []
        per_programme = {}
        for session in sessions.order_by("start_datetime"):
            session_enrolments = [e for e in enrolments if e.session_id == session.id]
            programme = session.program.title if session.program_id else "—"
            rows.append(
                [
                    programme,
                    session.start_datetime.date().isoformat(),
                    _name(session.trainer) if session.trainer else "—",
                    session.get_status_display(),
                    len(session_enrolments),
                    sum(1 for e in session_enrolments if e.status == Enrollment.Status.COMPLETED),
                ]
            )
            per_programme[programme] = per_programme.get(programme, 0) + len(session_enrolments)
        # Grouped by programme rather than by session: two runs of Fire Safety
        # are the same training, and a chart with a row per date answers "when"
        # when the question is "what".
        chart = _chart(
            "bars",
            "Enrolments by programme",
            [
                {"label": label, "value": value}
                for label, value in sorted(per_programme.items(), key=lambda kv: -kv[1])
            ],
            unit="enrolment",
        )
        return summary, columns, rows, chart

    def _report_assets(self, start, end):
        """What the company owns and who is holding it.

        **A stock report, not a range report** — an asset register describes
        right now, and "laptops we owned in March" is not a question anybody
        asks of it. The dates are accepted and ignored rather than refused, so
        the shared range control above every report still works; saying so here
        is better than silently returning something the caller thinks is
        filtered.
        """
        del start, end

        assets = Asset.objects.select_related("assigned_to__user")
        by_status = {
            row["status"]: row["n"] for row in assets.values("status").annotate(n=Count("id"))
        }
        summary = [
            {"label": "Assets", "value": assets.count()},
            {"label": "Assigned", "value": by_status.get(Asset.Status.ASSIGNED, 0)},
            {"label": "Available", "value": by_status.get(Asset.Status.AVAILABLE, 0)},
            {"label": "In maintenance", "value": by_status.get(Asset.Status.MAINTENANCE, 0)},
        ]
        columns = ["Asset", "Tag", "Category", "Status", "Held by"]
        rows = [
            [
                asset.name,
                asset.asset_tag,
                asset.get_category_display(),
                asset.get_status_display(),
                _name(asset.assigned_to) if asset.assigned_to else "—",
            ]
            for asset in assets
        ]
        by_category = assets.values("category").annotate(n=Count("id")).order_by("-n")
        labels = dict(Asset.Category.choices)
        chart = _chart(
            "bars",
            "Assets by category",
            [
                {"label": labels.get(row["category"], row["category"]), "value": row["n"]}
                for row in by_category
            ],
            unit="asset",
        )
        return summary, columns, rows, chart

    # --- the modules that had no report at all ---------------------------

    def _report_helpdesk(self, start, end):
        """Tickets raised in the range, and how long they took to resolve.

        **Resolution time is measured, not estimated.** `resolved_at` is stored,
        so the age of a closed ticket is a fact rather than a guess from its
        status — and the figure is taken over *resolved* tickets only. Folding
        the open ones in at their current age would drag it with every hour that
        passes and make a quiet week look like a slow one.
        """
        tickets = self._limit(
            Ticket.objects.select_related("requester__user", "assignee__user"),
            field="requester",
        ).filter(created_at__date__gte=start, created_at__date__lte=end)

        resolved = [t for t in tickets if t.resolved_at is not None]
        hours = sorted((t.resolved_at - t.created_at).total_seconds() / 3600 for t in resolved)
        # A median, not a mean: one ticket left open over a holiday doubles a
        # mean and says nothing about the usual case.
        median_hours = hours[len(hours) // 2] if hours else None

        open_now = [t for t in tickets if t.status in ("open", "in_progress")]
        unassigned = [t for t in open_now if t.assignee_id is None]

        summary = [
            {"label": "Raised", "value": tickets.count()},
            {"label": "Still open", "value": len(open_now)},
            # Nobody to chase — the same distinction the onboarding card draws,
            # and for the same reason: following up cannot fix it.
            {"label": "Open, unassigned", "value": len(unassigned)},
            {
                "label": "Typical time to resolve",
                "value": f"{median_hours:.0f}h" if median_hours is not None else "—",
            },
        ]
        columns = ["Ticket", "Category", "Priority", "Status", "Raised by", "Assignee", "Raised"]
        rows = [
            [
                t.subject,
                t.get_category_display(),
                t.get_priority_display(),
                t.get_status_display(),
                _name(t.requester) if t.requester else "—",
                _name(t.assignee) if t.assignee else "Nobody",
                t.created_at.date().isoformat(),
            ]
            for t in tickets.order_by("-created_at")
        ]

        by_category = {}
        for ticket in tickets:
            label = ticket.get_category_display()
            by_category[label] = by_category.get(label, 0) + 1
        chart = _chart(
            "bars",
            "Tickets by category",
            [
                {"label": k, "value": v}
                for k, v in sorted(by_category.items(), key=lambda kv: -kv[1])
            ],
            unit="ticket",
        )
        return summary, columns, rows, chart

    def _report_projects(self, start, end):
        """Project tasks, and what is overdue.

        **Filtered by task date, not project date.** A project runs for months;
        the question "what is late" is about the tasks inside it.

        **A task with no due date is not overdue.** It is unscheduled, and
        counting it as late would invent a commitment nobody made — so it is
        counted in its own figure instead, which is the one somebody can act on.
        """
        tasks = ProjectTask.objects.select_related("project", "assignee__user").filter(
            Q(due_date__gte=start, due_date__lte=end) | Q(due_date__isnull=True)
        )
        done_states = {"done", "cancelled"}
        open_tasks = [t for t in tasks if t.status not in done_states]
        overdue = [t for t in open_tasks if t.due_date is not None and t.due_date < date.today()]
        undated = [t for t in open_tasks if t.due_date is None]

        summary = [
            {"label": "Open tasks", "value": len(open_tasks)},
            {"label": "Overdue", "value": len(overdue)},
            {"label": "No due date", "value": len(undated)},
            {"label": "Unassigned", "value": sum(1 for t in open_tasks if t.assignee_id is None)},
        ]
        columns = ["Task", "Project", "Status", "Assignee", "Due"]
        rows = [
            [
                t.title,
                t.project.name if t.project_id else "—",
                t.get_status_display(),
                _name(t.assignee) if t.assignee else "Nobody",
                t.due_date.isoformat() if t.due_date else "—",
            ]
            for t in tasks.order_by("due_date")
        ]

        by_project = {}
        for task in open_tasks:
            key = task.project.name if task.project_id else "—"
            by_project[key] = by_project.get(key, 0) + 1
        chart = _chart(
            "bars",
            "Open tasks by project",
            [
                {"label": k, "value": v}
                for k, v in sorted(by_project.items(), key=lambda kv: -kv[1])
            ],
            unit="task",
        )
        return summary, columns, rows, chart

    def _report_timesheets(self, start, end):
        """Hours logged in the range, and how much of it is billable.

        **Billable is stored per entry**, so this reports it rather than
        deriving a ratio from project type — which would be wrong for the
        internal work every client project carries.
        """
        entries = self._limit(
            TimeEntry.objects.select_related("employee__user", "project")
        ).filter(date__gte=start, date__lte=end)

        total = entries.aggregate(h=Sum("hours"))["h"] or Decimal("0")
        billable = entries.filter(billable=True).aggregate(h=Sum("hours"))["h"] or Decimal("0")
        approved = entries.filter(status="approved").aggregate(h=Sum("hours"))["h"] or Decimal("0")

        summary = [
            {"label": "Hours logged", "value": float(total)},
            {"label": "Billable", "value": float(billable)},
            {"label": "Approved", "value": float(approved)},
            {"label": "Awaiting approval", "value": entries.filter(status="submitted").count()},
        ]
        columns = ["Employee", "Project", "Date", "Hours", "Billable", "Status"]
        rows = [
            [
                _name(e.employee),
                e.project.name if e.project_id else "—",
                e.date.isoformat(),
                float(e.hours),
                "Yes" if e.billable else "No",
                e.get_status_display(),
            ]
            for e in entries.order_by("-date")
        ]

        per_person = (
            entries.values("employee__user__first_name", "employee__user__last_name")
            .annotate(h=Sum("hours"))
            .order_by("-h")[:12]
        )
        chart = _chart(
            "bars",
            "Hours by person",
            [
                {
                    "label": (
                        f"{r['employee__user__first_name']} {r['employee__user__last_name']}".strip()
                        or "—"
                    ),
                    "value": float(r["h"] or 0),
                }
                for r in per_person
            ],
            unit="hour",
        )
        return summary, columns, rows, chart

    def _report_statutory(self, start, end):
        """What was withheld and contributed per person — the filing sheet.

        Read from `ContributionRecord`, which carries both sides of every scheme
        — employee and employer — keyed on the scheme rather than on a
        renameable salary component.

        **Draft payslips are excluded.** A figure that moves when somebody
        deletes a draft cannot be reconciled against a deposit that has already
        left the bank. That is the rule `payroll.schemes` applies, and it has to
        be the same rule here or the two disagree about the same money.
        """
        from payroll.models import ContributionRecord
        from payroll.schemes import Scheme

        records = self._limit(
            ContributionRecord.objects.select_related("employee__user", "payslip")
        ).exclude(payslip__status=Payslip.Status.DRAFT)

        # Contributions are stamped with the period they belong to, so the range
        # matches on that rather than on when the row happened to be written.
        months = _months_between(start, end)
        if months:
            period_filter = Q()
            for year, month in months:
                period_filter |= Q(period_year=year, period_month=month)
            records = records.filter(period_filter)

        labels = dict(Scheme.CHOICES)
        by_scheme = list(
            records.values("scheme")
            .annotate(employee_total=Sum("employee_amount"), employer_total=Sum("employer_amount"))
            .order_by("scheme")
        )
        employee_total = sum((r["employee_total"] or Decimal("0")) for r in by_scheme)
        employer_total = sum((r["employer_total"] or Decimal("0")) for r in by_scheme)

        summary = [
            {"label": "People", "value": records.values("employee").distinct().count()},
            {"label": "Withheld from pay", "value": float(employee_total)},
            # The company's own liability, which no payslip line could carry —
            # SSF employer contribution is 20% of basic and is not a deduction
            # from anybody.
            {"label": "Employer contribution", "value": float(employer_total)},
            {"label": "Total to remit", "value": float(employee_total + employer_total)},
        ]
        # "Employee" twice — once for the person, once for their share — is
        # ambiguous on the one report somebody reconciles SSF and PF against,
        # and it also gave the table two columns with the same React key. The
        # money columns use the same words as the summary cards above, so the
        # same figure is named the same way in both places.
        columns = [
            "Employee",
            "Scheme",
            "Period",
            "Withheld from pay",
            "Employer contribution",
            "Total",
        ]
        rows = [
            [
                _name(record.employee),
                labels.get(record.scheme, record.scheme),
                f"{record.period_year}-{record.period_month:02d}",
                float(record.employee_amount),
                float(record.employer_amount),
                float(record.employee_amount + record.employer_amount),
            ]
            for record in records.order_by(
                "employee__employee_code", "period_year", "period_month", "scheme"
            )
        ]

        chart = _chart(
            "bars",
            "To remit by scheme",
            [
                {
                    "label": labels.get(r["scheme"], r["scheme"]),
                    "value": float(
                        (r["employee_total"] or Decimal("0"))
                        + (r["employer_total"] or Decimal("0"))
                    ),
                }
                for r in by_scheme
            ],
            unit="currency",
        )
        return summary, columns, rows, chart
