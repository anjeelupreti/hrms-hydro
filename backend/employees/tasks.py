from datetime import date

from celery import shared_task

from employees.models import LifecycleEvent
from employees.services import apply_event


@shared_task
def apply_due_lifecycle_events():
    """Apply approved lifecycle events whose effective date has arrived.

    An event approved with an effective date of today or earlier is applied at
    approval time (see `employees.services.decide`). This daily sweep exists
    for the future-dated ones, which sit untouched until their day comes.
    """
    today = date.today()
    due = LifecycleEvent.objects.filter(status=LifecycleEvent.Status.APPROVED, effective_date__lte=today)
    count = 0
    for event in due:
        apply_event(event)
        count += 1
    return f"applied {count} due lifecycle event(s)"

