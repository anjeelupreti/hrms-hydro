"""Everything about me, in one place.

**Why an aggregate rather than more endpoints.** Every fact here is already
reachable — attendance, leave, payslips, tasks, trainings. What did not exist
was a single answer, so an employee's own view of themselves meant visiting
eight pages and holding the total in their head, and the frontend meant eight
requests to render one screen.

**Scoped to the caller, always.** Every query below is filtered by the employee
resolved from the session, never from a parameter. There is no employee id to
tamper with, which is the only reliable way to keep a self-service surface
self-service.

**Fiscal-year aware.** Leave balances, attendance rates and earnings are all
year-bounded figures, and in Nepal the year is Shrawan→Ashad rather than
January→December. Reporting them against a calendar year would be wrong for
the company this product is built for.
"""

from datetime import date
from decimal import Decimal

from core.calendars import get_calendar, company_calendar


def _fiscal_bounds(fiscal_year=None, calendar_key=None):
    """Gregorian start and end of a fiscal year, plus its label.

    Uses **the company's chosen calendar** unless a caller names one. This
    defaulted to `"BS"`, which answered for a company that had never been asked
    — so a company running January–December saw their own portal report a
    Shrawan–Ashad year they do not use.

    Falls back to the calendar year if the calendar cannot place the date — a
    portal that refuses to render because a conversion table has edges would be
    worse than one showing a Gregorian year.
    """
    calendar = get_calendar(calendar_key) if calendar_key else company_calendar()
    try:
        if fiscal_year is None:
            fiscal_year = calendar.fiscal_year_of(date.today())
        start, end = calendar.fiscal_year_bounds(fiscal_year)
        return start, end, calendar.fiscal_year_label(fiscal_year), fiscal_year
    except Exception:  # noqa: BLE001 — see the docstring
        year = fiscal_year or date.today().year
        return date(year, 1, 1), date(year, 12, 31), str(year), year


def _attendance_block(employee, start, end):
    from attendance.models import AttendanceLog

    logs = AttendanceLog.objects.filter(employee=employee, date__gte=start, date__lte=end)
    counts = {"present": 0, "late": 0, "absent": 0, "half_day": 0}
    for status_value in logs.values_list("status", flat=True):
        if status_value in counts:
            counts[status_value] += 1

    logged = sum(counts.values())
    # Late counts as attended — somebody who arrived at 09:20 was at work, and
    # an attendance rate that says otherwise misrepresents them.
    attended = counts["present"] + counts["late"] + counts["half_day"]
    return {
        **counts,
        "days_logged": logged,
        "attendance_rate": (
            round(attended / logged * 100, 1) if logged else None
        ),
        "punctuality_rate": (
            round(counts["present"] / logged * 100, 1) if logged else None
        ),
    }


def _leave_block(employee, start, end, fiscal_year):
    from leave.models import LeaveBalance, LeaveRequest

    balances = (
        LeaveBalance.objects.filter(employee=employee, year=fiscal_year)
        .select_related("leave_type")
    )
    by_type = [
        {
            "leave_type": b.leave_type.name,
            "allocated": b.allocated_days,
            "carried_forward": b.carried_forward_days,
            "used": b.used_days,
            "remaining": (b.allocated_days + b.carried_forward_days - b.used_days),
        }
        for b in balances
    ]

    requests = LeaveRequest.objects.filter(
        employee=employee, start_date__lte=end, end_date__gte=start
    ).select_related("leave_type")

    taken = {"paid": Decimal("0"), "unpaid": Decimal("0")}
    pending = 0
    for request in requests:
        if request.status == LeaveRequest.Status.PENDING:
            pending += 1
            continue
        if request.status != LeaveRequest.Status.APPROVED:
            continue
        taken["paid" if request.is_paid else "unpaid"] += request.days_requested

    return {
        "balances": by_type,
        "taken_paid_days": taken["paid"],
        "taken_unpaid_days": taken["unpaid"],
        "pending_requests": pending,
        # Summed from the balances rather than counted from requests: a balance
        # is the authoritative figure, and deriving it twice invites the two to
        # disagree on screen.
        "total_remaining": sum((b["remaining"] for b in by_type), Decimal("0")),
    }


