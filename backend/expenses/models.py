from django.conf import settings
from django.db import models
from django.db.models import Value
from django.db.models.functions import Coalesce

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


class ExpenseBudget(AuditModel):
    """What may be spent on what, and the most anybody may claim at once.

    Two controls on one row, because they are always decided together and
    because splitting them would mean two screens with the same four scope
    fields on both. See `expenses/budgets.py` for how a claim is matched
    against one and why "most specific wins".

    **Scope is three optional dimensions, and leaving one empty widens it.**
    A row with nothing set is the company-wide backstop; setting `department`
    narrows it to a team, `category` to a kind of spending, `employee` to one
    person. That is the whole vocabulary — anything more expressive here is a
    rules engine, and nobody has asked for one.
    """

    class Period(models.TextChoices):
        #: Runs Shrawan-Ashad on a Bikram Sambat company. `budgets.period_bounds`
        #: reads the company calendar rather than assuming January.
        FISCAL_YEAR = "fiscal_year", "Fiscal year"
        MONTHLY = "monthly", "Month"

    class Enforcement(models.TextChoices):
        #: Refuse the claim outright. The submitter fixes it before anybody
        #: else spends time on it.
        BLOCK = "block", "Refuse the claim"
        #: Let it through and say so, on the claim and to the approver. For
        #: companies where an over-budget claim is a conversation, not an error.
        WARN = "warn", "Allow, but flag it"

    name = models.CharField(max_length=150)
    #: Blank means every category. Deliberately not a nullable FK to a choices
    #: table — the categories are `ExpenseClaim.Category`, and a second copy of
    #: that list is a second thing to keep in step.
    category = models.CharField(
        max_length=20, choices=ExpenseClaim.Category.choices, blank=True,
        help_text="Leave empty to cover every category.",
    )
    department = models.ForeignKey(
        "employees.Department", null=True, blank=True,
        on_delete=models.CASCADE, related_name="expense_budgets",
        help_text="Leave empty to cover the whole company.",
    )
    employee = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.CASCADE, related_name="expense_budgets",
        help_text="For a personal allowance. Usually empty.",
    )

    period = models.CharField(
        max_length=20, choices=Period.choices, default=Period.FISCAL_YEAR
    )
    #: The pool. Zero means there is no pool — the row exists only to carry a
    #: per-claim cap, which is a real and common way to use this.
    amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=0,
        help_text="The pool for the period. 0 means no pool, cap only.",
    )
    #: The most any single claim may be. Null means no cap.
    per_claim_cap = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="The most one claim may be. Empty means no per-claim limit.",
    )
    #: How full the pool has to be before the submitter is told. 0 switches the
    #: warning off without switching off the budget.
    warn_at_percent = models.PositiveSmallIntegerField(
        default=80,
        help_text="Warn once this percentage of the pool is committed. 0 = never.",
    )
    enforcement = models.CharField(
        max_length=10, choices=Enforcement.choices, default=Enforcement.WARN
    )
    is_active = models.BooleanField(default=True)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            # One rule per scope. Two budgets covering exactly the same ground
            # would make "which applies" a tie broken by primary key, which is
            # not a rule anybody wrote down.
            #
            # **Over `Coalesce`, not over the bare columns.** Two of the three
            # scope fields are nullable, and `NULL != NULL` in SQL — so a plain
            # `UniqueConstraint(fields=[...])` silently permits any number of
            # company-wide budgets, which is precisely the row most likely to be
            # created twice. Folding null to 0 makes "no department" a value the
            # index can compare.
            models.UniqueConstraint(
                Coalesce("department", Value(0)),
                Coalesce("employee", Value(0)),
                "category",
                "period",
                name="unique_budget_scope",
            )
        ]

    def __str__(self):
        return self.name

    def label(self):
        """How this budget is named in a refusal.

        Built from the scope rather than from `name`, because the message has
        to say *why this rule applies to you* — "Operations travel" is an
        explanation and "FY82 Budget C" is not.
        """
        parts = []
        if self.employee_id:
            parts.append(self.employee.employee_code)
        elif self.department_id:
            parts.append(self.department.name)
        if self.category:
            parts.append(self.get_category_display().lower())
        return " ".join(parts) if parts else self.name
