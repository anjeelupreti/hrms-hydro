from django.core.management.base import BaseCommand

from payroll.tasks import fanout_create_monthly_draft_run


class Command(BaseCommand):
    help = (
        "Dispatches the monthly payroll draft-run fan-out task through Celery "
        "(requires a running celery-worker) — for testing without waiting for Beat."
    )

    def handle(self, *args, **options):
        result = fanout_create_monthly_draft_run.delay()
        self.stdout.write(self.style.SUCCESS(f"Dispatched fanout task: {result.id}"))
