from decimal import Decimal

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from core.models import AuditModel
from employees.models import Employee


def company_logo_upload_path(instance, filename):
    # Company-schema-namespaced, same reasoning as documents.document_upload_path
    # — all companies currently share one local disk.
    return f"company/logo/{filename}"


def validate_iso_weekdays(value):
    """Refuse a working week written in the wrong dialect.

    `working_days` is read with `isoweekday()`, where Monday is 1 — not with
    Python's `date.weekday()`, where Monday is 0. A week written in the wrong
    dialect shifts every day by one, turning Saturday into a working day and
    Friday into a holiday, and every leave balance is then computed against a
    week nobody works.

    **Nothing catches that at runtime.** The check is `day.isoweekday() in
    working` — a set membership, false rather than an error — so a week that is
    entirely wrong behaves exactly like a week that is merely unusual. The only
    place the mistake is visible is the moment it is written down, which is
    here.

    0 is the tell, and it is rejected explicitly: no ISO weekday is 0, so its
    presence means the whole list is off by one rather than that one entry is
    stray.
    """
    if not isinstance(value, list):
        raise ValidationError("Working days must be a list of ISO weekday numbers.")
    for day in value:
        try:
            number = int(day)
        except (TypeError, ValueError):
            raise ValidationError(f"{day!r} is not a weekday number.") from None
        if number == 0:
            raise ValidationError(
                "0 is not an ISO weekday — Monday is 1 and Sunday is 7. A list "
                "containing 0 was almost certainly written for Python's "
                "date.weekday(), and every day in it is off by one."
            )
        if not 1 <= number <= 7:
            raise ValidationError(f"{number} is not a weekday: use 1 (Monday) to 7 (Sunday).")


