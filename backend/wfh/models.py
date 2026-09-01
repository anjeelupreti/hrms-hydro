from django.conf import settings
from django.db import models

from core.models import AuditModel
from employees.models import Employee


class WFHRequest(AuditModel):
    """A request to work from home / remotely for a date range. Approved by
    HR or the employee's manager. Distinct from leave (the person is still
    working) — so it doesn't touch leave balances; it's tracked separately
    for the remote-operations view."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    class WorkLocation(models.TextChoices):
        HOME = "home", "Home"
        REMOTE = "remote", "Remote (other)"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="wfh_requests")
    start_date = models.DateField()
    end_date = models.DateField()
    work_location = models.CharField(max_length=20, choices=WorkLocation.choices, default=WorkLocation.HOME)
    location_note = models.CharField(max_length=150, blank=True, help_text="e.g. Pokhara, parents' home")
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-start_date"]

    def __str__(self):
        return f"{self.employee.employee_code} WFH {self.start_date}–{self.end_date} ({self.status})"

    @property
    def days(self):
        return (self.end_date - self.start_date).days + 1
