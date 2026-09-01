from django.conf import settings
from django.db import models

from core.models import AuditModel


def employee_photo_upload_path(instance, filename):
    # Company-schema-namespaced, same reasoning as documents/company logo —
    # all companies share one local disk for now.
    return f"employees/photos/{instance.pk or 'new'}/{filename}"


def employee_cover_upload_path(instance, filename):
    return f"employees/covers/{instance.pk or 'new'}/{filename}"


def employee_resume_upload_path(instance, filename):
    return f"employees/resumes/{instance.pk or 'new'}/{filename}"


def employee_citizenship_upload_path(instance, filename):
    """Company-schema-namespaced, like every other employee upload.

    A citizenship scan is the most sensitive file this product stores, so it
    must never be reachable by guessing a path from another company's URL.
    """
    return f"employees/citizenship/{instance.pk or 'new'}/{filename}"


class Department(AuditModel):
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=20, unique=True)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Designation(AuditModel):
    title = models.CharField(max_length=100, unique=True)
    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="designations"
    )
    #: Seniority. **Lower is more senior** — rank 1 is the top of the company.
    #:
    #: Counting down rather than up because the top of an organisation is a
    #: fixed point and the bottom is not: a company that adds a junior grade
    #: should not have to renumber its CEO. "Rank 1" also reads as seniority in
    #: the way "rank 9" does not.
    #:
    #: **Distinct from the reporting line, and both are needed.** `manager`
    #: answers *who signs this off*; rank answers *how senior is this post*. A
    #: finance lead and an engineering lead can report to different people and
    #: still be peers, and an org chart drawn only from `manager` cannot show
    #: that — it puts them at whatever depth their branch happens to be.
    #:
    #: Zero means unranked, which sorts last. Not null: a nullable integer here
    #: would make every ordering query carry a `NULLS LAST` clause, and the
    #: distinction between "no rank" and "rank absent" is not one anybody needs.
    rank = models.PositiveSmallIntegerField(
        default=0,
        help_text="Seniority — 1 is the most senior. 0 means unranked and sorts last.",
    )

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.title


