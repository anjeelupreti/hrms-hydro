from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from core.models import AuditModel
from core.timeline import AbstractTimelineEntry
from employees.models import Employee


class Client(AuditModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"

    name = models.CharField(max_length=200, unique=True)
    industry = models.CharField(max_length=100, blank=True)
    website = models.URLField(blank=True)
    address = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Contact(AuditModel):
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="contacts")
    name = models.CharField(max_length=150)
    title = models.CharField(max_length=100, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.client.name})"


class Deal(AuditModel):
    """Lead/opportunity pipeline. `stage` is the whole point of the kanban
    board — moving a card between columns is just a PATCH to this field."""

    class Stage(models.TextChoices):
        LEAD = "lead", "Lead"
        QUALIFIED = "qualified", "Qualified"
        PROPOSAL = "proposal", "Proposal"
        WON = "won", "Won"
        LOST = "lost", "Lost"

    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="deals")
    title = models.CharField(max_length=200)
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.LEAD)
    value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    expected_close_date = models.DateField(null=True, blank=True)
    owner = models.ForeignKey(
        Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name="deals_owned"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} ({self.client.name})"


# `Project` and `ProjectTask` live in `projects`, not here.
#
# Work done *for* a customer is one kind of project, not the general one: a
# product build or an office move has no client, and a model that requires one
# cannot describe them. CRM keeps what is about selling; work keeps a nullable
# link back this way.


