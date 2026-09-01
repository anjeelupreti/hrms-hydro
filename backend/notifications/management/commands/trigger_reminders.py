from django.core.management.base import BaseCommand

from notifications.tasks import (
    fanout_birthday_reminders,
    fanout_configured_reminders,
    fanout_holiday_reminders,
    fanout_work_anniversary_reminders,
)

KINDS = {
    "birthday": fanout_birthday_reminders,
    "anniversary": fanout_work_anniversary_reminders,
    "holiday": fanout_holiday_reminders,
    # Every advance warning the company has configured, in one pass — the
    # rules decide what actually goes out.
    "configured": fanout_configured_reminders,
}


class Command(BaseCommand):
    help = "Dispatches a reminder fan-out task through Celery, for testing without waiting for the Beat schedule."

    def add_arguments(self, parser):
        parser.add_argument("kind", choices=list(KINDS.keys()))

    def handle(self, *args, **options):
        result = KINDS[options["kind"]].delay()
        self.stdout.write(self.style.SUCCESS(f"Dispatched: {result.id}"))
