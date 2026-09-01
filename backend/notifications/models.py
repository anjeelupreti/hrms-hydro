from django.conf import settings
from django.db import models

from core.models import AuditModel
from employees.models import Department, Employee
from core.archiving import ArchivableModel


class Notification(models.Model):
    """In-app notification. Deliberately has no FK back to LeaveRequest or
    any other model — the message text carries the context, so this stays
    fully decoupled from every app that calls notify()."""

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    verb = models.CharField(max_length=50)
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.recipient}: {self.verb}"


class NotificationPreference(models.Model):
    """Per-user channel opt-in."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_preference"
    )
    email_enabled = models.BooleanField(default=True)
    in_app_enabled = models.BooleanField(default=True)
    push_enabled = models.BooleanField(default=False)

    def __str__(self):
        return f"Notification preferences for {self.user}"


class PushSubscription(models.Model):
    """One row per browser/device a user has subscribed to Web Push on.
    A user can have several (different browsers, phone + laptop) — all
    get notified. `endpoint` is the unique per-device identifier the
    browser's PushManager assigns; the same user re-subscribing from the
    same browser updates the existing row rather than duplicating it."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint = models.TextField()
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "endpoint"], name="unique_user_endpoint")
        ]

    def __str__(self):
        return f"Push subscription for {self.user}"


class Holiday(AuditModel):
    """Company-configurable — HR adds each year's holidays explicitly
    rather than the system assuming a fixed recurring date, since many
    festivals (Dashain, Tihar, Eid, ...) shift on the Gregorian calendar
    year to year. Same pattern as LeaveType/ApprovalChain: configurable,
    not hardcoded to one country's calendar."""

    name = models.CharField(max_length=100)
    date = models.DateField()

    class Meta:
        ordering = ["date"]
        constraints = [
            models.UniqueConstraint(fields=["name", "date"], name="unique_holiday_name_date")
        ]

    def __str__(self):
        return f"{self.name} ({self.date})"


class CompanyEvent(AuditModel):
    """A company-wide calendar event (meeting/interview/announcement) —
    distinct from Holiday (which is a whole-day, whole-company non-work
    day) and from any single employee's attendance/leave. Per-attendee
    invite/RSVP (Phase 11a, `MeetingAttendee` below) applies regardless
    of `event_type`, but is really only meaningful for `MEETING`/
    `INTERVIEW` — an `ANNOUNCEMENT` calendar entry has no attendees."""

    class EventType(models.TextChoices):
        MEETING = "meeting", "Meeting"
        INTERVIEW = "interview", "Interview"
        ANNOUNCEMENT = "announcement", "Announcement"
        OTHER = "other", "Other"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    event_type = models.CharField(max_length=20, choices=EventType.choices, default=EventType.OTHER)
    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()
    all_day = models.BooleanField(default=False)
    location = models.CharField(max_length=255, blank=True, help_text="Room name or a video call link.")

    class Meta:
        ordering = ["start_datetime"]

    def __str__(self):
        return f"{self.title} ({self.start_datetime})"


class MeetingAttendee(AuditModel):
    """Per-attendee invite/RSVP for a `CompanyEvent` — the gap explicitly
    flagged as deferred back in Phase 8. `organizer` is just the event's
    `created_by` (from `AuditModel`); no separate field needed."""

    class RsvpStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"

    event = models.ForeignKey(CompanyEvent, on_delete=models.CASCADE, related_name="attendees")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="meeting_invites")
    rsvp_status = models.CharField(max_length=20, choices=RsvpStatus.choices, default=RsvpStatus.PENDING)

    class Meta:
        ordering = ["employee__employee_code"]
        constraints = [
            models.UniqueConstraint(fields=["event", "employee"], name="unique_event_employee_attendee")
        ]

    def __str__(self):
        return f"{self.event.title}: {self.employee.employee_code} ({self.rsvp_status})"