class CompanyProfile(AuditModel):
    """Singleton per company (one row, pk=1 via get_solo()) — org-level
    settings HR configures once, not a list of records."""

    name = models.CharField(max_length=200)
    logo = models.ImageField(upload_to=company_logo_upload_path, null=True, blank=True)
    address = models.TextField(blank=True)
    timezone = models.CharField(max_length=64, default="Asia/Kathmandu")

    # Which calendar this company runs on — chosen at setup, not assumed.
    #
    # It decides what "this year" means for a leave entitlement, which fiscal
    # year a payslip belongs to, and what a payslip prints. Before this field
    # existed, nine places answered "BS" on their own, including
    # payroll/services.py — the exact file §2.3 names when it says that
    # hardcoding a Nepal rule costs us the engine.
    #
    # Defaults to BS because that is who we sell to first. A default is not the
    # same as an assumption: a company in Delhi or Dubai changes one field, and
    # nothing in the engine has to know they did.
    class Calendar(models.TextChoices):
        BIKRAM_SAMBAT = "BS", "Bikram Sambat (Shrawan–Ashad)"
        GREGORIAN = "AD", "Gregorian (January–December)"

    calendar = models.CharField(
        max_length=4,
        choices=Calendar.choices,
        default=Calendar.BIKRAM_SAMBAT,
        help_text="The calendar this company's fiscal year, payslips and leave entitlements follow.",
    )

    #: Which month of the chosen calendar the financial year opens on.
    #:
    #: **Nullable, and null is the common answer.** Every calendar already
    #: knows its own default — Bikram Sambat opens on Shrawan (month 4) and
    #: closes at the end of Ashad, Gregorian opens in January — so a Nepali
    #: company never touches this and nothing about their setup changes.
    #:
    #: It exists for everyone else. A fiscal year is a *country's* rule, not a
    #: calendar's: India and the UK run April–March, Australia July–June, the
    #: US federal year October–September, all of them on the same Gregorian
    #: calendar this model already offers. Without this field the product
    #: silently asserts January–December for every one of them, which is the
    #: exact shape of hardcoded-country-rule that §2.3 says costs us the engine.
    #:
    #: Stored as a **month of the company's calendar**, not a Gregorian month,
    #: because that is the number a person answering "when does your financial
    #: year start?" actually knows.
    fiscal_year_start_month = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        choices=[(m, str(m)) for m in range(1, 13)],
        help_text=(
            "Month the financial year opens on, in the calendar above. "
            "Leave empty to use that calendar's own year — Shrawan for Bikram "
            "Sambat, January for Gregorian."
        ),
    )
    # ── Office hours ─────────────────────────────────────────────────────
    #
    # **A company has opening hours, and somebody with no shift is judged
    # against them** (D24).
    #
    # The alternative — nobody without a shift can ever be late — is safer, in
    # that it never docks anybody under a rule nobody set. It is also wrong
    # about how an office works: most staff are never assigned a shift at all,
    # they come in when the office opens. Under that reading lateness would
    # apply to shift workers and silently to nobody else, which is not a rule
    # anybody would recognise as fair.
    #
    # A `Shift` still wins where one is assigned. This is the floor, not an
    # override — a night-shift worker is judged against their night shift.
    #
    # Nullable, and null means *no opinion*: a company that has not set opening
    # hours keeps the old behaviour exactly, where an unshifted employee is
    # never late. So this is additive, and D‑05 stays inert until both a rule
    # and a time exist.
    #: Time inside the office span that is not worked — lunch, chiefly.
    #:
    #: Subtracted from the office span to get the paid day: 09:00–18:00 with an
    #: hour for lunch is eight paid hours, not nine. A fulfilment target an hour
    #: out is worse than no target — it tells somebody they are nearly done when
    #: they finished an hour ago.
    unpaid_break_minutes = models.PositiveIntegerField(
        default=60,
        help_text="Minutes of the office span that are not paid — lunch, usually.",
    )

    office_start_time = models.TimeField(
        null=True,
        blank=True,
        help_text=(
            "When the office opens. Used to judge lateness for employees with no "
            "shift assigned. Leave empty and they are never marked late."
        ),
    )
    office_end_time = models.TimeField(
        null=True,
        blank=True,
        help_text="When the office closes. Recorded alongside the opening time.",
    )
    #: Kept separate from `Shift.grace_period_minutes` rather than shared: a
    #: company's general tolerance for traffic and a particular shift's are
    #: different decisions, and one changing should not move the other.
    office_grace_period_minutes = models.PositiveIntegerField(
        default=15,
        help_text="Minutes after opening before somebody counts as late.",
    )

    # ── Retirement & savings schemes ─────────────────────────────────────
    #
    # Before these fields, SSF/PF/CIT were not concepts the system knew: the
    # rates sat in `StatutoryRate` read by nothing, and the actual deduction
    # was whatever a company named a `SalaryComponent`. See `payroll/schemes.py`.
    #
    # All three default to "not configured", so a company that never touches
    # them computes exactly the payslips it computed before — the same additive
    # promise `AttendancePolicy` makes by treating silence as permission.

    class RetirementScheme(models.TextChoices):
        SSF = "ssf", "Social Security Fund"
        PROVIDENT_FUND = "pf", "Provident Fund"

    #: 🔒 **One or neither, never both.** SSF and PF deduct from the same base,
    #: so a company running the two together takes 21% of basic off somebody
    #: who owes 11% — and the payslip looks entirely ordinary. Modelled as a
    #: single choice rather than two booleans precisely so the invalid state
    #: cannot be represented.
    retirement_scheme = models.CharField(
        max_length=10,
        choices=RetirementScheme.choices,
        blank=True,
        help_text=(
            "Which retirement fund this company is enrolled in. SSF and PF are "
            "alternatives — running both would double-deduct. Leave empty if neither."
        ),
    )

    #: Contributions temporarily stopped, without forgetting which programme
    #: this company is on.
    #:
    #: **Pausing and having no scheme are different facts**, which is why this
    #: is not just clearing `retirement_scheme`. A company between fund
    #: registrations, or one that has suspended contributions while a dispute is
    #: settled, is still an SSF company — clearing the field would lose that,
    #: and the year-to-date figures would then have no programme to sit under
    #: when it resumes.
    #:
    #: While paused nothing is deducted and nothing is recorded, so the tax
    #: band waiver falls away too — correctly, since it is contributing that
    #: earns it, not being enrolled.
    retirement_paused = models.BooleanField(
        default=False,
        help_text=(
            "Stop deducting for the chosen fund without changing which fund it is. "
            "Existing contribution history is kept."
        ),
    )

    #: CIT is a *voluntary employee* saving, so the company only decides whether
    #: it is offered; how much goes in is per-person and lives on the enrolment.
    offers_cit = models.BooleanField(
        default=False,
        help_text="Employees may contribute to the Citizen Investment Trust through payroll.",
    )

    #: Gratuity is an employer liability, and only for employers **not** on SSF —
    #: SSF absorbs it, so charging both is the same double-count one layer up.
    #: `payroll.schemes.company_schemes` enforces that rather than trusting this
    #: flag alone.
    provides_gratuity = models.BooleanField(
        default=False,
        help_text="Employer-funded gratuity. Not applicable on SSF, which already covers it.",
    )

    # Configurable rather than a hardcoded weekend: the working week is not
    # Monday–Friday everywhere, and baking one in is exactly the
    # country-specific assumption the engine is meant to stay clear of
    # (docs/development-plan.md §2.3). Same principle as the attendance calendar.
    #
    # The doc pointer is a comment, not help_text — help_text is user-facing
    # and tracked in migrations, so an internal path in it means renaming a
    # document generates a schema migration.
    working_days = models.JSONField(
        default=list,
        validators=[validate_iso_weekdays],
        help_text="ISO weekday numbers (1=Monday..7=Sunday) that count as working days.",
    )
    class PayBasis(models.TextChoices):
        CALENDAR = "calendar", "Calendar month"
        WORKING_DAYS = "working_days", "Working days"

    #: What one day of pay is worth, when absence has to be priced.
    #:
    #: **Calendar** divides the month's pay by the days in the month, so a day
    #: of unpaid leave costs 1/30 or 1/31. The salary is understood to cover the
    #: whole month, weekends included, so a weekend costs nothing precisely
    #: because it was never counted as working.
    #:
    #: **Working days** divides by the days the company actually works, so the
    #: same absence costs 1/22 — a larger deduction, because the salary is
    #: understood to buy those 22 days and one of them was not delivered.
    #:
    #: Both are in use and neither is more correct; which one a company means is
    #: a term of employment, not a fact the engine can derive. It defaults to
    #: `CALENDAR`, which is what the engine did before this field existed, so no
    #: company's payslips change until somebody chooses.
    pay_basis = models.CharField(
        max_length=20,
        choices=PayBasis.choices,
        default=PayBasis.CALENDAR,
        help_text=(
            "How one day of pay is valued when absence is deducted. Calendar "
            "month divides by the days in the month; working days divides by "
            "the days this company works, which makes each absence cost more."
        ),
    )
    payroll_prorate = models.BooleanField(
        default=True,
        help_text="When on, a payslip is prorated by the number of calendar days the "
        "employee is actually payable in the month (driven by salary-structure "
        "effective date, join date and last working date). When off, any active "
        "structure pays the full month regardless of when it started.",
    )

    # Overtime is paid at a premium over the ordinary hourly rate. The premium
    # is set by law and changes by jurisdiction, so it is configuration here and
    # never a constant in the engine (§1.1 advantage #2, and the same reasoning
    # as TaxSlab).
    #
    # 1.5 is the widely-used premium and a deliberate starting point, NOT a
    # verified figure — **D14 owes a check against the current Labour Act
    # before any company goes live.** It is snapshotted onto each overtime
    # record at approval, so correcting it later cannot silently restate
    # overtime that was already authorised.
    overtime_multiplier = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=Decimal("1.5"),
        help_text="Multiplier applied to the ordinary hourly rate for approved overtime. "
        "Verify against the current Labour Act before going live.",
    )

    def __str__(self):
        return self.name

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1, defaults={"name": "My Company", "working_days": [1, 2, 3, 4, 5]})
        return obj


