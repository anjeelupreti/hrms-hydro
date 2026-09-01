from django.db import models

from core.models import AuditModel
from employees.models import Employee
from core.archiving import ArchivableModel


class TrainingProgram(AuditModel):
    """A course/curriculum (e.g. "Fire Safety", "React Basics"). A program
    is the reusable definition; a TrainingSession is a scheduled run of it."""

    class DeliveryMode(models.TextChoices):
        IN_PERSON = "in_person", "In person"
        ONLINE = "online", "Online"
        HYBRID = "hybrid", "Hybrid"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=100, blank=True)
    delivery_mode = models.CharField(
        max_length=20, choices=DeliveryMode.choices, default=DeliveryMode.IN_PERSON
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.title


class TrainingSession(ArchivableModel, AuditModel):
    """A scheduled run of a program — the thing employees actually enroll in.
    `capacity` 0 means unlimited seats."""

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    program = models.ForeignKey(TrainingProgram, on_delete=models.CASCADE, related_name="sessions")
    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()
    location = models.CharField(max_length=255, blank=True)  # room or video link
    capacity = models.PositiveIntegerField(default=0, help_text="0 = unlimited")
    trainer = models.ForeignKey(
        Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name="sessions_led"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)

    class Meta:
        ordering = ["start_datetime"]

    def __str__(self):
        return f"{self.program.title} — {self.start_datetime:%Y-%m-%d}"

    @property
    def seats_taken(self):
        # Only ENROLLED/COMPLETED occupy a seat — pending requests and
        # declined/cancelled don't.
        return self.enrollments.filter(
            status__in=[Enrollment.Status.ENROLLED, Enrollment.Status.COMPLETED]
        ).count()

    @property
    def is_full(self):
        return self.capacity > 0 and self.seats_taken >= self.capacity


class Enrollment(AuditModel):
    """An employee's place in a session.

    Two ways in (per the Phase 12 decision): an employee *requests* a seat
    (status REQUESTED, HR approves/declines), or HR *assigns* directly
    (straight to ENROLLED). Completion carries an optional score + feedback.
    """

    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"       # employee asked, awaiting HR
        ENROLLED = "enrolled", "Enrolled"           # approved or HR-assigned
        COMPLETED = "completed", "Completed"
        NO_SHOW = "no_show", "No show"
        CANCELLED = "cancelled", "Cancelled"        # withdrawn by employee/HR
        DECLINED = "declined", "Declined"           # HR rejected the request

    session = models.ForeignKey(TrainingSession, on_delete=models.CASCADE, related_name="enrollments")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="enrollments")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REQUESTED)

    score = models.PositiveSmallIntegerField(null=True, blank=True, help_text="0–100, set on completion")
    feedback = models.TextField(blank=True)

    decided_at = models.DateTimeField(null=True, blank=True)   # approve/decline/assign time
    completed_at = models.DateTimeField(null=True, blank=True)
    certificate_issued_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["session", "employee"], name="unique_session_employee_enrollment")
        ]

    def __str__(self):
        return f"{self.employee.employee_code} — {self.session} ({self.status})"
