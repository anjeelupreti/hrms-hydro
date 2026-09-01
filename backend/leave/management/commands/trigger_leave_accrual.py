from django.core.management.base import BaseCommand

from leave.tasks import fanout_annual_leave_accrual


class Command(BaseCommand):
    help = (
        "Dispatches the annual leave accrual fan-out task through Celery "
        "(requires a running celery-worker) — for testing the real "
        "Celery path, as opposed to calling the task function directly."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--force", action="store_true", help="Run even if today isn't the Jan 1 reset day"
        )

    def handle(self, *args, **options):
        result = fanout_annual_leave_accrual.delay(force=options["force"])
        self.stdout.write(self.style.SUCCESS(f"Dispatched fanout task: {result.id}"))
