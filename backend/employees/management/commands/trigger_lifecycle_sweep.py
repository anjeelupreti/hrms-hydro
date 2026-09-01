from django.core.management.base import BaseCommand

from employees.tasks import fanout_apply_due_lifecycle_events


class Command(BaseCommand):
    help = (
        "Dispatches the due-lifecycle-events fan-out task through Celery "
        "(requires a running celery-worker) — for testing without waiting for Beat."
    )

    def handle(self, *args, **options):
        result = fanout_apply_due_lifecycle_events.delay()
        self.stdout.write(self.style.SUCCESS(f"Dispatched fanout task: {result.id}"))
