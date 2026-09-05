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

    #: **Whose meeting it is, chosen by whoever called it.**
    #:
    #: Nullable because the calendar is shared across the group and most
    #: entries — a holiday, an announcement, a drill — belong to everybody. A
    #: *meeting* has an owner, though: its minute goes on that company's paper
    #: and takes its number from that company's register, and the person
    #: calling the meeting is the one who knows which. They may only pick from
    #: their own primary and secondary companies — see
    #: `MeetingCreateSerializer.validate_company`.
    company = models.ForeignKey(
        "companies.Company", null=True, blank=True,
        on_delete=models.PROTECT, related_name="meetings",
    )

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

    class Attendance(models.TextChoices):
        #: Nobody has taken the register yet. Distinct from absent on purpose:
        #: "we did not record it" and "they did not come" are different facts,
        #: and a minute that cannot tell them apart is not worth signing.
        UNMARKED = "unmarked", "Not recorded"
        PRESENT = "present", "Present"
        ABSENT = "absent", "Absent"

    event = models.ForeignKey(CompanyEvent, on_delete=models.CASCADE, related_name="attendees")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="meeting_invites")
    rsvp_status = models.CharField(max_length=20, choices=RsvpStatus.choices, default=RsvpStatus.PENDING)

    #: **Who actually came, which is not who accepted.** RSVP is a promise made
    #: beforehand and attendance is what happened; the minute records the
    #: second. Marked after the meeting and re-markable at any time, because
    #: the register is routinely taken from memory the following morning.
    attendance = models.CharField(
        max_length=10, choices=Attendance.choices, default=Attendance.UNMARKED
    )
    attendance_marked_at = models.DateTimeField(null=True, blank=True)

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


# ── What a meeting produces ──────────────────────────────────────────────
#
# `CompanyEvent` stays what it always was — a row on the calendar — and
# `MeetingAttendee` stays the invitation. What follows is everything a meeting
# generates *after* it has been called, none of which had anywhere to live: an
# agenda, the decisions taken, who consented or dissented to each, and the
# minute that assembles them.


class AgendaItem(AuditModel):
    """One thing to be discussed.

    **Addable and removable at any point, not only when the meeting is
    called.** Half an agenda is known a week beforehand and the rest arrives in
    the room; a list that froze at creation would be filled in afterwards by
    editing the description, which is how an agenda stops being a list.
    """

    meeting = models.ForeignKey(
        CompanyEvent, on_delete=models.CASCADE, related_name="agenda_items"
    )
    #: Dense and renumbered on reorder, so it stays a plain index.
    order = models.PositiveSmallIntegerField(default=0)
    title = models.CharField(max_length=250)
    detail = models.TextField(blank=True)
    #: Who is speaking to it. Optional — plenty of items have no owner until
    #: somebody raises them.
    presenter = models.ForeignKey(
        Employee, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="agenda_items_presented",
    )
    #: Raised in the room rather than circulated in advance. Worth recording:
    #: an item nobody saw beforehand is one people may reasonably not have
    #: been ready for, and the minute should say so.
    raised_in_meeting = models.BooleanField(default=False)

    class Meta:
        ordering = ["order", "pk"]

    def __str__(self):
        return f"{self.meeting_id}.{self.order} {self.title}"


class MeetingDecision(AuditModel):
    """A decision taken, and the thing people consent or dissent to.

    Separate from the agenda item because they are not one thing: an item can
    produce two decisions, or none, and a decision can be reached on something
    nobody put on the agenda. Linked where there is a link.
    """

    class Status(models.TextChoices):
        #: Being written up. Nobody has been asked to sign anything.
        DRAFT = "draft", "Draft"
        #: Sent to the attendees for consent or dissent.
        CIRCULATED = "circulated", "Circulated"
        #: Closed — every position that is coming has come.
        CLOSED = "closed", "Closed"

    meeting = models.ForeignKey(
        CompanyEvent, on_delete=models.CASCADE, related_name="decisions"
    )
    agenda_item = models.ForeignKey(
        AgendaItem, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="decisions",
    )
    order = models.PositiveSmallIntegerField(default=0)
    text = models.TextField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    circulated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["order", "pk"]

    def __str__(self):
        return f"Decision {self.pk} on meeting {self.meeting_id}"


