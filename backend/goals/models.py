from django.db import models

from core.models import AuditModel
from core.archiving import ArchivableModel


class Objective(ArchivableModel, AuditModel):
    """An OKR objective — either an individual's (owner set) or a company-wide
    one (owner null). Progress is derived from its key results, never stored
    directly. Sits alongside Performance Reviews (organization app) as the
    forward-looking goals half of performance."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    owner = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.CASCADE, related_name="objectives"
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    period = models.CharField(max_length=40, blank=True, help_text="Free-form, e.g. 'Q3 2026'")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title

    @property
    def progress(self):
        krs = list(self.key_results.all())
        if not krs:
            return 0
        return round(sum(kr.progress for kr in krs) / len(krs))


class KeyResult(AuditModel):
    """A measurable result under an objective. Progress = current/target as a
    clamped 0–100%. `unit` is cosmetic (%, $, users, …)."""

    objective = models.ForeignKey(Objective, on_delete=models.CASCADE, related_name="key_results")
    title = models.CharField(max_length=255)
    start_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    target_value = models.DecimalField(max_digits=14, decimal_places=2, default=100)
    current_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    unit = models.CharField(max_length=20, blank=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.title

    @property
    def progress(self):
        start = float(self.start_value)
        target = float(self.target_value)
        current = float(self.current_value)
        denom = target - start
        if denom == 0:
            # No range defined: treat reaching/ passing target as done.
            return 100 if current >= target else 0
        pct = (current - start) / denom * 100
        return max(0, min(100, round(pct)))
