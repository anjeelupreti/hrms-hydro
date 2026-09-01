from django.conf import settings
from django.db import models

from core.models import AuditModel
from employees.models import Employee


def receipt_upload_path(instance, filename):
    # Company-namespaced, same reasoning as documents.document_upload_path.
    return f"expenses/{instance.employee_id}/{filename}"


class ExpenseClaim(AuditModel):
    """An employee's reimbursement claim. Submit -> HR approves/rejects ->
    HR marks reimbursed (manual record, same 'we don't move money'
    principle as payroll disbursement). Employee can cancel their own
    while still pending."""

    class Category(models.TextChoices):
        TRAVEL = "travel", "Travel"
        MEALS = "meals", "Meals"
        SUPPLIES = "supplies", "Supplies"
        SOFTWARE = "software", "Software"
        TRAINING = "training", "Training"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        REIMBURSED = "reimbursed", "Reimbursed"
        CANCELLED = "cancelled", "Cancelled"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="expense_claims")
    title = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    expense_date = models.DateField()
    description = models.TextField(blank=True)
    receipt = models.FileField(upload_to=receipt_upload_path, null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)

    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)
    reimbursed_at = models.DateTimeField(null=True, blank=True)
    reimbursement_reference = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-expense_date", "-created_at"]

    def __str__(self):
        return f"{self.employee.employee_code} {self.title} ({self.status})"