class Invoice(AuditModel):
    """A client invoice — header + line items. Totals are derived from the
    line items (see the serializer), never stored denormalized on the
    header, so they can't drift."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="invoices")
    # By string, because `Project` lives in `projects` now and importing it
    # here would close a cycle: `projects.Project` already points at
    # `crm.Client`.
    project = models.ForeignKey(
        "projects.Project", null=True, blank=True, on_delete=models.SET_NULL, related_name="invoices"
    )
    number = models.CharField(max_length=30, unique=True)
    issue_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    currency = models.CharField(max_length=8, default="NPR")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-issue_date", "-created_at"]

    def __str__(self):
        return self.number

    @property
    def total(self):
        return sum((li.amount for li in self.line_items.all()), start=0)


class InvoiceLineItem(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="line_items")
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.description

    @property
    def amount(self):
        return self.quantity * self.unit_price


class Activity(AuditModel):
    """A logged interaction (call/email/meeting/note) — generically
    linkable to a Client, Contact, or Deal via ContentType, same pattern
    as documents.Document, rather than three mostly-null FK columns."""

    class ActivityType(models.TextChoices):
        CALL = "call", "Call"
        EMAIL = "email", "Email"
        MEETING = "meeting", "Meeting"
        NOTE = "note", "Note"

    activity_type = models.CharField(max_length=20, choices=ActivityType.choices, default=ActivityType.NOTE)
    notes = models.TextField(blank=True)
    occurred_at = models.DateTimeField()
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveBigIntegerField()
    related_object = GenericForeignKey("content_type", "object_id")

    class Meta:
        ordering = ["-occurred_at"]
        indexes = [models.Index(fields=["content_type", "object_id"])]

    def __str__(self):
        return f"{self.activity_type} @ {self.occurred_at}"


class TimelineEntry(AbstractTimelineEntry):
    """The company-side timeline — deals, clients, and the client desk.

    Concrete here rather than in `core` because `core` is a SHARED_APP: a table
    there lives once in the public schema, and the company's notes would share
    it. That is the isolation violation this product exists to prevent, so the
    shape is inherited and the table is per-company.
    """

    actor = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta(AbstractTimelineEntry.Meta):
        indexes = [
            # The only query that matters: one subject's history, newest first.
            models.Index(fields=["content_type", "object_id", "-created_at"]),
        ]


class ClientTicket(AuditModel):
    """A concern raised by a client, sitting beside their record.

    **Why here and not in `helpdesk`.** The requester is a `Client` or a
    `Contact` — the same people this module already tracks as leads and deals —
    so clicking a client shows their deals *and* their open concerns in one
    place. `helpdesk` stays internal: an employee reporting a broken chair is a
    different queue with a different audience, different privacy rules and
    different metrics.

    One model serving both would need a requester that is sometimes an employee
    and sometimes a customer — a nullable pair of foreign keys and a permission
    rule nobody can hold in their head — and the first mistake it produces is a
    customer's complaint appearing in the staff IT queue.

    **A ticket is unintentional.** Unlike a `Deal`, nobody chose to start it, so
    what matters is how fast it is answered rather than how far it has
    progressed. That is why this carries response and resolution clocks and a
    `Deal` carries a value.
    """

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        NORMAL = "normal", "Normal"
        HIGH = "high", "High"
        URGENT = "urgent", "Urgent"

    class Channel(models.TextChoices):
        PORTAL = "portal", "Client portal"
        EMAIL = "email", "Email"
        PHONE = "phone", "Phone"
        INTERNAL = "internal", "Logged by staff"

    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="tickets")
    # Optional: a company can raise a ticket without naming an individual, and
    # requiring a contact would push people into inventing one.
    contact = models.ForeignKey(
        Contact, null=True, blank=True, on_delete=models.SET_NULL, related_name="tickets"
    )

    reference = models.CharField(
        max_length=20, unique=True,
        help_text="Quoted back to the client — 'about ticket CT-0042' has to mean something.",
    )
    subject = models.CharField(max_length=200)
    description = models.TextField(blank=True)

    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.NORMAL)
    channel = models.CharField(max_length=20, choices=Channel.choices, default=Channel.INTERNAL)
    # Values come from `core.statusflow.TICKET_FLOW`, which owns the legal moves.
    status = models.CharField(max_length=20, default="open")

    assignee = models.ForeignKey(
        Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name="client_tickets"
    )

    # ── The clocks ───────────────────────────────────────────────────────
    #
    # Two, not one, because they answer different questions. "Somebody is
    # looking at this" and "this is over" are separate promises, and a desk that
    # only measures the second has no way to tell a client their problem has
    # been picked up.
    first_response_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    # Targets are snapshotted from the SLA policy when the ticket is created, so
    # changing the policy next month cannot retroactively put past tickets in
    # breach — or quietly rescue them from it.
    response_due_at = models.DateTimeField(null=True, blank=True)
    resolution_due_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # The queue view: open tickets by priority, oldest first.
            models.Index(fields=["status", "priority", "created_at"]),
            models.Index(fields=["client", "status"]),
        ]

    def __str__(self):
        return f"{self.reference}: {self.subject}"

    @property
    def response_breached(self):
        """Nobody replied in time.

        False once a response exists, even a late one — the breach is recorded
        by comparing the two timestamps, and a flag that stayed true forever
        would make "currently breaching" impossible to ask.
        """
        if self.response_due_at is None:
            return False
        if self.first_response_at is not None:
            return self.first_response_at > self.response_due_at
        from django.utils import timezone

        return timezone.now() > self.response_due_at

    @property
    def resolution_breached(self):
        if self.resolution_due_at is None:
            return False
        if self.resolved_at is not None:
            return self.resolved_at > self.resolution_due_at
        from django.utils import timezone

        return timezone.now() > self.resolution_due_at


class SLAPolicy(AuditModel):
    """How fast a ticket of a given priority should be answered.

    Per company and per priority, because "urgent" means four hours to one
    customer and one hour to another, and hardcoding either makes the product
    wrong for the other. Stored in hours rather than a duration so the settings
    screen is a number box.
    """

    priority = models.CharField(
        max_length=20, choices=ClientTicket.Priority.choices, unique=True
    )
    response_hours = models.PositiveIntegerField(
        default=8, help_text="Hours to first response — somebody is looking at it."
    )
    resolution_hours = models.PositiveIntegerField(
        default=72, help_text="Hours to resolution — the problem is over."
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["priority"]
        verbose_name_plural = "SLA policies"

    def __str__(self):
        return f"{self.get_priority_display()}: {self.response_hours}h / {self.resolution_hours}h"
