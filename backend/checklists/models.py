from django.db import models
from django.utils import timezone

from core.models import AuditModel
from core.archiving import ArchivableModel


class Kind(models.TextChoices):
    ONBOARDING = "onboarding", "Onboarding"
    OFFBOARDING = "offboarding", "Offboarding"


class ChecklistTemplate(AuditModel):
    """A reusable onboarding/offboarding task list HR defines once and runs
    for each new hire / leaver — the templated-checklist half of the
    lifecycle story (the lifecycle *events* themselves live in employees)."""

    name = models.CharField(max_length=200)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.ONBOARDING)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["kind", "name"]

    def __str__(self):
        return f"{self.get_kind_display()}: {self.name}"


class ChecklistTemplateItem(AuditModel):
    template = models.ForeignKey(ChecklistTemplate, on_delete=models.CASCADE, related_name="items")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveSmallIntegerField(default=0)
    # Due N days after the checklist is started (negative = before, e.g. an
    # offboarding task due 2 days before the last working day).
    due_offset_days = models.IntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.title


class Checklist(ArchivableModel, AuditModel):
    """A template instantiated for one employee — the live run with its own
    task rows, independent of the template after creation."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="checklists"
    )
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.ONBOARDING)
    template = models.ForeignKey(
        ChecklistTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name="checklists"
    )
    title = models.CharField(max_length=200)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} — {self.employee_id}"

    def refresh_status(self):
        """Auto-complete once every task is done (and there is at least one)."""
        tasks = list(self.tasks.all())
        done = all(t.status == ChecklistTask.Status.DONE for t in tasks)
        if tasks and done and self.status == self.Status.ACTIVE:
            self.status = self.Status.COMPLETED
            self.save(update_fields=["status"])
        elif self.status == self.Status.COMPLETED and not done:
            self.status = self.Status.ACTIVE
            self.save(update_fields=["status"])


class ChecklistTask(AuditModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        DONE = "done", "Done"

    checklist = models.ForeignKey(Checklist, on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveSmallIntegerField(default=0)
    assignee = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="assigned_checklist_tasks",
    )
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.title

    def mark(self, done):
        self.status = self.Status.DONE if done else self.Status.PENDING
        self.completed_at = timezone.now() if done else None
        self.save(update_fields=["status", "completed_at"])
