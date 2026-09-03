"""Field visits — going to site, and what came of it.

## Why this is not timesheets

The question was whether `timesheets.TimeEntry` could carry field visits, and it
cannot. The two record different kinds of fact and are read at different times
by different people.

A **time entry** is a scalar: *this many hours, on this project, on this day*,
submitted afterwards and approved for billing and effort reporting. It has no
place, no reason, no duration beyond a day, and nobody to go with.

A **field visit** is a journey: somebody travels to the headworks or along a
transmission line, for a stated purpose, for two or five days, usually with
colleagues, and it is **authorised before it happens** — a travel order, not a
retrospective claim. On return there is a report, photographs, and an allowance
to settle. Forcing that into `TimeEntry` would mean:

* `hours` is the wrong shape. A three-day visit is not a number of hours, and
  putting one there corrupts the effort figures the timesheet exists to produce.
* there is nowhere for the destination, the purpose, the companions or the
  report — the four things anybody actually looks a visit up for;
* the approval runs the wrong way round. A timesheet is approved after the fact;
  a visit has to be approved before somebody gets in the vehicle.

So: a separate module, and **deliberately not an isolated one**. Three seams,
each closing a real gap:

* **Attendance.** Somebody on a field visit is neither present nor absent nor on
  leave. Today the nightly sweep would mark them absent, and their pay would be
  docked for being at the site they were sent to. `attendance_days()` is what
  the sweep consults.
* **Timesheets.** A visit *can* produce time entries, which is the honest
  version of the integration that merging them would have faked: the visit says
  where somebody was, the entry says what it was worth to a project.
* **Expenses.** A visit produces a claim, and linking them means "what did this
  trip cost" is answerable without matching dates by eye.
"""

from django.conf import settings
from django.db import models

from core.models import AuditModel


def visit_attachment_path(instance, filename):
    return f"fieldvisits/{instance.visit_id or 'new'}/{filename}"


class Site(AuditModel):
    """A place people are sent to, and who signs off going there.

    **Why this exists now when `destination` was free text.** Free text was the
    right call while a visit was only a description of itself — "the headrace
    tunnel, ch. 1400" is not a row in a lookup table. What changed is that a
    travel order has to be validated by somebody who knows the place, and
    "somebody who knows the place" cannot be derived from a string. A site is
    the thing that carries those people.

    `destination` stays, and stays free text. A site is optional: a visit to a
    ward office still records where it went without anybody having to create a
    ward office first, and the day that ward office becomes a regular
    destination it can be promoted to a site without rewriting the history.
    """

    name = models.CharField(max_length=200)
    #: Short form for a dropdown and a report column — "SJ-HW" for the Sanjen
    #: headworks. Not an identifier: `pk` is.
    code = models.CharField(max_length=30, blank=True)
    company = models.ForeignKey(
        "companies.Company", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="sites",
    )
    district = models.CharField(max_length=100, blank=True)
    province = models.CharField(max_length=100, blank=True)
    address = models.CharField(max_length=300, blank=True)
    description = models.TextField(blank=True)

    #: **Who can validate a trip here.** A requester picks their approver from
    #: these *or* from their own supervisors — see
    #: `fieldvisits.services.eligible_approvers`. Site supervisors are the
    #: people who know whether the visit is necessary and whether the dates make
    #: sense; a line manager sitting in the head office frequently does not.
    supervisors = models.ManyToManyField(
        "employees.Employee", blank=True, related_name="supervised_sites"
    )

    #: Retired rather than deleted. A site with ten years of visits behind it
    #: cannot be removed without taking the history with it, and "we do not go
    #: there any more" is not "it never existed".
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["code"],
                condition=~models.Q(code=""),
                name="one_site_per_code",
            )
        ]

    def __str__(self):
        return self.name


