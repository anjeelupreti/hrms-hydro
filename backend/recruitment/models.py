from django.conf import settings
from django.db import models

from core.models import AuditModel
from employees.models import Department
from core.archiving import ArchivableModel


def resume_upload_path(instance, filename):
    return f"recruitment/resumes/{instance.pk or 'new'}/{filename}"


class JobPosting(ArchivableModel, AuditModel):
    """An open (or draft/closed) role. Read-open so it can double as an
    internal job board; only HR writes."""

    class EmploymentType(models.TextChoices):
        FULL_TIME = "full_time", "Full time"
        PART_TIME = "part_time", "Part time"
        CONTRACT = "contract", "Contract"
        INTERNSHIP = "internship", "Internship"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        OPEN = "open", "Open"
        CLOSED = "closed", "Closed"

    title = models.CharField(max_length=200)
    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="job_postings"
    )
    location = models.CharField(max_length=150, blank=True)
    employment_type = models.CharField(
        max_length=20, choices=EmploymentType.choices, default=EmploymentType.FULL_TIME
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    description = models.TextField(blank=True)
    openings = models.PositiveIntegerField(default=1)
    salary_min = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    salary_max = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class Candidate(AuditModel):
    """An applicant moving through a job's hiring pipeline. Confidential —
    HR-only (see viewsets). `stage` is the whole point of the pipeline
    board; moving a card is a PATCH to this field."""

    class Stage(models.TextChoices):
        APPLIED = "applied", "Applied"
        SCREENING = "screening", "Screening"
        INTERVIEW = "interview", "Interview"
        OFFER = "offer", "Offer"
        # Set by accepting an `Offer`, not chosen by hand — being hired is
        # mutual. `DECLINED` is distinct from `REJECTED` on purpose: losing
        # somebody to a counter-offer is not the same fact as deciding against
        # them, and merging the two flatters the funnel.
        HIRED = "hired", "Hired"
        DECLINED = "declined", "Declined our offer"
        REJECTED = "rejected", "Rejected"

    job = models.ForeignKey(JobPosting, on_delete=models.CASCADE, related_name="candidates")
    name = models.CharField(max_length=150)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    resume = models.FileField(upload_to=resume_upload_path, null=True, blank=True)
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.APPLIED)
    rating = models.PositiveSmallIntegerField(null=True, blank=True, help_text="0–5")
    source = models.CharField(max_length=100, blank=True, help_text="e.g. LinkedIn, Referral")
    interview_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} — {self.job.title}"


class CandidateNote(models.Model):
    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name="notes")
    body = models.TextField()
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Note on {self.candidate_id}"


class Interview(AuditModel):
    """An interview schedule for a candidate."""
    
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        
    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name="interviews")
    title = models.CharField(max_length=200, help_text="e.g. Technical Round 1")
    scheduled_at = models.DateTimeField()
    duration_minutes = models.PositiveIntegerField(default=60)
    interviewers = models.ManyToManyField('employees.Employee', related_name="interviews")
    location = models.CharField(max_length=200, blank=True, help_text="Zoom link or room name")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    notes = models.TextField(blank=True)
    
    class Meta:
        ordering = ["-scheduled_at"]
        
    def __str__(self):
        return f"{self.title} - {self.candidate.name}"



class Offer(AuditModel):
    """A formal offer to a candidate, and their answer to it.

    **Why this exists as a record rather than a stage.** `Candidate.Stage` had
    `OFFER` and `HIRED` as two values of one enum, which conflates a decision
    *we* make with an agreement *they* accept. Selecting somebody is ours;
    being hired is mutual. Without a record there is no offered salary, no
    acceptance date, and no way to tell a declined offer from a rejected
    candidate — so "hired" was a dropdown somebody picked.

    Declining is deliberately **not** a rejection. Losing a candidate to a
    counter-offer is a different fact from deciding against them, and hiring
    reports that merge the two overstate how selective the process was.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"
        WITHDRAWN = "withdrawn", "Withdrawn by us"
        EXPIRED = "expired", "Expired"

    candidate = models.OneToOneField(
        Candidate, on_delete=models.CASCADE, related_name="offer"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)

    annual_salary = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="What was actually offered — carried onto the employee's first salary structure.",
    )
    designation = models.ForeignKey(
        "employees.Designation", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    department = models.ForeignKey(
        "employees.Department", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    start_date = models.DateField(
        null=True, blank=True, help_text="Agreed first working day — becomes the employee's date_joined."
    )
    expires_on = models.DateField(
        null=True, blank=True, help_text="After this, an unanswered offer lapses rather than staying open forever.",
    )
    notes = models.TextField(blank=True)

    sent_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    # ── The candidate's own answer ────────────────────────────────────────
    #
    # Acceptance is the one signature in the hiring flow that has to come from
    # the other party — HR marking an offer accepted after a phone call is a
    # note of a conversation, not an acceptance.
    #
    # A secret in the URL, like the signup verification link: the candidate has
    # no account and must not need one to answer. `token_urlsafe(32)` is 256
    # bits — not guessable, and the only thing standing between a stranger and
    # somebody's salary, which is why it is generated with `secrets` and never
    # from the pk, the email or a timestamp.
    #
    # Nullable because a draft has no link yet. Issued when the offer is sent.
    response_token = models.CharField(
        max_length=64, unique=True, null=True, blank=True, db_index=True,
        help_text="Secret in the candidate's accept/decline link. Issued when the offer is sent.",
    )
    #: When they opened it. Not when they answered — `responded_at` is that.
    #: Worth keeping separate: an offer opened four times and not answered is a
    #: candidate who is negotiating elsewhere, and that is worth knowing before
    #: the expiry date rather than after.
    viewed_at = models.DateTimeField(null=True, blank=True)
    decline_reason = models.CharField(
        max_length=255, blank=True,
        help_text="Why they said no — the most useful thing recruitment can learn, and it is lost if declines look like rejections.",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Offer to {self.candidate.name} ({self.status})"

    @property
    def is_open(self):
        return self.status in (self.Status.DRAFT, self.Status.SENT)

    @property
    def has_lapsed(self):
        """Past its expiry date and still unanswered.

        Derived rather than stored, so an offer lapses by the calendar rather
        than by whether a nightly job ran. `EXPIRED` is still written when
        somebody tries to act on it, so the status is not one nothing ever
        sets — but the truth does not wait for that write.
        """
        from datetime import date as _date

        return bool(self.is_open and self.expires_on and self.expires_on < _date.today())

    def issue_response_token(self):
        """Mint the secret the candidate's link carries. Idempotent.

        Re-issuing on every send would break the link in an email already sent —
        which is what somebody forwarding "did you get this?" is looking at.
        """
        import secrets

        if not self.response_token:
            self.response_token = secrets.token_urlsafe(32)
        return self.response_token
