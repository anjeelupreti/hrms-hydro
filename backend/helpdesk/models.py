from django.db import models

from core.models import AuditModel


class Ticket(AuditModel):
    """An internal help request (IT/HR/facilities/…). `created_by`
    (AuditModel) is the requester; `assignee` is the HR/support person
    handling it. Comments form the conversation thread."""

    class Category(models.TextChoices):
        IT = "it", "IT"
        HR = "hr", "HR"
        FACILITIES = "facilities", "Facilities"
        PAYROLL = "payroll", "Payroll"
        OTHER = "other", "Other"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        URGENT = "urgent", "Urgent"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        IN_PROGRESS = "in_progress", "In progress"
        RESOLVED = "resolved", "Resolved"
        CLOSED = "closed", "Closed"

    subject = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    requester = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="tickets_raised"
    )
    assignee = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="tickets_assigned"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"#{self.pk} {self.subject}"


class TicketComment(AuditModel):
    """A reply on a ticket. `created_by` is the author."""

    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="comments")
    body = models.TextField()

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"comment on #{self.ticket_id}"