class CorporatePost(AuditModel):
    """An establishment position — the chair somebody is appointed to.

    Deputy Manager, Senior Engineer, Level 7 Officer. This is what a grade, a
    pay band and seniority follow, and it is the half of somebody's title that
    survives them moving between sites.

    Separate from `Designation`, which is the job title as the outside world
    reads it, and from `CorporateRole`, which is what they are actually
    responsible for. See `Employee.corporate_post` for why the three are not
    one field.
    """

    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=20, unique=True)
    #: Seniority. **Lower is more senior** — rank 1 is the top of the company,
    #: the same convention `Designation.rank` uses, because a reader comparing
    #: the two lists must not have to remember which way each one counts.
    rank = models.PositiveSmallIntegerField(
        default=0, help_text="Seniority — 1 is the most senior. 0 means unranked and sorts last."
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["rank", "name"]

    def __str__(self):
        return self.name


class CorporateRole(AuditModel):
    """What somebody is actually responsible for.

    Head of Electrical Maintenance, Project Manager for Sanjen, Company
    Secretary. Independent of the post: two Deputy Managers hold different
    roles, and somebody promoted out of Senior Engineer usually keeps running
    the same site.
    """

    name = models.CharField(max_length=150, unique=True)
    code = models.CharField(max_length=20, unique=True)
    description = models.TextField(blank=True)
    #: The company this role belongs to, where it belongs to one. A group
    #: running several project companies has a "Project Manager" per project,
    #: and they are different jobs.
    company = models.ForeignKey(
        "companies.Company", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="corporate_roles",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Employee(AuditModel):
    class EmploymentStatus(models.TextChoices):
        ACTIVE = "active", "Active"
        ON_LEAVE = "on_leave", "On Leave"
        #: Employed, not working, and locked out. See `Suspension` — the status
        #: is derived from that record rather than set by hand, so "suspended"
        #: on the roster and "cannot sign in" can never disagree.
        SUSPENDED = "suspended", "Suspended"
        RESIGNED = "resigned", "Resigned"
        TERMINATED = "terminated", "Terminated"

    class Gender(models.TextChoices):
        MALE = "male", "Male"
        FEMALE = "female", "Female"
        OTHER = "other", "Other"

    class MaritalStatus(models.TextChoices):
        SINGLE = "single", "Single"
        MARRIED = "married", "Married"
        DIVORCED = "divorced", "Divorced"
        WIDOWED = "widowed", "Widowed"

    class BloodGroup(models.TextChoices):
        A_POS = "A+", "A+"
        A_NEG = "A-", "A-"
        B_POS = "B+", "B+"
        B_NEG = "B-", "B-"
        AB_POS = "AB+", "AB+"
        AB_NEG = "AB-", "AB-"
        O_POS = "O+", "O+"
        O_NEG = "O-", "O-"

    class BankAccountType(models.TextChoices):
        """A salary account is a distinct product here, not a label.

        Banks reject a payment instruction that names the wrong type, which is
        why this is a constrained choice rather than free text.
        """

        SALARY = "salary", "Salary"
        CURRENT = "current", "Current"
        SAVINGS = "savings", "Savings"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="employee"
    )
    employee_code = models.CharField(max_length=20, unique=True)
    photo = models.ImageField(upload_to=employee_photo_upload_path, null=True, blank=True)
    cover_image = models.ImageField(upload_to=employee_cover_upload_path, null=True, blank=True)
    #: Which part of the cover to show, as a CSS `object-position` percentage.
    #:
    #: The banner is roughly 13:1, and almost no photograph survives that crop
    #: centred — a portrait uploaded as a cover shows its geometric middle,
    #: which on a selfie is the nose and mouth. This is what lets somebody move
    #: the visible band.
    #:
    #: Stored as `"50% 35%"` rather than two numbers: it goes straight into
    #: `object-position` at four call sites, and splitting it into x/y columns
    #: would mean every one of them reassembling the same string.
    #:
    #: Defaults to `"50% 50%"`, which is what the hardcoded behaviour already
    #: was — so an existing cover looks exactly as it did until somebody moves
    #: it, and nothing shifts under people on deploy.
    cover_position = models.CharField(
        max_length=20,
        default="50% 50%",
        help_text="CSS object-position for the cover crop, e.g. '50% 30%'.",
    )
    #: The number people actually ring. Kept as the general-purpose one; the
    #: four channels below say *which* number, for the cases where it matters.
    phone = models.CharField(max_length=20, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=10, choices=Gender.choices, blank=True)

    #: Asked for by the safety side, not by HR.
    #:
    #: A powerhouse and a headrace tunnel are places where somebody gets hurt,
    #: an hour from a hospital. The blood group on file is the difference
    #: between a transfusion starting when they arrive and starting after a
    #: cross-match. Free-form choices rather than text: "O+ve", "O positive"
    #: and "o+" are the same fact and must not sort into three groups.
    blood_group = models.CharField(
        max_length=5, choices=BloodGroup.choices, blank=True,
        help_text="On file for site emergencies.",
    )

    # ── The two addresses, and they are genuinely two ────────────────────
    #
    # Permanent is the address on the citizenship certificate — where somebody
    # is *from*, which is what statutory filings and formal letters use.
    # Temporary is where they currently live, which is where a courier goes and
    # which changes when they are posted to a site. One `address` field
    # answered whichever question was asked last.
    permanent_address = models.CharField(max_length=255, blank=True)
    temporary_address = models.CharField(
        max_length=255, blank=True, help_text="Current residence, if it differs."
    )

    # ── Four channels, because two of them belong to the company ─────────
    #
    # An office number and an office mailbox are issued, revoked on the last
    # day, and appear in the directory. A personal number and a private address
    # belong to the person, survive their employment, and are the only way to
    # reach a leaver about their final settlement. Collapsing them into one
    # pair means offboarding either strands the record or publishes a private
    # mobile in the staff directory.
    office_phone = models.CharField(max_length=30, blank=True, verbose_name="Office cell")
    office_email = models.EmailField(blank=True)
    personal_phone = models.CharField(max_length=30, blank=True, verbose_name="Personal cell")
    personal_email = models.EmailField(blank=True)

    # Profile / "about me" fields — self-editable, surfaced on the rich
    # profile page. `skills` is a simple JSON list of strings (a full
    # skills taxonomy is overkill here); structured work history lives in
    # the related EmployeeExperience model.
    bio = models.TextField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True)
    skills = models.JSONField(default=list, blank=True)
    resume = models.FileField(upload_to=employee_resume_upload_path, null=True, blank=True)
    # Salary-disbursement details — used to build the bank salary file for a
    # payroll run (the actual mechanism for paying staff; gateways have no
    # payout API — see payroll/README.md and docs/development-plan.md Phase 15).
    bank_name = models.CharField(max_length=120, blank=True)
    # Branch and account type are both required by a bank payment instruction:
    # a salary file missing either is rejected by the receiving bank.
    bank_branch = models.CharField(max_length=150, blank=True)
    bank_account_name = models.CharField(max_length=150, blank=True)
    bank_account_number = models.CharField(max_length=40, blank=True)
    bank_account_type = models.CharField(
        max_length=20, choices=BankAccountType.choices, blank=True,
        help_text="Banks reject on this — a salary account is a distinct product here.",
    )

    # ── Legal identity ───────────────────────────────────────────────────
    #
    # Name is held in three parts here, separately from `User.first_name` /
    # `last_name`, which are the *display* name. A tax filing and a bank account
    # are both matched exactly, and neither accepts "the name we show in the
    # sidebar" — someone whose account reads "Sita Kumari Rai" while the app
    # shows "Sita Rai" is a rejected payment, not a cosmetic difference.
    legal_first_name = models.CharField(max_length=100, blank=True)
    legal_middle_name = models.CharField(max_length=100, blank=True)
    legal_last_name = models.CharField(max_length=100, blank=True)

    citizenship_number = models.CharField(max_length=50, blank=True)
    # Two images, not one: Nepali citizenship certificates carry information on
    # both faces, and verification needs both.
    citizenship_front = models.ImageField(
        upload_to=employee_citizenship_upload_path, null=True, blank=True
    )
    citizenship_back = models.ImageField(
        upload_to=employee_citizenship_upload_path, null=True, blank=True
    )
    marital_status = models.CharField(
        max_length=20, choices=MaritalStatus.choices, blank=True,
        help_text="Affects which income-tax rate table applies — see TaxSlab.Taxpayer.",
    )

    # ── Tax and contribution identifiers ─────────────────────────────────
    #
    # Separate fields rather than one "tax id", because they are issued by
    # different bodies for different purposes and appear on different filings.
    pan_number = models.CharField(max_length=30, blank=True, verbose_name="PAN number")
    ssf_number = models.CharField(max_length=30, blank=True, verbose_name="SSF/SSID number")
    pf_number = models.CharField(max_length=30, blank=True, verbose_name="Provident fund number")
    cit_number = models.CharField(max_length=30, blank=True, verbose_name="CIT number")
    passport_number = models.CharField(max_length=30, blank=True)
    passport_expiry = models.DateField(null=True, blank=True)
    #: Which income-tax table applies to this person.
    #:
    #: **Deliberately not derived from `marital_status`.** Nepal's Income Tax
    #: Act sets two rate tables, and a married employee is taxed on the couple
    #: table only if they *elect* joint assessment — which is a choice they
    #: make, not a fact about their marriage. Inferring it would silently move
    #: people onto the wrong bands.
    #:
    #: Blank means the individual table, which is the default and the common
    #: case, and is what every payslip computed before this field existed.
    tax_election = models.CharField(
        max_length=20,
        blank=True,
        choices=[("individual", "Individual"), ("couple", "Couple — joint assessment")],
        help_text="Couple only where the employee has elected joint assessment.",
    )
    date_joined = models.DateField()
    employment_status = models.CharField(
        max_length=20, choices=EmploymentStatus.choices, default=EmploymentStatus.ACTIVE
    )
    probation_end_date = models.DateField(
        null=True,
        blank=True,
        help_text="While set and in the future, leave requests starting before this date are marked unpaid regardless of the leave type's is_paid flag.",
    )
    # ── Which company, of the group's several ────────────────────────
    #
    # See `companies/models.py` for why one of these is singular and the other
    # is not. The short version: `primary_company` is who pays them, and there
    # is exactly one; `secondary_companies` is where else they work, and there
    # can be any number.

    #: The entity this person is employed by — the one on their contract and
    #: their payslip.
    #:
    #: **`PROTECT`, not `SET_NULL`.** Nulling it on delete would silently
    #: detach a whole payroll from its employer and leave payslips that cannot
    #: name who issued them. A company with people on it is deactivated
    #: instead; `CompanyViewSet.destroy` says so in words.
    #:
    #: Nullable only so the field can be added to a database that already has
    #: employees in it. A new employee is created against a company.
    primary_company = models.ForeignKey(
        "companies.Company",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="primary_employees",
        help_text="The company that employs this person. One, and it is the one that pays them.",
    )
    #: Other group companies this person also works for.
    #:
    #: Carries no employment relationship and no money — it is what makes "who
    #: works at the Sanjen site?" answerable for a shared services team who are
    #: all on the parent's payroll.
    secondary_companies = models.ManyToManyField(
        "companies.Company",
        blank=True,
        related_name="secondary_employees",
        help_text="Other group companies this person also works for. No payroll attaches to these.",
    )

    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="employees"
    )
    designation = models.ForeignKey(
        Designation, null=True, blank=True, on_delete=models.SET_NULL, related_name="employees"
    )

    # ── Post and role, which are not the same thing ───────────────────────
    #
    # **The post is the chair; the role is the work.** A company of this kind
    # appoints people to an establishment *post* — Deputy Manager, Senior
    # Engineer, Level 7 Officer — which is what their grade, their pay band and
    # their seniority follow. What they are actually responsible for is the
    # *role*: Head of Electrical Maintenance, Project Manager for Sanjen,
    # Company Secretary.
    #
    # They move independently, which is the whole reason for two fields. Two
    # Deputy Managers hold different roles; somebody promoted from Senior
    # Engineer to Deputy Manager frequently keeps running the same site. A
    # single "designation" field forces one of those facts to be a lie, and the
    # one that loses is whichever was typed second.
    corporate_post = models.ForeignKey(
        "CorporatePost", null=True, blank=True, on_delete=models.SET_NULL, related_name="employees"
    )
    corporate_role = models.ForeignKey(
        "CorporateRole", null=True, blank=True, on_delete=models.SET_NULL, related_name="employees"
    )

    #: **This is where the org chart comes from.** `employees/org-chart` walks
    #: `manager` upward and `direct_reports` downward; nothing else feeds it.
    #: A person with no manager is a root of the chart, which is correct for
    #: the chief executive and a mistake for everybody else — the one place it
    #: can be set is the employee form.
    manager = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="direct_reports"
    )
    # The candidate this employee was hired from, when they came through
    # recruitment rather than being entered by hand.
    #
    # Carries its weight twice: it makes the conversion **idempotent** — a
    # second attempt finds the existing employee instead of creating a
    # duplicate person — and it is what lets time-to-hire be measured against
    # the application that actually produced the employee.
    # When this person last had a live chat connection.
    #
    # Persisted while *online* status lives in Redis, because the two are
    # different kinds of fact: online is true only while a socket is open and
    # must not survive a restart, whereas "last seen 2 hours ago" is exactly
    # the thing that has to.
    last_seen_at = models.DateTimeField(null=True, blank=True)
    hired_from = models.OneToOneField(
        "recruitment.Candidate",
        null=True, blank=True, on_delete=models.SET_NULL, related_name="employee_record",
    )

    class Meta:
        ordering = ["employee_code"]

    def __str__(self):
        return f"{self.employee_code} — {self.user.get_full_name() or self.user.get_username()}"

    def is_on_probation(self, on_date):
        return self.probation_end_date is not None and on_date < self.probation_end_date


