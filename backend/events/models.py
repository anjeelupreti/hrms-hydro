"""Company events — the things that happen, who is in them, and the paperwork.

**Why this is not `Meeting` and not a calendar entry.** A meeting is a slot in
somebody's day with an invitee list. An event here is a *thing the company
did*: a board meeting, a commissioning ceremony, a safety drill at the
powerhouse, a public hearing with the district, an audit visit. It has a
subject matter rather than an agenda, it has stakeholders rather than
attendees, and the reason anybody opens it six months later is the minutes and
the photographs attached to it.

**Stakeholders are not a many-to-many to `Employee`.** Half the people at a
public hearing are not employees — a ward chair, a contractor's site manager, a
ministry official — and a model that can only name staff makes the record of
who was in the room silently incomplete. So a stakeholder is a *name*, with an
optional link to an employee where there is one. See `EventStakeholder`.

**The record is a timeline, not a grid.** Events are read chronologically —
what has happened, what is coming — and a month grid answers neither question
well: an event three months out is off the screen, and last year's audit is
several clicks back. A calendar is offered alongside for the cases where "what
else is on that day" is the question.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import AuditModel


def event_attachment_path(instance, filename):
    return f"events/{instance.event_id or 'new'}/{filename}"


class Event(AuditModel):
    """One thing that happened, or is going to."""

    class Kind(models.TextChoices):
        MEETING = "meeting", "Meeting"
        BOARD = "board", "Board meeting"
        AGM = "agm", "General meeting"
        CEREMONY = "ceremony", "Ceremony"
        TRAINING = "training", "Training"
        DRILL = "drill", "Drill / safety exercise"
        INSPECTION = "inspection", "Inspection / audit"
        #: A hearing, a consultation, a handover to the district. Its own kind
        #: because these are the ones with the longest stakeholder lists and
        #: the ones an auditor asks to see.
        PUBLIC = "public", "Public / community"
        SITE_VISIT = "site_visit", "Site visit"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        CONFIRMED = "confirmed", "Confirmed"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        POSTPONED = "postponed", "Postponed"

    title = models.CharField(max_length=200)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.MEETING)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNED)

    #: What it was *about*, as distinct from what it was called.
    #:
    #: A title is "Q3 Board Meeting"; the subject matter is "approval of the
    #: Sanjen tailrace variation and the FY83 capital plan". Six months later
    #: the second is what somebody is searching for, and folding it into a
    #: description means it is buried in a paragraph.
    subject_matter = models.CharField(
        max_length=300, blank=True, help_text="What it is about, in one line."
    )
    description = models.TextField(blank=True)

    starts_at = models.DateTimeField()
    #: Null for something with no stated finish — a site visit that runs until
    #: it is done. The timeline treats it as a point rather than a span.
    ends_at = models.DateTimeField(null=True, blank=True)
    #: For an event that occupies whole days. Kept as a flag rather than
    #: inferred from midnight-to-midnight times, because "all day" is what
    #: somebody meant and 00:00–23:59 is a guess at it.
    is_all_day = models.BooleanField(default=False)

    location = models.CharField(max_length=200, blank=True)
    company = models.ForeignKey(
        "companies.Company", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="events",
        help_text="Which group company this belongs to, where it belongs to one.",
    )
    #: Whose event it is. The person to ask, not the person who typed it in —
    #: `created_by` already records that.
    organiser = models.ForeignKey(
        "employees.Employee", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="organised_events",
    )
    #: Written afterwards. Separate from `description`, which is written
    #: before: one is what we intend to do and the other is what happened, and
    #: overwriting the first with the second loses the reason it was called.
    outcome = models.TextField(blank=True, help_text="Minutes, decisions, what came of it.")

    class Meta:
        ordering = ["-starts_at", "-id"]
        indexes = [models.Index(fields=["starts_at"])]

    def __str__(self):
        return f"{self.title} ({self.starts_at:%Y-%m-%d})"

    @property
    def is_past(self):
        """Finished, by the clock rather than by the status.

        Read from `ends_at` where there is one, so a two-day inspection is not
        "past" on its first evening.
        """
        return (self.ends_at or self.starts_at) < timezone.now()


class EventStakeholder(models.Model):
    """Somebody who was in the room, or should be.

    **Name first, employee second.** The link to `Employee` is optional and the
    name is not, because most events in this industry involve people the HRMS
    has never heard of — a ward chair, a contractor's foreman, an inspector
    from the department. A many-to-many to staff would record the four
    colleagues and silently drop the eleven others, which makes the attendance
    record worse than a sheet of paper.

    Where an employee *is* named, the name is still stored. It is filled in
    from the record at the time, and it stays what it was: a stakeholder list
    is a historical document, and somebody changing their surname next year
    should not rewrite who attended a hearing in 2083.
    """

    class Role(models.TextChoices):
        ATTENDEE = "attendee", "Attendee"
        CHAIR = "chair", "Chair"
        SPEAKER = "speaker", "Speaker"
        ORGANISER = "organiser", "Organiser"
        GUEST = "guest", "Guest"
        OBSERVER = "observer", "Observer"

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="stakeholders")
    #: Set where this is one of ours. Selecting it fills the name in; clearing
    #: it leaves the name behind, which is the point.
    employee = models.ForeignKey(
        "employees.Employee", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="event_appearances",
    )
    name = models.CharField(max_length=150)
    #: Their employee code, or blank for an outsider. Copied rather than joined
    #: for the same reason as the name.
    employee_code = models.CharField(max_length=20, blank=True)
    #: Who they are, for somebody outside the company. "Ward Chair, Uttargaya-4",
    #: "Site Manager, China Gezhouba".
    organisation = models.CharField(max_length=200, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.ATTENDEE)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    attended = models.BooleanField(
        null=True, blank=True,
        help_text="Left empty until the event has happened.",
    )
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["role", "name"]

    def __str__(self):
        return f"{self.name} at {self.event_id}"

    def save(self, *args, **kwargs):
        # Fill the name from the employee where one is linked and no name was
        # typed. Only when blank: an operator who corrected the spelling, or
        # recorded somebody under the name they use professionally, meant it.
        if self.employee_id and not self.name:
            user = self.employee.user
            self.name = user.get_full_name() or user.get_username()
        if self.employee_id and not self.employee_code:
            self.employee_code = self.employee.employee_code
        super().save(*args, **kwargs)


class EventAttachment(AuditModel):
    """A file belonging to an event.

    Many per event, which is the whole point: minutes, an attendance sheet, a
    dozen photographs and the signed resolution are all the same event and none
    of them is "the" document. A single `FileField` on `Event` would mean the
    second upload replaced the first.
    """

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to=event_attachment_path)
    #: What it is, in the reader's words. Falls back to the filename, which is
    #: usually `IMG_20260114_112233.jpg` and tells nobody anything.
    caption = models.CharField(max_length=200, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.caption or self.file.name
