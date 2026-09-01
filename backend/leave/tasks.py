from datetime import date

from celery import shared_task

from core.calendars import company_calendar, fiscal_year_for
from employees.models import Employee
from leave.models import LeaveType
from leave.services import allocation_for, get_or_create_balance


@shared_task
def apply_annual_leave_accrual(force=False):
    """Allocate the new year's balance and carry forward what is allowed.

    **Runs on the fiscal new year, not 1 January.** An entitlement here runs
    Shrawan→Ashad, so resetting on 1 January would hand everybody a fresh
    allocation halfway through the year they are actually in, and carry forward
    from a year that had not ended.

    The balances are keyed the same way `submit_leave_request` keys them —
    which is the whole point. These two were written months apart and each
    picked its own answer for "which year is this?", so the rollover wrote rows
    the request path never read. One `fiscal_year_for`, no second opinion.

    `force=True` is for the management command and tests, so an on-demand run
    does not require waiting for Shrawan.
    """
    today = date.today()
    new_year = fiscal_year_for(today)

    if not force:
        try:
            opens_on, _ = company_calendar().fiscal_year_bounds(new_year)
        except Exception:  # noqa: BLE001 — an edge of the conversion table
            opens_on = None
        if opens_on != today:
            return "not the fiscal new year, skipped"

    previous_year = new_year - 1
    count = 0
    for employee in Employee.objects.filter(employment_status=Employee.EmploymentStatus.ACTIVE):
        for leave_type in LeaveType.objects.all():
            carried_forward = 0
            if leave_type.carry_forward_allowed:
                from leave.models import LeaveBalance

                previous = LeaveBalance.objects.filter(
                    employee=employee, leave_type=leave_type, year=previous_year
                ).first()
                if previous:
                    carried_forward = min(previous.remaining_days, leave_type.max_carry_forward_days)
                    carried_forward = max(carried_forward, 0)

            balance = get_or_create_balance(employee, leave_type, new_year)
            # Same proration the request path uses. Somebody who joined two
            # months before the year turned gets their share of the old year
            # and the whole of the new one — but only because the new year is
            # a full year for them, which `allocation_for` works out itself.
            balance.allocated_days = allocation_for(leave_type, employee, new_year)
            balance.carried_forward_days = carried_forward
            balance.save(update_fields=["allocated_days", "carried_forward_days"])
            count += 1
    return f"processed {count} employee/leave-type balance(s) for {new_year}"