class EmployeeExperience(models.Model):
    """A post somebody has held — here, or somewhere before here.

    Kept as its own model (not a JSON blob) so entries can be added and removed
    individually and later reported on.

    **Why `kind` rather than two models.** A job at a previous employer and a
    post held inside this company carry the same six facts, so two tables would
    be the same columns twice and every reader would have to union them to
    answer "what has this person done". They are shown as two sections, which
    is the part that actually differs: one is what the company knows
    first-hand, the other is what somebody told us at interview.
    """

    class Kind(models.TextChoices):
        #: Somewhere else, before joining. Self-declared.
        PREVIOUS = "previous", "Previous employment"
        #: A post held inside this company.
        INTERNAL = "internal", "Held here"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="experiences")
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.PREVIOUS)
    title = models.CharField(max_length=150)
    company = models.CharField(max_length=150, blank=True)
    start_year = models.PositiveIntegerField(null=True, blank=True)
    end_year = models.PositiveIntegerField(null=True, blank=True)  # null = present
    description = models.TextField(blank=True)
    #: Whether HR has checked it against a document. Only meaningful on a
    #: `PREVIOUS` entry — an internal post is a fact this system wrote itself.
    is_verified = models.BooleanField(default=False)

    class Meta:
        ordering = ["-start_year", "-id"]

    def __str__(self):
        return f"{self.title} @ {self.company}"


