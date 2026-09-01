from celery import shared_task
from django.utils import timezone

from employees.models import Employee
from notifications.models import Holiday
from notifications.services import notify


@shared_task
def send_birthday_reminders():
    today = timezone.localdate()
    employees = Employee.objects.filter(
        employment_status=Employee.EmploymentStatus.ACTIVE,
        date_of_birth__month=today.month,
        date_of_birth__day=today.day,
    ).select_related("user", "manager__user")

    for employee in employees:
        name = employee.user.get_full_name() or employee.user.get_username()
        notify(
            employee.user,
            "birthday",
            f"Happy Birthday, {name}! Wishing you a great day from the whole team.",
            email_subject="Happy Birthday!",
        )
        if employee.manager:
            notify(
                employee.manager.user,
                "birthday_report",
                f"Today is {name}'s birthday — a quick note from you would go a long way.",
                email_subject="Today's birthday on your team",
            )
    return f"notified {employees.count()} birthday(s)"


@shared_task
def send_work_anniversary_reminders():
    today = timezone.localdate()
    employees = Employee.objects.filter(
        employment_status=Employee.EmploymentStatus.ACTIVE,
        date_joined__month=today.month,
        date_joined__day=today.day,
    ).select_related("user", "manager__user")

    count = 0
    for employee in employees:
        years = today.year - employee.date_joined.year
        if years <= 0:
            continue  # joined this same year — not an anniversary yet
        name = employee.user.get_full_name() or employee.user.get_username()
        notify(
            employee.user,
            "work_anniversary",
            f"Happy {years}-year work anniversary, {name}! Thank you for everything you bring to the team.",
            email_subject="Happy work anniversary!",
        )
        count += 1
    return f"notified {count} work anniversary(ies)"


@shared_task
def send_holiday_reminders():
    """The greeting on the morning of the holiday itself.

    **Stands down when the configurable rule already covers today.** Since
    `holiday_upcoming` gained lead times, adding `0` to it is asking for a
    message on the day — and would have produced two, this one and that one.
    The configured rule wins, because somebody chose its wording.

    Kept rather than deleted for the default case: the default leads are `[7]`,
    so without this the greeting would silently stop.
    """
    today = timezone.localdate()
    holiday = Holiday.objects.filter(date=today).first()
    if holiday is None:
        return "no holiday today"

    from notifications.models import ReminderRule

    rule = ReminderRule.objects.filter(kind="holiday_upcoming", is_enabled=True).first()
    if rule is not None and 0 in rule.offsets():
        return "same-day covered by the configured reminder"

    employees = Employee.objects.filter(employment_status=Employee.EmploymentStatus.ACTIVE).select_related("user")
    for employee in employees:
        notify(
            employee.user,
            "holiday",
            f"Today is {holiday.name} — enjoy the holiday!",
            email_subject=f"Holiday today: {holiday.name}",
        )
    return f"notified {employees.count()} employee(s) about {holiday.name}"


@shared_task
def send_configured_reminders():
    """Fire the configured reminder rules.

    One task for every kind of advance warning, rather than one per kind. The
    rules decide what goes out; adding a new thing to remind about is a registry
    entry in `notifications.reminders`, not a fifth beat entry.
    """
    from notifications.reminders import run_reminders

    summary = run_reminders()
    return f"sent {summary['sent']}, already sent {summary['already_sent']}"