class DecisionPosition(AuditModel):
    """One person's consent or dissent, and what it rests on.

    **Consent carries a signature; dissent carries a reason.** Those are not
    symmetrical and should not be: agreeing is signing your name to something,
    and disagreeing is worth nothing to a reader unless it says why. The model
    requires each of them for its own side — see `clean`.
    """

    class Position(models.TextChoices):
        PENDING = "pending", "Not yet answered"
        CONSENT = "consent", "Consented"
        DISSENT = "dissent", "Dissented"
        #: Present but taking no side — recorded rather than left pending, so
        #: "has not answered" keeps meaning that.
        ABSTAIN = "abstain", "Abstained"

    decision = models.ForeignKey(
        MeetingDecision, on_delete=models.CASCADE, related_name="positions"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="decision_positions"
    )
    position = models.CharField(
        max_length=10, choices=Position.choices, default=Position.PENDING
    )
    #: The stamp. Points at `employees.Signature` for the same reason a
    #: memorandum's does: a person can replace their signature, and a document
    #: signed last year must still resolve to the image actually used.
    signature = models.ForeignKey(
        "employees.Signature", null=True, blank=True, on_delete=models.PROTECT,
        related_name="decision_stamps",
    )
    #: Required on dissent. A dissent with no reason tells a reader nothing
    #: except that somebody was unhappy.
    reason = models.TextField(blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["employee__employee_code"]
        constraints = [
            models.UniqueConstraint(
                fields=["decision", "employee"], name="one_position_per_person_per_decision"
            )
        ]

    def __str__(self):
        return f"{self.employee} {self.position} on decision {self.decision_id}"


class MinutesTemplate(AuditModel):
    """The shape a minute takes in this organisation.

    **Configurable, because every office writes minutes to its own form.** One
    wants "Present / In attendance / Apologies / Matters arising"; another wants
    the agenda numbered straight through. Hardcoding either produces a document
    somebody has to fight, so the headings are data.
    """

    name = models.CharField(max_length=120, unique=True)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            # Exactly one default, enforced rather than hoped for: two
            # defaults means the minute you get depends on row order.
            models.UniqueConstraint(
                fields=["is_default"],
                condition=models.Q(is_default=True),
                name="one_default_minutes_template",
            )
        ]

    def __str__(self):
        return self.name


class MinutesSection(AuditModel):
    """One heading in a minutes template, and where its content comes from.

    **`source` is what makes the template more than a list of headings.** A
    section that draws the attendance register or the decision table should not
    be retyped by hand every time — the meeting already knows those. Sections
    that are genuinely prose stay `MANUAL`.
    """

    class Source(models.TextChoices):
        MANUAL = "manual", "Written by hand"
        ATTENDANCE = "attendance", "Who was present and absent"
        AGENDA = "agenda", "The agenda, in order"
        DECISIONS = "decisions", "The decisions taken"
        #: The table the minute closes with: name, consent, dissent,
        #: signature, and the dissenter's reason.
        CONSENT_TABLE = "consent_table", "Consent and dissent register"

    template = models.ForeignKey(
        MinutesTemplate, on_delete=models.CASCADE, related_name="sections"
    )
    order = models.PositiveSmallIntegerField(default=0)
    heading = models.CharField(max_length=200)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANUAL)
    #: Shown greyed in the editor to say what belongs here. Only meaningful for
    #: a manual section.
    hint = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["order", "pk"]

    def __str__(self):
        return f"{self.template_id}.{self.order} {self.heading}"


class MeetingMinutes(AuditModel):
    """The minute itself — one per meeting.

    **Written after the decisions, because they are its source.** A minute
    drafted first is a summary of what somebody remembers; drafted from the
    agenda and the decision register it is a record of what happened.

    The body is sanitised HTML, the same allow-list the memorandum uses, and it
    is rendered on the same page-like sheet — a minute is a document that gets
    printed, filed and referred back to, exactly like a memorandum.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        #: Sent to those who were there, to be read before it is fixed.
        CIRCULATED = "circulated", "Circulated"
        FINAL = "final", "Final"

    meeting = models.OneToOneField(
        CompanyEvent, on_delete=models.CASCADE, related_name="minutes"
    )
    #: **Whose minute it is.** A `CompanyEvent` is a row on the calendar and
    #: has no company — the calendar is shared across the group. The minute is
    #: a document, and a document is on somebody's paper: the heading says so
    #: and the reference number carries the company's code.
    #:
    #: Defaults to the primary company, which is the one payroll and the rest
    #: of the register run through.
    company = models.ForeignKey(
        "companies.Company", null=True, blank=True,
        on_delete=models.PROTECT, related_name="meeting_minutes",
    )
    #: `MIN-VLUCL-0007`. Minted when the minute is drafted, not when the
    #: meeting is called: a meeting that never gets written up should not
    #: consume a number out of the register.
    minute_id = models.CharField(max_length=40, unique=True, null=True, blank=True)
    serial_number = models.PositiveIntegerField(null=True, blank=True)
    template = models.ForeignKey(
        MinutesTemplate, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="minutes",
    )
    content = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    finalised_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name_plural = "meeting minutes"

    @property
    def is_locked(self):
        """Final is evidence. Checked on every write path, like a memorandum."""
        return self.status == self.Status.FINAL

    def __str__(self):
        return f"Minutes for {self.meeting_id}"


class MinutesCounter(models.Model):
    """The next minute serial, per company.

    A row rather than `MAX(serial) + 1`, for the same reason
    `MemorandumCounter` is one: two people drafting a minute in the same second
    both read the same maximum, both write it, and the loser finds out through
    a unique-constraint error on a document they have already started.
    """

    company = models.OneToOneField(
        "companies.Company", on_delete=models.CASCADE, related_name="minutes_counter"
    )
    next_serial = models.PositiveIntegerField(default=1)

    def __str__(self):
        return f"{self.company_id}: next minute {self.next_serial}"