class Suspension(AuditModel):
    """Employed, not working, and locked out.

    **Why a record rather than a status field.** "Suspended" needs three things
    a `CharField` cannot hold: when it started, when it ends, and how it ended.
    Without them, lifting a suspension means somebody remembering to, and
    "suspended since when?" is answerable only from a chat log.

    **The interval is the point.** A suspension is normally *until a date* —
    pending an inquiry, for a fixed number of days — and `ends_on` is what lets
    it lift itself. Left empty it is indefinite, which is a deliberate and much
    rarer thing to record: it means nobody has decided yet, and it sits on the
    roster until somebody does.

    **It can end in termination**, which is why `outcome` exists. A suspension
    that ends is not the same event as one that becomes a dismissal, and
    reporting on "how many inquiries ended in dismissal" needs the difference
    written down rather than inferred from a status change that happened on
    roughly the same day.

    **The lock-out is `User.is_active`**, set by `employees/suspensions.py`.
    SimpleJWT checks that flag on every request, so a suspension takes effect
    on the next call rather than whenever the fifteen-minute access token
    happens to expire. Nothing else in the product needs to know.
    """

    class Outcome(models.TextChoices):
        #: Running, or ended without anybody recording what happened.
        PENDING = "pending", "Pending"
        REINSTATED = "reinstated", "Reinstated"
        TERMINATED = "terminated", "Ended in termination"
        #: The inquiry found nothing. Distinct from reinstated: one is "your
        #: time is served", the other is "this should not have happened".
        WITHDRAWN = "withdrawn", "Withdrawn"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="suspensions")
    starts_on = models.DateField()
    #: Empty means indefinite — until somebody decides. A date means the
    #: suspension lifts itself on the morning after it.
    ends_on = models.DateField(
        null=True, blank=True, help_text="Leave empty for an indefinite suspension."
    )
    reason = models.TextField()
    #: Whether the person is *currently* locked out under this record.
    #:
    #: Derived and written by `employees/suspensions.py`, never set by hand. It
    #: is stored rather than computed on read because the lock it drives is a
    #: flag on `User`, and the two have to change together or they drift.
    is_active = models.BooleanField(default=False)
    outcome = models.CharField(max_length=20, choices=Outcome.choices, default=Outcome.PENDING)
    outcome_note = models.TextField(blank=True)
    lifted_on = models.DateField(null=True, blank=True)
    lifted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        ordering = ["-starts_on", "-id"]

    def __str__(self):
        window = f"{self.starts_on} - {self.ends_on or 'indefinite'}"
        return f"{self.employee.employee_code} suspended {window}"

    def covers(self, on_date):
        """Is this suspension in force on that date?

        `lifted_on` is checked before the interval, and that ordering is the
        whole of it. Lifting sets `ends_on` to today so the record reads
        sensibly, and a plain `on_date <= ends_on` then says the suspension is
        still running for the rest of the day it was lifted — so somebody
        reinstated at ten in the morning stays locked out until midnight. Once
        it is lifted it is over.
        """
        if self.lifted_on is not None and self.lifted_on <= on_date:
            return False
        if on_date < self.starts_on:
            return False
        return self.ends_on is None or on_date <= self.ends_on