class CompanyEmailSettings(AuditModel):
    """Singleton per company (get_solo()) — lets a company's HR send email
    under their own address/SMTP instead of the platform default. The
    password is encrypted at rest (Fernet, settings.FIELD_ENCRYPTION_KEY)
    and NEVER serialized back out in a read response — only whether it's
    set. See organization/email_backend.py for how this actually gets
    used, and organization/README.md for the full security rationale."""

    host = models.CharField(max_length=255, blank=True)
    port = models.PositiveIntegerField(default=587)
    username = models.CharField(max_length=255, blank=True)
    encrypted_password = models.BinaryField(blank=True, null=True)
    from_email = models.EmailField(blank=True)
    use_tls = models.BooleanField(default=True)
    is_active = models.BooleanField(
        default=False, help_text="Use these settings instead of the platform default."
    )

    # IMAP settings for the inbox (Phase 11c). The same account as SMTP —
    # username/encrypted_password are reused; only the server coordinates
    # differ (IMAP is a separate host/port from SMTP even at one provider,
    # e.g. Gmail: smtp.gmail.com:587 vs imap.gmail.com:993).
    imap_host = models.CharField(max_length=255, blank=True)
    imap_port = models.PositiveIntegerField(default=993)
    imap_use_ssl = models.BooleanField(default=True)

    def __str__(self):
        return f"Email settings ({'active' if self.is_active else 'inactive'})"

    def set_password(self, raw_password):
        fernet = Fernet(settings.FIELD_ENCRYPTION_KEY.encode())
        self.encrypted_password = fernet.encrypt(raw_password.encode())

    def get_password(self):
        if not self.encrypted_password:
            return ""
        fernet = Fernet(settings.FIELD_ENCRYPTION_KEY.encode())
        try:
            return fernet.decrypt(bytes(self.encrypted_password)).decode()
        except InvalidToken:
            # FIELD_ENCRYPTION_KEY rotated/lost — fail closed (no password)
            # rather than raising and breaking every outgoing email.
            return ""

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class ReviewCycle(AuditModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"

    name = models.CharField(max_length=150)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)

    class Meta:
        ordering = ["-start_date"]

    def __str__(self):
        return self.name