class Announcement(ArchivableModel, AuditModel):
    """Company-wide or department-scoped broadcast. `department=None`
    means company-wide. Publishing fans out through the existing
    `notify()` — no separate delivery mechanism."""

    title = models.CharField(max_length=200)
    body = models.TextField()
    department = models.ForeignKey(
        Department,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="Blank = company-wide.",
    )
    pinned = models.BooleanField(default=False)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-pinned", "-created_at"]

    def __str__(self):
        return self.title


class ReminderRule(AuditModel):
    """When to warn about something, who hears it, and what it says.

    **The customer owns this row; we own what it can point at.** `kind` names
    an entry in `notifications.reminders`, and that registry decides which table
    is queried and which facts are available — it has to be code, because it is
    a database query, and a settings screen that let somebody write one would be
    a settings screen that could read the payroll table.

    Everything else here is theirs. A company wanting thirty days' notice before
    a probation lapses should not have to ask us, and the wording of a message to
    their own staff is not our business.

    **Why lead days is a list.** One warning is rarely enough and rarely the
    right distance. Probation wants a month out, when there is still time to
    arrange a conversation, and again a week out, when there is not. Modelling it
    as a single integer would mean two rules for one intention, and two rules
    drift apart the first time somebody edits one.
    """

    #: Registry key. Deliberately a plain char field rather than choices: the
    #: registry is the source of truth and a migration every time a kind is
    #: added would make adding one a schema change.
    kind = models.CharField(max_length=64)
    is_enabled = models.BooleanField(default=True)
    #: Days before the event, e.g. `[30, 7]`. Each fires separately.
    lead_days = models.JSONField(default=list)
    subject = models.CharField(max_length=200, blank=True)
    body = models.TextField(blank=True)

    class Meta:
        ordering = ["kind"]
        constraints = [
            # One rule per kind. Two rules for the same thing is how somebody
            # ends up receiving a reminder they had already switched off.
            models.UniqueConstraint(fields=["kind"], name="unique_reminder_rule_kind")
        ]

    def __str__(self):
        return f"{self.kind} ({', '.join(str(d) for d in self.lead_days)} days before)"

    def offsets(self):
        """Lead times as sorted whole days, ignoring anything unusable.

        Coerced rather than trusted: this is a `JSONField`, so a hand-edited
        fixture or an older client can put strings or nulls in it, and a bad
        entry should cost that one reminder rather than the whole nightly run.
        """
        out = set()
        for value in self.lead_days or []:
            try:
                days = int(value)
            except (TypeError, ValueError):
                continue
            if days >= 0:
                out.add(days)
        return sorted(out)


class ReminderLog(models.Model):
    """One reminder, sent once.

    The dispatcher runs daily and must be safe to re-run — a retry, an
    overlapping schedule or somebody triggering it by hand must not mail
    everybody twice. This is the record that makes the second attempt a no-op.

    **Keyed on the target date, not on "today".** A reminder is identified by
    *what* it is about, *who* heard it and *which* warning it was — so the
    30-day and 7-day notices about one probation are two rows, and re-running
    the job on either morning finds the row and stops.

    Not an `AuditModel`: nobody edits a delivery record, and giving it a
    modified-by would imply somebody could.
    """

    rule = models.ForeignKey(ReminderRule, on_delete=models.CASCADE, related_name="sent")
    #: `employee:31`, `holiday:4` — the thing being reminded about.
    target_key = models.CharField(max_length=120)
    recipient = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="reminder_log"
    )
    lead_days = models.PositiveSmallIntegerField()
    #: The date the thing actually happens, not the date this was sent.
    due_date = models.DateField()
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-sent_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["rule", "target_key", "recipient", "lead_days", "due_date"],
                name="unique_reminder_delivery",
            )
        ]
        indexes = [models.Index(fields=["rule", "due_date"])]

    def __str__(self):
        return f"{self.rule.kind} → {self.recipient_id} ({self.lead_days}d before {self.due_date})"