class Award(AuditModel):
    """Something the company gave somebody for doing well.

    Its own record rather than a `LifecycleEvent` of type `award`. That model
    is a *workflow* — a request that gets approved and then changes a field —
    and an award changes no field: it is a fact about the past with a citation,
    a date and usually a certificate attached. Reporting on "who has been
    recognised, and for what" over a lifecycle table means filtering out four
    other event types and every rejected request among them.
    """

    class Kind(models.TextChoices):
        PERFORMANCE = "performance", "Performance"
        LONG_SERVICE = "long_service", "Long service"
        SAFETY = "safety", "Safety"
        INNOVATION = "innovation", "Innovation"
        TEAMWORK = "teamwork", "Teamwork"
        OTHER = "other", "Other"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="awards")
    title = models.CharField(max_length=200)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.OTHER)
    awarded_on = models.DateField()
    #: Who gave it. Free text because it is frequently a body rather than a
    #: user of this system — a ministry, a client, the board.
    awarded_by = models.CharField(max_length=200, blank=True)
    #: The sentence read out. Worth its own field rather than folding into a
    #: description: it is what gets reprinted on a certificate.
    citation = models.TextField(blank=True)
    #: Where there was one. Cash, a scholarship, extra leave — recorded as text
    #: because it is not always money and this is not a payroll instruction.
    reward = models.CharField(max_length=200, blank=True)
    certificate = models.FileField(upload_to="employees/awards/", null=True, blank=True)

    class Meta:
        ordering = ["-awarded_on", "-id"]

    def __str__(self):
        return f"{self.title} - {self.employee.employee_code}"