def _pay_block(employee, start, end):
    # Imported inside the function, like `Payslip` above it — accounts is
    # imported by payroll, so a module-level import would close a cycle.
    from payroll.models import Payslip
    from payroll.periods import period_window

    payslips = (
        Payslip.objects.filter(employee=employee)
        .exclude(status=Payslip.Status.DRAFT)
        .select_related("payroll_run")
        .order_by("-payroll_run__period_year", "-payroll_run__period_month")
    )
    # Through `period_window` (D‑06). This built a Gregorian date out of the
    # run's two numbers, which on a Bikram Sambat company lands in year 2083 —
    # never inside the fiscal year being summed, so the portal reported that
    # every employee had earned nothing all year.
    in_year = [
        p for p in payslips
        if start <= period_window(p.payroll_run)[0] <= end
    ]

    latest = payslips.first()
    return {
        "latest": (
            {
                "period": latest.payroll_run.period_label,
                "net_pay": latest.net_pay,
                "status": latest.status,
                "is_held": latest.is_held,
                "paid_at": latest.paid_at,
            }
            if latest else None
        ),
        "payslip_count": len(in_year),
        "gross_earned": sum((p.gross_earnings for p in in_year), Decimal("0")),
        "net_earned": sum((p.net_pay for p in in_year), Decimal("0")),
        "deductions": sum((p.total_deductions for p in in_year), Decimal("0")),
    }


def _work_block(employee):
    """Tasks and trainings assigned to this person, open ones first.

    Counts rather than lists: the portal shows "4 open tasks" and links onward.
    Embedding the full list here would make the endpoint grow with somebody's
    backlog, and the page cannot show it all anyway.
    """
    from checklists.models import ChecklistTask
    from projects.models import ProjectTask

    open_checklist = ChecklistTask.objects.filter(
        assignee=employee, status=ChecklistTask.Status.PENDING
    ).count()
    onboarding = ChecklistTask.objects.filter(
        checklist__employee=employee, status=ChecklistTask.Status.PENDING
    ).count()
    # `exclude(status=DONE)`, not `status=TODO`. A task has five states and
    # "not finished" is every one of them except done — blocked and in-review
    # are still on somebody's plate.
    open_project = (
        ProjectTask.objects.filter(assignee=employee)
        .exclude(status=ProjectTask.Status.DONE)
        .count()
    )

    return {
        "open_checklist_tasks": open_checklist,
        "my_onboarding_tasks": onboarding,
        "open_project_tasks": open_project,
    }


def _requests_block(employee):
    """Everything this person has asked for and is waiting on.

    One count of *pending things about me*, which is the question behind "is
    anything of mine stuck" — a question no single existing page answers.
    """
    from attendance.models import OvertimeRecord, RegularisationRequest
    from expenses.models import ExpenseClaim
    from leave.models import LeaveRequest
    from wfh.models import WFHRequest

    pending = {
        "leave": LeaveRequest.objects.filter(
            employee=employee, status=LeaveRequest.Status.PENDING
        ).count(),
        "regularisation": RegularisationRequest.objects.filter(
            employee=employee, status=RegularisationRequest.Status.PENDING
        ).count(),
        "overtime": OvertimeRecord.objects.filter(
            employee=employee, status=OvertimeRecord.Status.PENDING
        ).count(),
    }
    # Enum members rather than the string "pending": a status renamed in either
    # app would then break loudly at import instead of silently counting zero
    # here, which is how a portal quietly stops telling somebody their claim is
    # stuck.
    pending["expenses"] = ExpenseClaim.objects.filter(
        employee=employee, status=ExpenseClaim.Status.PENDING
    ).count()
    pending["wfh"] = WFHRequest.objects.filter(
        employee=employee, status=WFHRequest.Status.PENDING
    ).count()

    return {"pending": pending, "total_pending": sum(pending.values())}


def portal_summary(employee, fiscal_year=None, calendar_key=None):
    """The whole self-service picture for one person, for one fiscal year."""
    start, end, label, resolved_year = _fiscal_bounds(fiscal_year, calendar_key)

    user = employee.user
    tenure_days = (date.today() - employee.date_joined).days

    return {
        "fiscal_year": {"year": resolved_year, "label": label, "start": start, "end": end},
        "me": {
            "employee_code": employee.employee_code,
            "name": user.get_full_name() or user.get_username(),
            "email": user.email,
            "designation": employee.designation.title if employee.designation else None,
            "department": employee.department.name if employee.department else None,
            "manager": (
                employee.manager.user.get_full_name() or employee.manager.user.get_username()
            ) if employee.manager else None,
            "date_joined": employee.date_joined,
            # Stated in whole years and days rather than a decimal: "1 year,
            # 214 days" is how anybody actually says it.
            "tenure_years": tenure_days // 365,
            "tenure_days": tenure_days,
            "employment_status": employee.employment_status,
            "on_probation": employee.is_on_probation(date.today()),
        },
        "attendance": _attendance_block(employee, start, end),
        "leave": _leave_block(employee, start, end, resolved_year),
        "pay": _pay_block(employee, start, end),
        "work": _work_block(employee),
        "requests": _requests_block(employee),
    }
