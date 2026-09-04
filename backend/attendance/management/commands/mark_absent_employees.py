from datetime import date

from django.core.management.base import BaseCommand
from django.db.models import Q

from attendance.models import AttendanceLog, ShiftAssignment
from fieldvisits.services import on_visit
from employees.models import Employee


class Command(BaseCommand):
    help = (
        "Marks employees absent for a given date if they have an active "
        "shift assignment (i.e. were scheduled to work) but no attendance "
        "log. Run manually for now; becomes a daily Celery Beat task once "
        "Celery infra exists (Phase 4+)."
    )

    # ── Why the day is checked before anybody is marked ──────────────────
    #
    # A `ShiftAssignment` is a date *range*, not a roster: it says which shift
    # somebody is on, never which days of the week they work. So "has an active
    # assignment and no attendance log" is true of every employee on every
    # Saturday, and marking on that alone marks the whole company absent.
    #
    # That is not cosmetic. `absent_days` feeds `unpaid_days` in
    # `attendance/payroll_summary.py`, which scales pay directly — a
    # Monday-to-Friday company running this daily would accrue roughly nine
    # absences a month per person and cut every salary by about a third.
    #
    # It has never been scheduled, so it has not done this to anybody. But its
    # own help text says it is meant to become a daily task, and the day it does
    # is the day it starts.
    #
    # The working week and the holiday list are both already company
    # configuration. Neither is hardcoded here, for the same reason they are not
    # hardcoded in leave: the working week is not Monday–Friday everywhere and
    # the holidays move year to year.

    def add_arguments(self, parser):
        parser.add_argument("--date", default=None, help="YYYY-MM-DD, defaults to today")

    def handle(self, *args, **options):
        on_date = date.fromisoformat(options["date"]) if options["date"] else date.today()
        self._mark_absent(on_date)

    def _mark_absent(self, on_date):
        from leave.services import holidays_between, is_working_day, working_day_set

        working = working_day_set()
        holidays = holidays_between(on_date, on_date)
        if not is_working_day(on_date, working, holidays):
            self.stdout.write(
                f"{on_date} is not a working day for this company — nobody marked absent."
            )
            return

        scheduled_employee_ids = (
            ShiftAssignment.objects.filter(start_date__lte=on_date)
            .filter(Q(end_date__isnull=True) | Q(end_date__gte=on_date))
            .values_list("employee_id", flat=True)
            .distinct()
        )
        already_logged_ids = AttendanceLog.objects.filter(date=on_date).values_list(
            "employee_id", flat=True
        )
        to_mark = Employee.objects.filter(
            id__in=scheduled_employee_ids,
            employment_status=Employee.EmploymentStatus.ACTIVE,
        ).exclude(id__in=already_logged_ids)

        count = 0
        for employee in to_mark:
            # **Somebody at site is not absent.** An engineer at the headworks
            # for a week has no clock-in for five days, and without this they
            # collect five absences — which feed `unpaid_days` in
            # `attendance/payroll_summary.py` and scale pay directly. So the
            # company would dock the pay of the person it sent.
            #
            # Only an *approved* visit counts; see `fieldvisits.services.on_visit`.
            # **Somebody on approved leave is not absent either.** Same
            # reasoning as the field visit below it: an absence feeds
            # `unpaid_days` and scales pay, so a week of approved annual leave
            # would be docked as five days of not turning up.
            #
            # Recorded as PRESENT with a note saying which leave it was,
            # because there is no ON_LEAVE status on this model — and inventing
            # one is a migration plus every consumer of `status` learning about
            # it. The note carries the distinction, exactly as it does for a
            # visit. Only *approved* leave counts; a pending request is not yet
            # permission to be away.
            leave = _approved_leave(employee, on_date)
            if leave is not None:
                AttendanceLog.objects.create(
                    employee=employee,
                    date=on_date,
                    source=AttendanceLog.Source.SYSTEM,
                    status=AttendanceLog.Status.PRESENT,
                    notes=f"On leave: {leave.leave_type.name}",
                )
                continue

            visit = on_visit(employee, on_date)
            if visit is not None:
                AttendanceLog.objects.create(
                    employee=employee,
                    date=on_date,
                    source=AttendanceLog.Source.SYSTEM,
                    status=AttendanceLog.Status.PRESENT,
                    notes=f"Field visit: {visit.destination}",
                )
                continue
            AttendanceLog.objects.create(
                employee=employee,
                date=on_date,
                source=AttendanceLog.Source.SYSTEM,
                status=AttendanceLog.Status.ABSENT,
            )
            count += 1
        self.stdout.write(self.style.SUCCESS(f"Marked {count} employee(s) absent for {on_date}"))


def _approved_leave(employee, on_date):
    """The approved leave covering this day, or None.

    A module-level helper rather than a method so the roster and any future
    caller can ask the same question the same way — "was this person allowed to
    be away?" is asked in more than one place and should not have two answers.
    """
    from leave.models import LeaveRequest

    return (
        LeaveRequest.objects.select_related("leave_type")
        .filter(
            employee=employee,
            status=LeaveRequest.Status.APPROVED,
            start_date__lte=on_date,
            end_date__gte=on_date,
        )
        .first()
    )