class DisciplinaryAction(AuditModel):
    """A formal step taken against somebody, and how it ended.

    **Separate from `Suspension`, although one severity is suspension.** A
    suspension is a *state* — it locks an account and has to lift itself. A
    disciplinary action is the *decision*, which may or may not produce one.
    Recording them together would mean either a verbal warning pointlessly
    carrying an interval, or a lock-out that depends on somebody picking the
    right severity from a dropdown.
    """

    class Severity(models.TextChoices):
        VERBAL = "verbal", "Verbal warning"
        WRITTEN = "written", "Written warning"
        FINAL = "final", "Final warning"
        SUSPENSION = "suspension", "Suspension"
        DEMOTION = "demotion", "Demotion"
        DISMISSAL = "dismissal", "Dismissal"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        UNDER_REVIEW = "under_review", "Under review"
        UPHELD = "upheld", "Upheld"
        #: The employee appealed and won, or the inquiry found nothing.
        OVERTURNED = "overturned", "Overturned"
        CLOSED = "closed", "Closed"

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="disciplinary_actions"
    )
    subject = models.CharField(max_length=200)
    severity = models.CharField(max_length=20, choices=Severity.choices, default=Severity.VERBAL)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    incident_date = models.DateField()
    issued_on = models.DateField()
    description = models.TextField(blank=True)
    #: What the person said. Held on the record rather than in an attachment,
    #: because a file nobody opens is not a right of reply.
    employee_response = models.TextField(blank=True)
    action_taken = models.TextField(blank=True)
    #: When this stops counting against them. A warning that never expires is a
    #: dismissal on the instalment plan.
    expires_on = models.DateField(
        null=True, blank=True,
        help_text="After this date the action no longer counts against them.",
    )
    #: Set where the action produced one, so the two records point at each
    #: other rather than being joined by their dates.
    suspension = models.OneToOneField(
        Suspension, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="disciplinary_action",
    )
    document = models.FileField(upload_to="employees/disciplinary/", null=True, blank=True)

    class Meta:
        ordering = ["-issued_on", "-id"]

    def __str__(self):
        return f"{self.get_severity_display()} - {self.employee.employee_code}: {self.subject}"


class EmployeeLog(models.Model):
    """Append-only lifecycle history: status changes (e.g. termination) and
    reassignments (department/designation/manager). Distinct from
    AuditModel's created_by/updated_by, which only ever shows the *last*
    change — this keeps every past one, per field, forever."""

    class Field(models.TextChoices):
        EMPLOYMENT_STATUS = "employment_status", "Employment status"
        DEPARTMENT = "department", "Department"
        DESIGNATION = "designation", "Designation"
        MANAGER = "manager", "Manager"
        PROBATION_END_DATE = "probation_end_date", "Probation end date"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="logs")
    field = models.CharField(max_length=30, choices=Field.choices)
    from_value = models.CharField(max_length=255, blank=True)
    to_value = models.CharField(max_length=255, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.employee.employee_code}: {self.field} {self.from_value!r} -> {self.to_value!r}"


