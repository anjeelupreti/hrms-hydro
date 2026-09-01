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
    #: The desk this ticket is *for*, as opposed to the person working it.
    #:
    #: **Two fields, because they answer different questions and change at
    #: different times.** A ticket is raised *at* somebody — IT, HR, Finance,
    #: the site electrical team — and that is chosen by the person raising it,
    #: who knows what their problem is about and not who is on shift. The
    #: assignee is chosen afterwards, by whoever runs that desk, and changes
    #: again when it is handed on or somebody is on leave.
    #:
    #: With only an assignee, a new ticket has to be routed by whoever happens
    #: to look at the unassigned queue — so it either sits there, or lands on
    #: one person who becomes the routing table.
    target_department = models.ForeignKey(
        "employees.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="helpdesk_tickets",
        help_text="Which desk this is for. Chosen when the ticket is raised.",
    )
    #: Anybody else who needs to see it — the person's manager, a second
    #: engineer, the site chief. They are not handling it, so this is not a
    #: second assignee; it is who else the notifications go to and who else can
    #: read a ticket that is otherwise private to the two parties.
    watchers = models.ManyToManyField(
        "employees.Employee",
        blank=True,
        related_name="watched_tickets",
        help_text="Also kept in the loop. Not handling it.",
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