class Review(AuditModel):
    """One per employee per cycle. reviewer snapshots the employee's
    manager *at cycle-start time* (not a live FK lookup) — same
    "snapshot, don't recompute" principle as PayslipLineItem, so a later
    manager reassignment doesn't retroactively change who was reviewing
    an in-progress cycle."""

    class Status(models.TextChoices):
        PENDING_SELF = "pending_self", "Pending Self-Assessment"
        PENDING_MANAGER = "pending_manager", "Pending Manager Review"
        COMPLETED = "completed", "Completed"

    cycle = models.ForeignKey(ReviewCycle, on_delete=models.CASCADE, related_name="reviews")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="reviews")
    reviewer = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviews_given"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING_SELF)

    self_assessment = models.TextField(blank=True)
    self_rating = models.PositiveSmallIntegerField(null=True, blank=True)
    self_submitted_at = models.DateTimeField(null=True, blank=True)

    manager_assessment = models.TextField(blank=True)
    manager_rating = models.PositiveSmallIntegerField(null=True, blank=True)
    manager_submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["cycle", "employee"], name="unique_cycle_employee_review")
        ]

    def __str__(self):
        return f"{self.employee.employee_code} — {self.cycle.name}"


class SetupSkip(AuditModel):
    """A setup check somebody decided not to do.

    **The only thing about readiness that is stored.** Whether a check *passes*
    is asked of the database every time it is read — a stored "done" flag that
    survives somebody deleting the salary structure is worse than no check,
    because it is believed. But skipping is not a state of the world; it is a
    judgement a person made, and there is nothing to derive it from.

    **A reason is required.** A skip with no reason is indistinguishable from
    an oversight three months later, and the person who has to decide whether
    to undo it is usually not the person who did it.

    Undoing is a plain delete, and that is the point: the check goes back to
    saying what is true rather than what somebody once decided. §R2 asks for a
    removal path on anything you can add, and this is one where a hard delete
    destroys no history worth keeping — the audit trail of who skipped what
    lives on the row while it exists, and the check itself is the record after.

    **Must-have checks are never skippable**, which is enforced in the service
    rather than by hiding the button: a tier whose entries can be waved through
    is a recommendation wearing a badge.
    """

    check_key = models.CharField(max_length=64, unique=True)
    reason = models.CharField(max_length=255)

    class Meta:
        ordering = ["check_key"]

    def __str__(self):
        return f"{self.check_key} skipped — {self.reason}"