class FieldVisit(AuditModel):
    """One journey to site, from request to report."""

    class Purpose(models.TextChoices):
        INSPECTION = "inspection", "Inspection"
        SUPERVISION = "supervision", "Construction supervision"
        SURVEY = "survey", "Survey / investigation"
        MAINTENANCE = "maintenance", "Maintenance"
        #: Called out at night because a unit tripped. Its own purpose because
        #: these are the visits that get approved retrospectively, and a report
        #: that cannot say which ones those were is not much of a report.
        EMERGENCY = "emergency", "Emergency response"
        MEETING = "meeting", "Meeting"
        COMMUNITY = "community", "Community / stakeholder"
        AUDIT = "audit", "Audit / regulatory"
        TRAINING = "training", "Training"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        #: Waiting for a travel order. The normal path.
        REQUESTED = "requested", "Requested"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        #: Been and returned, report written.
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="field_visits"
    )
    #: Which of the group's companies the trip is for. A shared services
    #: engineer visits three project companies in a month and each one carries
    #: its own cost.
    company = models.ForeignKey(
        "companies.Company", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="field_visits",
    )
    #: Optional. Where a visit belongs to a piece of work, saying so is what
    #: lets `timesheets` be generated from it later.
    project = models.ForeignKey(
        "projects.Project", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="field_visits",
    )

    #: Optional, and deliberately so — see `Site`. Where it is set, the site's
    #: supervisors join the requester's own as people who may approve the trip.
    site = models.ForeignKey(
        "fieldvisits.Site", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="visits",
    )
    #: **Who was asked to approve it, chosen by the requester.** From the site's
    #: supervisors or their own — at least one has to exist or the request
    #: cannot be made, which is the point: a travel order nobody is named on is
    #: one that sits in a queue nobody owns.
    approver = models.ForeignKey(
        "employees.Employee", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="field_visits_to_approve",
    )

    #: **The date the requester says the trip is for, which is not the date the
    #: row was made.** Visits are written up after the fact all the time — an
    #: emergency call-out at 2am is recorded the next morning — so `starts_on`
    #: may be in the past and that is not an error. `created_at` and
    #: `updated_at` from `AuditModel` say when the record was actually touched,
    #: which is what an auditor needs to tell a late entry from a back-dated one.
    purpose = models.CharField(max_length=20, choices=Purpose.choices, default=Purpose.INSPECTION)
    title = models.CharField(max_length=200)
    #: Where. Free text rather than a `Site` table: a visit goes to "the
    #: headrace tunnel, ch. 1400" or "Uttargaya-4 ward office" as often as to a
    #: named installation, and a lookup that cannot hold those would be filled
    #: in with "Other" and a note.
    destination = models.CharField(max_length=200)
    district = models.CharField(max_length=100, blank=True)

    #: Whole days, not hours. A visit is measured in days away — which is what
    #: the allowance, the attendance and the roster all key on.
    starts_on = models.DateField()
    ends_on = models.DateField()

    description = models.TextField(blank=True, help_text="What the visit is for.")
    #: Written on return. Separate from `description`, which is written before:
    #: one is the plan and the other is what was found, and overwriting the
    #: first loses why anybody went.
    report = models.TextField(blank=True)

    transport = models.CharField(max_length=120, blank=True)
    estimated_cost = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="For the travel order. The real figure comes from the expense claim.",
    )

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    approver = models.ForeignKey(
        "employees.Employee", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="field_visits_to_approve",
    )
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    #: What it actually cost, once somebody claims it. Linked rather than
    #: duplicated, so "what did this trip cost" does not mean matching dates by
    #: eye across two screens.
    expense_claim = models.OneToOneField(
        "expenses.ExpenseClaim", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="field_visit",
    )

    class Meta:
        ordering = ["-starts_on", "-id"]
        indexes = [
            models.Index(fields=["employee", "starts_on"]),
            models.Index(fields=["status", "starts_on"]),
        ]

    def __str__(self):
        return f"{self.employee_id} → {self.destination} ({self.starts_on})"

    @property
    def days(self):
        """Days away, inclusive of both ends.

        A one-day visit is one day, not zero — which a plain date subtraction
        would give, and which would silently zero every allowance.
        """
        return (self.ends_on - self.starts_on).days + 1

    @property
    def is_locked(self):
        return self.status in (self.Status.APPROVED, self.Status.COMPLETED, self.Status.REJECTED)


class FieldVisitParticipant(models.Model):
    """Somebody else who went.

    **Name first, employee second**, for the same reason event stakeholders are:
    a site visit routinely includes a contractor's engineer, a consultant or a
    ward representative, and a many-to-many to `Employee` would record the two
    colleagues and silently drop the three others — leaving an attendance record
    of who was on site that is wrong in the direction that matters.
    """

    visit = models.ForeignKey(
        FieldVisit, on_delete=models.CASCADE, related_name="participants"
    )
    employee = models.ForeignKey(
        "employees.Employee", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="field_visit_appearances",
    )
    name = models.CharField(max_length=150)
    organisation = models.CharField(max_length=200, blank=True)
    role = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.name} on {self.visit_id}"

    def save(self, *args, **kwargs):
        if self.employee_id and not self.name:
            user = self.employee.user
            self.name = user.get_full_name() or user.get_username()
        super().save(*args, **kwargs)


class FieldVisitAttachment(AuditModel):
    """Photographs, the signed travel order, a measurement sheet.

    Many, because a site visit produces a dozen photographs and one of them is
    never "the" attachment.
    """

    visit = models.ForeignKey(FieldVisit, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to=visit_attachment_path)
    caption = models.CharField(max_length=200, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.caption or self.file.name
