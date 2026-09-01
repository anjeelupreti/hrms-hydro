from django.core.management.base import BaseCommand
from django.utils import timezone

from attendance.models import AttendanceDeviceEvent, AttendanceLog
from attendance.policy import allows
from attendance.punches import PunchError, close_session, open_session
from employees.models import Employee


class Command(BaseCommand):
    help = (
        "Processes unprocessed AttendanceDeviceEvent rows into AttendanceLog "
        "entries. Simulates what a real biometric-device sync would trigger "
        "periodically; run manually for now, wire up as a Celery Beat "
        "periodic task once Celery infra exists (Phase 4+)."
    )

    def handle(self, *args, **options):
        self._process()

    def _process(self):
        processed, failed = 0, 0
        for event in AttendanceDeviceEvent.objects.filter(processed=False):
            error = self._apply(event)
            if error:
                event.error = error
                event.save(update_fields=["error"])
                failed += 1
            else:
                event.processed = True
                event.processed_at = timezone.now()
                event.error = ""
                event.save(update_fields=["processed", "processed_at", "error"])
                processed += 1
        self.stdout.write(self.style.SUCCESS(f"Processed {processed}, failed {failed}"))

    def _apply(self, event):
        try:
            employee = Employee.objects.get(employee_code=event.external_employee_id)
        except Employee.DoesNotExist:
            return f"No employee found with code '{event.external_employee_id}'"

        # A device the company has switched off must not keep writing attendance
        # through a webhook nobody is watching. The event stays on the queue
        # with its reason recorded rather than being silently dropped, so
        # turning biometric back on does not require explaining a gap.
        if not allows(AttendanceLog.Source.BIOMETRIC, employee=employee):
            return "This company does not accept biometric attendance"

        # Through the same service the web punch uses: a reader by the door
        # and a button in the browser are the same act, and both have to open a
        # session rather than write one record per date. One-per-date refuses
        # the second swipe, so a walk to the bank costs somebody their
        # afternoon.
        try:
            if event.event_type == AttendanceDeviceEvent.EventType.CHECK_IN:
                open_session(
                    employee, source=AttendanceLog.Source.BIOMETRIC, at=event.raw_timestamp
                )
            else:
                close_session(employee, at=event.raw_timestamp)
        except PunchError as exc:
            # Held with its reason rather than dropped: a device that replays an
            # event, or swipes out twice, is a fact worth being able to look up.
            return str(exc)
        return None
