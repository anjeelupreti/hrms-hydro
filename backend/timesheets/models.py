from django.db import models

from core.models import AuditModel


class TimeEntry(AuditModel):
    """Hours an employee logged against a project on a given day. Kept
    simple and approvable (draft-free: entries start submitted, HR approves/
    rejects) so the data can later feed billing/payroll without a redesign."""

    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="time_entries"
    )
    # `projects.*`, not `crm.*`. The models moved app; the tables did not, so
    # these still point at exactly the same rows they always did.
    #
    # **PROTECT, not CASCADE.** These are approved hours — in most cases hours
    # somebody has already been paid for, and in a client project hours that
    # have been invoiced. Under CASCADE, deleting a finished project silently
    # destroyed them, and the API is not the only way in: a shell session or
    # the admin would have done it too. A project is cancelled or put on hold
    # rather than deleted (see `Project`), so this constraint should never be
    # reached through normal use — which is exactly the property that makes it
    # worth having.
    project = models.ForeignKey(
        "projects.Project", on_delete=models.PROTECT, related_name="time_entries"
    )
    task = models.ForeignKey(
        "projects.ProjectTask", null=True, blank=True, on_delete=models.SET_NULL, related_name="time_entries"
    )
    date = models.DateField()
    hours = models.DecimalField(max_digits=5, decimal_places=2)
    description = models.CharField(max_length=255, blank=True)
    billable = models.BooleanField(default=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)
    decided_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        indexes = [models.Index(fields=["employee", "date"]), models.Index(fields=["project", "date"])]

    def __str__(self):
        return f"{self.employee_id} · {self.project_id} · {self.date} · {self.hours}h"