class LifecycleEvent(AuditModel):
    """A first-class workflow (Promotion/Award/Resignation/Termination/
    Transfer) — distinct from a raw PATCH to Employee fields, since these
    need an effective date and (except Award) HR approval before the
    underlying field change actually happens. Applying an approved event
    still writes to the existing EmployeeLog — this model is the request/
    workflow, EmployeeLog stays the one place field-change history lives."""

    class EventType(models.TextChoices):
        PROMOTION = "promotion", "Promotion"
        AWARD = "award", "Award"
        RESIGNATION = "resignation", "Resignation"
        TERMINATION = "termination", "Termination"
        TRANSFER = "transfer", "Transfer"

    class Status(models.TextChoices):
        PENDING_APPROVAL = "pending_approval", "Pending Approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"
        APPLIED = "applied", "Applied"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="lifecycle_events")
    event_type = models.CharField(max_length=20, choices=EventType.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING_APPROVAL)
    effective_date = models.DateField()
    reason = models.TextField(blank=True)

    # Promotion
    new_designation = models.ForeignKey(
        Designation, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Transfer
    new_department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    new_manager = models.ForeignKey(
        Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Award
    award_title = models.CharField(max_length=150, blank=True)
    # Resignation / Termination
    last_working_date = models.DateField(null=True, blank=True)

    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.employee.employee_code}: {self.get_event_type_display()} ({self.status})"


class LifecycleApprovalAction(models.Model):
    """Append-only decision history — same pattern as leave.ApprovalAction."""

    class Decision(models.TextChoices):
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    event = models.ForeignKey(LifecycleEvent, on_delete=models.CASCADE, related_name="actions")
    decision = models.CharField(max_length=20, choices=Decision.choices)
    comment = models.TextField(blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.event_id}: {self.decision}"


class EmergencyContact(AuditModel):
    """Who to call, and in what order.

    Several rather than one field-pair on `Employee`: the first person is often
    unreachable precisely when they are needed, and a single `emergency_phone`
    column makes "try her brother next" a note in somebody's head.

    `is_primary` orders them rather than restricting them. Exactly-one is
    enforced in the service, not by a database constraint — a constraint would
    make *removing* the primary contact fail, which is the moment somebody most
    needs to edit the list.
    """

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="emergency_contacts"
    )
    name = models.CharField(max_length=150)
    relationship = models.CharField(max_length=60, help_text="Spouse, parent, sibling, friend.")
    phone = models.CharField(max_length=30)
    alternate_phone = models.CharField(max_length=30, blank=True)
    address = models.CharField(max_length=255, blank=True)
    is_primary = models.BooleanField(default=False, help_text="Called first.")

    class Meta:
        ordering = ["-is_primary", "name"]

    def __str__(self):
        return f"{self.name} ({self.relationship}) for {self.employee.employee_code}"


class Dependant(AuditModel):
    """A person this employee supports.

    Kept because insurance and medical schemes are quoted per dependant, and
    because a death-in-service payout has to reach somebody. Deliberately *not*
    wired into the tax calculation: Nepal's income tax is not banded by
    dependants, and a field that looks like it affects tax but does not is worse
    than no field.
    """

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="dependants")
    name = models.CharField(max_length=150)
    relationship = models.CharField(max_length=60)
    date_of_birth = models.DateField(null=True, blank=True)
    is_covered_by_insurance = models.BooleanField(
        default=False, help_text="Included on the company medical policy."
    )
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.relationship})"


