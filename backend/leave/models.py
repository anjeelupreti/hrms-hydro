from django.conf import settings
from django.db import models

from core.models import AuditModel
from employees.models import Employee


class LeaveType(AuditModel):
    """Configurable per-company. Deliberately merges what the original plan
    called LeaveType + LeavePolicy into one model — there's no evidence
    yet of a need for per-grade/per-department quota variants for the
    same leave type; that's a real but separate extension if it arises."""

    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=20, unique=True)
    is_paid = models.BooleanField(default=True)
    annual_quota_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    carry_forward_allowed = models.BooleanField(default=False)
    max_carry_forward_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    is_active = models.BooleanField(
        default=True,
        help_text=(
            "Retired types stay on the requests and balances that already "
            "reference them, but are not offered on new requests. This is the "
            "removal for a type that carries history — deleting one is refused "
            "because LeaveRequest points at it with PROTECT."
        ),
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ApprovalChain(AuditModel):
    name = models.CharField(max_length=100, unique=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class ApprovalStep(AuditModel):
    class ApproverRole(models.TextChoices):
        MANAGER = "manager", "Requester's Manager"
        HR_ADMIN = "hr_admin", "Any HR Admin"
        #: **Each of the requester's supervisors, in their order.** Expands to
        #: as many steps as that person has supervisors — which is why it
        #: cannot be written as a fixed row per step: two people on the same
        #: chain can have two supervisors and four. See
        #: `leave.services.effective_chain`, which does the expanding.
        SUPERVISOR = "supervisor", "Each of the requester's supervisors"

    chain = models.ForeignKey(ApprovalChain, on_delete=models.CASCADE, related_name="steps")
    sequence = models.PositiveIntegerField()
    approver_role = models.CharField(max_length=20, choices=ApproverRole.choices)

    class Meta:
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(fields=["chain", "sequence"], name="unique_chain_sequence")
        ]

    def __str__(self):
        return f"{self.chain.name} step {self.sequence}: {self.approver_role}"


class LeaveBalance(AuditModel):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="leave_balances")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.CASCADE, related_name="balances")
    year = models.PositiveIntegerField()
    allocated_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    carried_forward_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    used_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "leave_type", "year"], name="unique_employee_leave_type_year"
            )
        ]

    @property
    def remaining_days(self):
        return self.allocated_days + self.carried_forward_days - self.used_days

    def __str__(self):
        return f"{self.employee.employee_code}/{self.leave_type.code}/{self.year}"


class LeaveRequest(AuditModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="leave_requests")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="requests")
    start_date = models.DateField()
    end_date = models.DateField()
    half_day = models.BooleanField(default=False)
    days_requested = models.DecimalField(max_digits=5, decimal_places=1)
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    # Both computed once at submission and stored, so they reflect the
    # employee's probation status / balance *at request time* even if
    # either changes before a decision is made.
    is_paid = models.BooleanField(
        default=True,
        help_text="False if the leave type isn't paid, or the employee was on probation on the start date.",
    )
    exceeds_balance = models.BooleanField(default=False)
    current_step = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.employee.employee_code}: {self.leave_type.code} {self.start_date}–{self.end_date}"


class ApprovalAction(models.Model):
    """Append-only decision history — same pattern as EmployeeLog /
    AttendanceEditLog."""

    class Decision(models.TextChoices):
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    leave_request = models.ForeignKey(LeaveRequest, on_delete=models.CASCADE, related_name="actions")
    step_sequence = models.PositiveIntegerField()
    decision = models.CharField(max_length=20, choices=Decision.choices)
    comment = models.TextField(blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.leave_request_id} step {self.step_sequence}: {self.decision}"