class Nominee(AuditModel):
    """Who receives a fund if the employee dies.

    **Per scheme, not per person.** SSF, provident fund, CIT and gratuity are
    separate arrangements with separate nomination forms, and somebody can name
    their spouse on one and their children on another. One nominee list would
    force a single answer onto four different legal instruments.

    Shares are a percentage and must total 100 within a scheme — checked in the
    serializer rather than the database, because a partially-entered list is a
    normal intermediate state and a constraint would refuse the first row.
    """

    class Scheme(models.TextChoices):
        SSF = "ssf", "Social Security Fund"
        PF = "pf", "Provident Fund"
        CIT = "cit", "Citizen Investment Trust"
        GRATUITY = "gratuity", "Gratuity"
        INSURANCE = "insurance", "Life insurance"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="nominees")
    scheme = models.CharField(max_length=20, choices=Scheme.choices)
    name = models.CharField(max_length=150)
    relationship = models.CharField(max_length=60)
    date_of_birth = models.DateField(null=True, blank=True)
    citizenship_number = models.CharField(max_length=50, blank=True)
    share_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=100,
        help_text="Shares within one scheme must total 100.",
    )

    class Meta:
        ordering = ["scheme", "-share_percent", "name"]

    def __str__(self):
        return f"{self.name} — {self.get_scheme_display()} {self.share_percent}%"


class EducationRecord(AuditModel):
    """A qualification, as claimed and as verified.

    `verified_at` is separate from the record itself because a degree somebody
    typed in and a degree HR has seen a certificate for are different facts, and
    collapsing them is how an unverified claim quietly becomes a credential.
    """

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="education_records"
    )
    institution = models.CharField(max_length=200)
    qualification = models.CharField(max_length=150, help_text="BSc, +2, SLC, MBA.")
    field_of_study = models.CharField(max_length=150, blank=True)
    start_year = models.PositiveIntegerField(null=True, blank=True)
    end_year = models.PositiveIntegerField(null=True, blank=True)
    grade = models.CharField(max_length=60, blank=True, help_text="GPA, percentage or division.")
    certificate = models.FileField(
        upload_to=employee_resume_upload_path, null=True, blank=True
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        ordering = ["-end_year", "institution"]

    def __str__(self):
        return f"{self.qualification} — {self.institution}"

    @property
    def is_verified(self):
        return self.verified_at is not None


class EmployeeChangeRequest(AuditModel):
    """A change an employee has asked for, and somebody else has to approve.

    **Why this is not just letting people edit their own profile.** A bank
    account number changed silently the day before payroll sends a salary
    somewhere else, and nothing about the run looks wrong afterwards. The fields
    listed in `employees.change_requests` are the ones that move money or
    establish legal identity, so they are requested rather than written.

    **The row is the audit record**, which is why nothing here is ever deleted.
    `EmployeeLog` covers lifecycle changes and has a fixed field set that these
    do not belong in; rather than widen it — or add a second history mechanism,
    which `employees/services.py` explicitly refuses to do — the request itself
    carries the whole story: who asked, what for, what it was before, who
    decided, when, and why.

    Withdrawing and superseding are **state changes, never deletes**, for the
    same reason: "I never asked for that" and "I asked and changed my mind" are
    different facts, and only one of them is true.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        #: The employee took it back before anybody decided.
        WITHDRAWN = "withdrawn", "Withdrawn"
        #: They asked again for the same field. Kept rather than deleted so the
        #: sequence of what somebody asked for stays readable.
        SUPERSEDED = "superseded", "Superseded"

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="change_requests"
    )
    #: Validated against `change_requests.REQUESTABLE_FIELDS` in the service
    #: rather than by `choices`, because the allow-list is what stops somebody
    #: requesting a change to a field nobody agreed could be requested — and a
    #: `choices` list on a migration is a worse place to keep a security rule.
    field = models.CharField(max_length=40)
    #: What it was when they asked. Snapshotted so the approver sees what the
    #: employee was looking at, not what it happens to be at decision time.
    old_value = models.CharField(max_length=255, blank=True)
    new_value = models.CharField(max_length=255)
    #: Why they are asking. Optional — "I moved house" adds nothing to an
    #: address change, and requiring it would train people to type a full stop.
    reason = models.CharField(max_length=255, blank=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    #: Required on a rejection. A refusal with no reason sends the employee back
    #: to HR by email to ask why, which is the loop this model exists to close.
    decision_note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # The two questions asked of this table: "what is waiting for me to
            # approve" and "what did I ask for".
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["employee", "status"]),
        ]

    def __str__(self):
        return f"{self.employee.employee_code}: {self.field} → {self.new_value} ({self.status})"
