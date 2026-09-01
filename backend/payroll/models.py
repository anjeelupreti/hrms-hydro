from django.core.validators import RegexValidator
from django.db import models

from core.models import AuditModel
from employees.models import Employee
from payroll.periods import default_period_calendar

component_code_validator = RegexValidator(
    r"^[a-z][a-z0-9_]*$",
    "Use lowercase letters, digits, and underscores, starting with a letter — "
    "the code doubles as a variable name inside FORMULA components.",
)


class SalaryComponent(AuditModel):
    """Configurable, not hardcoded to one tax regime (per docs/development-plan.md).
    `order` decides both display order and computation order — a FORMULA
    or PERCENTAGE_OF component can only reference the code of a component
    computed *before* it in that same pass."""

    class ComponentType(models.TextChoices):
        EARNING = "earning", "Earning"
        DEDUCTION = "deduction", "Deduction"

    class CalcType(models.TextChoices):
        FLAT = "flat", "Flat amount"
        PERCENTAGE_OF = "percentage_of", "Percentage of another component"
        FORMULA = "formula", "Formula"
        SLAB_BASED = "slab_based", "Slab-based (tax slabs)"

    code = models.CharField(max_length=50, unique=True, validators=[component_code_validator])
    name = models.CharField(max_length=100)
    component_type = models.CharField(max_length=20, choices=ComponentType.choices)
    calc_type = models.CharField(max_length=20, choices=CalcType.choices)
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        help_text="Flat amount, or the percentage value (e.g. 10 for 10%) for PERCENTAGE_OF. Ignored for FORMULA/SLAB_BASED.",
    )
    percentage_of = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
        help_text="Required for PERCENTAGE_OF — the component this one is a percentage of.",
    )
    formula = models.TextField(
        blank=True,
        help_text="Required for FORMULA. Evaluated with simpleeval (never eval) against the "
        "codes of components already computed earlier in this pass — no attribute/method access.",
    )
    #: Which retirement scheme this component implements, if any.
    #:
    #: **Declared, never inferred from the name.** A company's own deduction
    #: component and `CompanyProfile.retirement_scheme` can both implement the
    #: same obligation, and nothing about the component's name says so. Left
    #: untagged, both deduct from the same basic, the payslip looks entirely
    #: ordinary, and somebody loses 21% instead of 11%.
    #:
    #: Tagging is what lets the system see the overlap: a company marks their
    #: "Provident Fund" component `pf`, and the service refuses to run both.
    scheme = models.CharField(
        max_length=20,
        blank=True,
        help_text=(
            "Set if this component IS a retirement contribution (SSF/PF/CIT). "
            "Used to stop it running alongside the company scheme and deducting twice."
        ),
    )
    taxable = models.BooleanField(default=True)
    # Whether unpaid absence reduces this component.
    #
    # Per-component rather than one company-wide rule, because the answer
    # genuinely differs by component: basic is reduced by a day not worked,
    # while a fixed transport or housing allowance usually is not, and a
    # statutory employer contribution certainly is not. A single global setting
    # forces the company to be wrong about at least one of them.
    #
    # Default False, so this is opt-in. In a payroll system the safe default
    # is the one that changes nobody's pay until somebody asks for it.
    reduced_by_absence = models.BooleanField(
        default=False,
        help_text="Unpaid leave and absence reduce this component pro rata by calendar day.",
    )
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "code"]

    def __str__(self):
        return f"{self.code} ({self.get_calc_type_display()})"


class SalaryStructure(AuditModel):
    """A per-employee salary structure, effective from a given date. Never
    edited in place — a change means a new row with a later effective_from,
    so historical payroll runs keep computing against the structure that
    was actually active at the time (audit trail via effective-dating,
    same principle as EmployeeLog)."""

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="salary_structures")
    effective_from = models.DateField()
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-effective_from"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "effective_from"], name="unique_employee_structure_effective_from"
            )
        ]

    def __str__(self):
        return f"{self.employee.employee_code} structure effective {self.effective_from}"


class SalaryStructureAssignment(AuditModel):
    """One component's amount within a specific SalaryStructure. `amount`
    is only meaningful for FLAT (the pay amount) and PERCENTAGE_OF (the
    rate, e.g. 10 for 10%) — FORMULA/SLAB_BASED components ignore it and
    are computed fresh every run."""

    structure = models.ForeignKey(SalaryStructure, on_delete=models.CASCADE, related_name="assignments")
    component = models.ForeignKey(SalaryComponent, on_delete=models.PROTECT, related_name="+")
    amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["structure", "component"], name="unique_structure_component")
        ]

    def __str__(self):
        return f"{self.structure_id}: {self.component.code}"


class SalaryTemplate(AuditModel):
    """A named pay structure, defined once and stamped onto people.

    **The gap this fills.** `SalaryStructure` is per-employee and
    effective-dated, which is right — it is the record of what somebody was
    actually paid from when. But it meant the only way to put a workforce on
    pay was to build the same set of components by hand, one employee at a
    time, and the only way to change a company-wide allowance was to repeat
    that. A hundred-person company is a hundred identical forms.

    **A template is not history, so unlike a structure it *is* editable.**
    That difference is the whole reason these are two models rather than one
    with a flag. Editing a structure would rewrite what a past payroll run
    computed against; editing a template changes nothing that has already
    happened, because a template is only ever a starting point — applying it
    *copies* its lines into a new structure and the two have no link
    afterwards. Somebody who edits the "Officer" template has not silently
    restated last month's payslips.

    **One may be marked default**, which is what makes "put everyone on this"
    a single decision rather than a hundred.
    """

    name = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True)
    #: The one offered first, and the one a bulk apply reaches for.
    #:
    #: Enforced as *at most one* by `save`, not by a partial unique index, so
    #: that marking a second template default demotes the first rather than
    #: raising — which is what somebody clicking "make this the default"
    #: means.
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["-is_default", "name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.is_default:
            SalaryTemplate.objects.exclude(pk=self.pk).filter(is_default=True).update(is_default=False)


class SalaryTemplateLine(AuditModel):
    """One component inside a template, with the amount to stamp.

    Mirrors `SalaryStructureAssignment` deliberately — same shape, same
    meaning of `amount` (only used by FLAT and PERCENTAGE_OF; FORMULA and
    SLAB_BASED compute themselves every run) — because applying a template is
    a copy, and a copy between two different shapes is where drift starts.
    """

    template = models.ForeignKey(SalaryTemplate, on_delete=models.CASCADE, related_name="lines")
    component = models.ForeignKey(SalaryComponent, on_delete=models.PROTECT, related_name="+")
    amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["template", "component"], name="unique_template_component")
        ]
        ordering = ["component__order", "component__code"]

    def __str__(self):
        return f"{self.template.name}: {self.component.code}"


class TaxSlab(AuditModel):
    """Ordered, company-configurable, effective-dated by fiscal year — never
    a hardcoded percentage, since tax slabs change by year and by country.
    `max_amount` null means "and above" (the top, open-ended slab).

    `fiscal_year` holds the **opening** year of the pair: 2082 means FY 2082/83.
    One integer, because that is what a column and a filter can hold; the
    "2082/83" that appears on every filing is rendered from it by
    `CalendarSystem.fiscal_year_label`. Storing the label instead would make
    every range query a string operation.
    """

    class Taxpayer(models.TextChoices):
        """Nepal's Income Tax Act sets **two rate tables**, not one.

        An individual and a married couple electing joint assessment have
        different band widths. Without a dimension for it a company can encode
        only one of the two, and the other is
        silently taxed on the wrong bands.
        """

        INDIVIDUAL = "individual", "Individual"
        COUPLE = "couple", "Couple"

    fiscal_year = models.PositiveIntegerField(
        help_text="Opening year of the fiscal year, e.g. 2082 for FY 2082/83."
    )
    taxpayer = models.CharField(
        max_length=20, choices=Taxpayer.choices, default=Taxpayer.INDIVIDUAL
    )
    order = models.PositiveIntegerField()
    min_amount = models.DecimalField(max_digits=12, decimal_places=2)
    max_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    rate = models.DecimalField(max_digits=5, decimal_places=2, help_text="Percentage, e.g. 10 for 10%.")
    # Nepal's lowest band is a social security tax rather than income tax, and
    # is **not levied** where the employee contributes to a recognised
    # retirement fund (SSF/PF). That is a rule about a band, not a rate, so it
    # cannot be expressed by the rate alone — a slab table without this charges
    # every contributing employee a tax they do not owe.
    #
    # Kept as a generic flag rather than an SSF-specific one: other countries
    # have bands that lapse on a condition, and naming it `waived_if_ssf` would
    # be the Nepal-specific hardcoding §1.1 exists to prevent.
    # Same honesty flag `StatutoryRate` carries, and for the same reason: the
    # Nepal pack now ships a slab table so a company can run payroll on day one,
    # and without this a seeded placeholder would be indistinguishable from a
    # band somebody checked against the Finance Act. Slabs are the figures that
    # decide how much tax leaves everybody's pay, so the distinction matters
    # more here than anywhere else.
    is_verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(
        max_length=255,
        blank=True,
        help_text="Where the verified band came from, e.g. 'Finance Act 2082, Schedule 1'.",
    )

    waived_if_retirement_contributor = models.BooleanField(
        default=False,
        help_text="Band is not charged when the employee contributes to a recognised retirement fund.",
    )

    class Meta:
        ordering = ["fiscal_year", "taxpayer", "order"]
        constraints = [
            models.UniqueConstraint(
                fields=["fiscal_year", "taxpayer", "order"],
                name="unique_fiscal_year_taxpayer_slab_order",
            )
        ]

    def __str__(self):
        upper = self.max_amount if self.max_amount is not None else "∞"
        return (
            f"FY{self.fiscal_year} {self.get_taxpayer_display()} "
            f"slab {self.order}: {self.min_amount}-{upper} @ {self.rate}%"
        )


class PayrollRun(AuditModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PROCESSING = "processing", "Processing"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    # **Which calendar the two numbers below are in** — D‑06.
    #
    # Recorded rather than assumed Gregorian. Turning the two numbers into a
    # date range with `monthrange` gives the wrong month for a company on Bikram
    # Sambat: Shrawan 2083 runs 17 July to 16 August, so an "August 2026" run
    # pays across two of their months and matches neither — while the payslip
    # prints BS and the rates key on the BS fiscal year. The labels agree with
    # the law; the window underneath would not.
    #
    # Existing runs are stamped `AD` by the migration because that is what they
    # actually were. Relabelling them would assert that money was paid for a
    # period it was not paid for.
    period_calendar = models.CharField(
        max_length=4,
        choices=[("AD", "Gregorian"), ("BS", "Bikram Sambat")],
        default=default_period_calendar,
        help_text="Calendar the period year and month are expressed in.",
    )
    period_year = models.PositiveIntegerField()
    period_month = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    notes = models.TextField(blank=True)

    # Period lock. Set when the run is finalised, and checked by the *service*
    # rather than only the API.
    #
    # `status` alone was not enough. It describes where the run got to; it does
    # not stop `compute_payslip` being called again, and that function deletes
    # every line item before recomputing. Celery delivers at least once, so a
    # re-delivered `process_payslip` after finalisation would silently restate
    # a payslip somebody has already been paid against — using *today's*
    # attendance and salary data, not the data the run was approved on.
    locked_at = models.DateTimeField(null=True, blank=True)
    locked_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    # Rollups, denormalised onto the run.
    #
    # Derived from the payslips, so strictly redundant — but a payroll run is
    # read far more often than it is computed (every list row, every dashboard
    # card, every report header), and summing every payslip's line items to
    # render a list is the kind of query that is fine with 20 employees and
    # not with 2,000. Written once by `recalculate_totals` at the end of a run
    # rather than maintained incrementally, because a partial update is how
    # these drift out of agreement with the payslips they summarise.
    total_gross = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_net = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    payslip_count = models.PositiveIntegerField(default=0)

    @property
    def is_locked(self):
        return self.locked_at is not None

    def recalculate_totals(self, save=True):
        """Re-derive the rollups from the payslips that actually exist.

        Recomputed wholesale rather than adjusted, so it is idempotent and
        self-healing: if anything ever goes out of step, running it again fixes
        it. Held payslips are **included** — they are still part of what the
        period costs, even though they are not being paid yet. What is due and
        what is disbursed are different questions, and conflating them would
        make the run's total change when someone places a hold.
        """
        from django.db.models import Count, Sum

        totals = self.payslips.aggregate(
            gross=Sum("gross_earnings"),
            deductions=Sum("total_deductions"),
            net=Sum("net_pay"),
            count=Count("id"),
        )
        self.total_gross = totals["gross"] or 0
        self.total_deductions = totals["deductions"] or 0
        self.total_net = totals["net"] or 0
        self.payslip_count = totals["count"] or 0
        if save:
            self.save(update_fields=[
                "total_gross", "total_deductions", "total_net", "payslip_count", "updated_at",
            ])
        return self

    @property
    def period_label(self):
        """"Shrawan 2083" — what the company calls the thing it is paying for."""
        from payroll.periods import period_label

        return period_label(self)

    class Meta:
        ordering = ["-period_year", "-period_month"]
        constraints = [
            # The calendar is part of the identity. Without it, a company that
            # switched from Gregorian to Bikram Sambat could not be stopped
            # from creating a second run over overlapping days, because the two
            # would carry different year numbers and look unrelated.
            models.UniqueConstraint(
                fields=["period_calendar", "period_year", "period_month"],
                name="unique_payroll_period",
            )
        ]

    def __str__(self):
        return f"Payroll {self.period_label} ({self.status})"


class Payslip(AuditModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        FINALIZED = "finalized", "Finalized"
        PAID = "paid", "Paid (manual)"

    class DisbursementMethod(models.TextChoices):
        BANK_TRANSFER = "bank_transfer", "Manual bank transfer"
        CASH = "cash", "Cash"
        WALLET = "wallet", "Manual wallet transfer"

    payroll_run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, related_name="payslips")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="payslips")
    gross_earnings = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net_pay = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Proration transparency: how many calendar days of the month the
    # employee was actually payable, out of the month's total. When
    # payable_days == period_days the earnings are a full month; otherwise
    # FLAT earnings were scaled by payable_days / period_days (see
    # payroll.services.compute_payslip).
    period_days = models.PositiveSmallIntegerField(default=0)
    payable_days = models.PositiveSmallIntegerField(default=0)

    # ── The absence arithmetic, shown rather than asserted ───────────────
    #
    # A deduction nobody can reproduce is the one that generates the email to
    # HR, so the payslip carries every number needed to redo the sum: which
    # basis was in force, what it divided by, how many days were charged, and
    # what that came to.
    #
    # Snapshotted, not derived on read. `CompanyProfile.pay_basis` is a setting
    # somebody can change on a Tuesday, and a payslip issued on Monday must keep
    # explaining itself in the terms it was actually computed under — the same
    # reason the salary structure is effective-dated.
    pay_basis = models.CharField(max_length=20, blank=True, default="")
    #: The divisor: days in the month on the calendar basis, working days on
    #: the other. Zero on payslips computed before this existed.
    basis_days = models.PositiveSmallIntegerField(default=0)
    #: Days charged — absence plus unpaid leave, a half day counting as half.
    unpaid_days = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    #: One day of the absence-reducible earnings, at this basis.
    day_value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    #: `day_value * unpaid_days`, taken off the components the company marked as
    #: reducible. Percentage components computed on top of a reduced base shrink
    #: with it; that shows in their own line items rather than here.
    absence_deduction = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    # ── What the month looked like, as it looked when this was computed ──
    #
    # Stored rather than derived on read, for the same reason the structure is
    # effective-dated: attendance keeps moving. A regularisation approved next
    # week would otherwise change the hours shown against a payslip that was
    # finalised and paid on the old figures, and the payslip would quietly stop
    # matching the money.
    #
    # Neither of these prices anything. Pay moves on absence, unpaid leave and
    # half days only; hours are here so somebody can see their own month.
    days_attended = models.PositiveSmallIntegerField(default=0)
    hours_worked = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)

    # Hold — deliberately a flag, not a fourth `Status` value.
    #
    # The checklist called it a "hold status", but a status cannot express it
    # without losing information: holding a FINALIZED payslip would overwrite
    # the very state you need in order to release it back, and releasing would
    # have to guess between DRAFT and FINALIZED. Hold is *orthogonal* to where
    # the payslip is in its lifecycle — it answers "may this be paid", not
    # "how far has this got" — so it is its own axis and `status` keeps meaning
    # one thing. Listing held payslips is a filter on this field, which is what
    # the checklist actually wanted.
    is_held = models.BooleanField(
        default=False,
        help_text="Blocks disbursement without discarding the payslip's status.",
    )
    hold_reason = models.TextField(blank=True)
    held_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    held_at = models.DateTimeField(null=True, blank=True)
    released_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    released_at = models.DateTimeField(null=True, blank=True)

    disbursement_method = models.CharField(max_length=20, choices=DisbursementMethod.choices, blank=True)
    # Why free text: this system never moves money itself. Khalti and eSewa
    # have no payout API, so a disbursement is something that happened in a
    # bank and is *recorded* here. See docs/development-plan.md, Phase 7.
    #
    # The doc pointer is a comment rather than help_text deliberately —
    # help_text is user-facing and is tracked in migrations, so an internal
    # path in it means renaming a document generates a schema migration.
    disbursement_reference = models.CharField(
        max_length=255,
        blank=True,
        help_text="Reference for the transfer, e.g. the bank transaction ID.",
    )
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-payroll_run__period_year", "-payroll_run__period_month", "employee__employee_code"]
        constraints = [
            models.UniqueConstraint(fields=["payroll_run", "employee"], name="unique_payroll_run_employee")
        ]

    def __str__(self):
        return f"{self.employee.employee_code} — {self.payroll_run}"


class Loan(AuditModel):
    """Employee self-service loan request. Once ACTIVE, its monthly
    deduction is wired into the employee's salary structure as a new
    version (see services.activate_loan) — repayment is tracked by
    decrementing outstanding_balance each payroll run
    (services.apply_loan_repayments), auto-closing at zero."""

    class LoanType(models.TextChoices):
        OFFICE = "office", "Office Loan"
        PERSONAL = "personal", "Personal Loan"

    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="loans")
    loan_type = models.CharField(max_length=20, choices=LoanType.choices)
    principal_amount = models.DecimalField(max_digits=12, decimal_places=2)
    monthly_deduction = models.DecimalField(max_digits=12, decimal_places=2)
    outstanding_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REQUESTED)
    start_date = models.DateField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    salary_component = models.ForeignKey(
        SalaryComponent,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="The company-wide 'Loan Repayment' deduction component this loan's active structure uses.",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.employee.employee_code}: {self.get_loan_type_display()} ({self.status})"


class PayrollError(AuditModel):
    """One employee's failure within a run, kept rather than raised away.

    **What this replaces.** `process_payslip` let any exception propagate, which
    failed the Celery chord and left the run stuck at PROCESSING forever. That
    was defended as the correct failure mode — better than silently reporting a
    partial run as done — and the second half of that is right. But a stuck run
    tells HR nothing: not who failed, not why, and not whether the other 199
    payslips are fine. It surfaces in Sentry, where the person who can fix a
    misconfigured salary structure is not looking.

    So the failure is recorded against the employee it belongs to, the run
    completes, and `finalize` refuses while any error is unresolved. Nothing is
    silently reported as done — the run simply says *what* went wrong instead of
    hanging and saying nothing.
    """

    payroll_run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, related_name="errors")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="payroll_errors")
    # The exception class, so errors can be grouped without parsing prose.
    error_type = models.CharField(max_length=100)
    message = models.TextField()
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["employee__employee_code"]
        constraints = [
            # One live error per employee per run: re-running after a fix should
            # replace the previous failure, not stack a second copy beside it.
            models.UniqueConstraint(
                fields=["payroll_run", "employee"], name="unique_payroll_error_per_employee"
            )
        ]

    def __str__(self):
        return f"{self.employee.employee_code} — {self.error_type}"


class PayslipLineItem(models.Model):
    """Append-only, one row per computed component per payslip. Stores a
    snapshot of the component's identity/amount at calculation time — if
    a SalaryComponent is later renamed or its formula changed, past
    payslips must keep showing what was actually used (same principle as
    ApprovalAction/EmployeeLog: never let history silently rewrite)."""

    payslip = models.ForeignKey(Payslip, on_delete=models.CASCADE, related_name="line_items")
    component = models.ForeignKey(SalaryComponent, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    component_code = models.CharField(max_length=50)
    component_name = models.CharField(max_length=100)
    component_type = models.CharField(max_length=20, choices=SalaryComponent.ComponentType.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.payslip_id}: {self.component_code} = {self.amount}"


class StatutoryRate(AuditModel):
    """One configurable statutory figure, for one fiscal year.

    See `payroll/statutory.py` for the reasoning and the shipped defaults. The
    short version: these are set annually by somebody else's legislation, so
    they are company data rather than constants, and they are keyed by fiscal
    year so that correcting this year's rate cannot restate last year's
    payslips.

    **Lives in `payroll`, not `core`, on purpose.** `core` is a SHARED_APP, so
    a model there is created once in the public schema — wrong for something
    the company configures — and it cannot hold a FK to `accounts.User`, which
    is company-scoped. That is the same constraint that keeps `django.contrib
    .admin` out of SHARED_APPS.
    """

    class Unit(models.TextChoices):
        PERCENT = "percent", "Percentage"
        AMOUNT = "amount", "Fixed amount"
        MULTIPLIER = "multiplier", "Multiplier"

    code = models.CharField(max_length=60)
    fiscal_year = models.PositiveIntegerField(
        help_text="Opening year of the fiscal year, e.g. 2082 for FY 2082/83."
    )
    value = models.DecimalField(max_digits=14, decimal_places=4)
    unit = models.CharField(max_length=20, choices=Unit.choices, default=Unit.PERCENT)
    label = models.CharField(max_length=150)
    note = models.TextField(
        blank=True,
        help_text="What this figure means — most of these are easy to enter against the wrong base.",
    )

    # False until a human has checked the figure against the current Act.
    #
    # The point of this flag is that a *shipped default is not law*. Seeding
    # sensible values makes the product usable and demoable on day one; without
    # the flag, those placeholders would be indistinguishable from figures
    # somebody actually verified, which is precisely the confident-and-wrong
    # failure this whole module exists to avoid.
    is_verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(
        max_length=255,
        blank=True,
        help_text="Where the verified figure came from, e.g. 'Finance Act 2082, Schedule 1'.",
    )

    class Meta:
        ordering = ["fiscal_year", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["code", "fiscal_year"], name="unique_statutory_rate_per_year"
            )
        ]

    def __str__(self):
        suffix = {"percent": "%", "multiplier": "×"}.get(self.unit, "")
        checked = "" if self.is_verified else " (unverified)"
        return f"FY{self.fiscal_year} {self.code}: {self.value}{suffix}{checked}"


class PaymentBatch(AuditModel):
    """One payment instruction to one bank, for one payroll run.

    **Why per bank rather than per run.** A run pays people who bank in
    different places, and each bank will only accept a file listing its own
    account holders. "Pay everyone" and "pay these forty at NIC Asia" are
    therefore the same operation at different scopes, not two features — a
    company where everyone banks in one place simply produces one batch. Modelling
    it as one-file-per-run would work until the first company with two banks, and
    then need rebuilding.

    Money leaving the company is the highest-value audit trail in the product, so
    every state change here is recorded with an actor and a timestamp.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        # The file exists and has been handed to the bank. Not yet money.
        SENT = "sent", "Sent to bank"
        # The bank has confirmed. This is what lets a payslip say "paid".
        ACKNOWLEDGED = "acknowledged", "Acknowledged"
        FAILED = "failed", "Failed"

    payroll_run = models.ForeignKey(
        PayrollRun, on_delete=models.CASCADE, related_name="payment_batches"
    )
    # Free text rather than a FK: the bank is whatever the employees typed on
    # their own records, and a company should not have to maintain a bank
    # registry before they can pay anybody.
    bank_name = models.CharField(max_length=120)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)

    # Totals are frozen when the batch is built, not derived on read. A payslip
    # can be corrected afterwards, and the instruction must keep saying what was
    # actually sent to the bank rather than silently restating itself.
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    payslip_count = models.PositiveIntegerField(default=0)

    sent_at = models.DateTimeField(null=True, blank=True)
    sent_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    bank_reference = models.CharField(
        max_length=100, blank=True,
        help_text="What the bank called this transfer — the answer to 'has it gone?'",
    )
    failure_reason = models.TextField(blank=True)

    class Meta:
        ordering = ["bank_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["payroll_run", "bank_name"], name="unique_batch_per_bank_per_run"
            )
        ]

    def __str__(self):
        return f"{self.bank_name}: {self.payslip_count} payslip(s), {self.total_amount}"


class PaymentBatchItem(models.Model):
    """One employee's line in a payment instruction.

    Bank details are **copied**, not read through the FK. An account number that
    changes after the file is sent must not retroactively alter what the
    instruction said — the record has to answer "what did we tell the bank",
    which is a different question from "what are this person's details now".
    """

    batch = models.ForeignKey(PaymentBatch, on_delete=models.CASCADE, related_name="items")
    payslip = models.ForeignKey(Payslip, on_delete=models.PROTECT, related_name="payment_items")

    account_name = models.CharField(max_length=150)
    account_number = models.CharField(max_length=40)
    account_type = models.CharField(max_length=20, blank=True)
    branch = models.CharField(max_length=150, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["account_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "payslip"], name="unique_payslip_per_batch"
            )
        ]

    def __str__(self):
        return f"{self.account_name} — {self.amount}"


class PaymentExclusion(models.Model):
    """A payslip that could not be paid, and why — kept rather than dropped.

    **The whole point.** Building a file that silently omits three people is how
    somebody goes unpaid for a month and nobody notices until they say so. An
    employee with no account number has to come out of the file *by name*, so
    the person building the batch sees who is missing before it is sent, not
    after.
    """

    payroll_run = models.ForeignKey(
        PayrollRun, on_delete=models.CASCADE, related_name="payment_exclusions"
    )
    payslip = models.ForeignKey(Payslip, on_delete=models.CASCADE, related_name="+")
    reason = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["payslip__employee__employee_code"]
        constraints = [
            models.UniqueConstraint(
                fields=["payroll_run", "payslip"], name="unique_exclusion_per_payslip"
            )
        ]

    def __str__(self):
        return f"{self.payslip_id}: {self.reason}"


class EmployeeSchemeEnrolment(AuditModel):
    """One person's membership of one scheme.

    **Absence means "follow the company".** A company that switches SSF on does
    not then have to create a row per employee before payroll works — requiring
    that would make enabling a scheme a data-entry project, and the half-done
    state would silently under-deduct. So a row exists only where somebody
    *differs* from the company default, or where the scheme is voluntary.

    CIT is the voluntary one, and it is the reason `monthly_amount` exists: SSF
    and PF are percentages set by law, but how much somebody chooses to save
    into CIT is their decision, made in rupees.
    """

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="scheme_enrolments"
    )
    #: Validated against `payroll.schemes.Scheme` rather than by `choices`, so a
    #: country pack can add a scheme without a migration — the same reasoning
    #: `RateCode` uses.
    scheme = models.CharField(max_length=20)

    #: Set only to *opt out*. `False` is how somebody sits outside the company
    #: scheme — a contract predating it, or a foreign national outside the fund.
    is_active = models.BooleanField(default=True)

    #: Overrides the statutory employee percentage for this person only.
    #: Null means "use the rate", which is almost always right — this exists for
    #: the grandfathered arrangement, not as the normal path.
    employee_rate = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        help_text="Percentage of basic. Leave empty to use the statutory rate.",
    )

    #: CIT only. A flat monthly figure, because that is how somebody decides to
    #: save — not a percentage of anything.
    monthly_amount = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="For CIT: how much to deduct each month.",
    )

    #: The member number with the fund. Distinct from `Employee.ssf_number` and
    #: friends only in that this one belongs to the enrolment — kept nullable
    #: because the identifiers already on `Employee` are where they live today
    #: and duplicating them silently would be two answers again.
    reference = models.CharField(max_length=40, blank=True)

    class Meta:
        ordering = ["employee_id", "scheme"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "scheme"], name="unique_employee_scheme_enrolment"
            )
        ]

    def __str__(self):
        return f"{self.employee.employee_code} — {self.scheme}"


class ContributionRecord(models.Model):
    """What was actually paid into a scheme, per payslip.

    **The answer to "how much has been cut so far", which had none.** Summing
    `PayslipLineItem` cannot answer it: a line item points at a company-named
    `SalaryComponent`, so the identity of "this is SSF" lives in a string
    somebody typed and disappears the moment they rename it. This is keyed on
    the **scheme**, so the year-to-date figure survives that.

    **It carries the employer side, which had nowhere to live at all.** SSF
    employer contribution is 20% of basic — a real company liability that is not
    a payslip deduction, so no line item could ever have held it.

    Not an `AuditModel`: this is a derived record of a computation, rewritten
    whenever the payslip is recomputed. `created_by` on it would suggest a
    person entered it, which nobody did.
    """

    payslip = models.ForeignKey(
        "payroll.Payslip", on_delete=models.CASCADE, related_name="contributions"
    )
    #: Denormalised from the payslip so a year-to-date query is one indexed
    #: read rather than a join through payslip to employee on every row.
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="contributions"
    )
    scheme = models.CharField(max_length=20)

    employee_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    employer_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    #: Stamped from the run rather than derived here — `compute_payslip` already
    #: worked the fiscal year out from the period end, and this codebase has had
    #: two answers to that question three times.
    fiscal_year = models.PositiveIntegerField()
    period_year = models.PositiveIntegerField()
    period_month = models.PositiveSmallIntegerField()

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fiscal_year", "-period_year", "-period_month", "scheme"]
        indexes = [
            # The question this table exists for.
            models.Index(fields=["employee", "fiscal_year"]),
            models.Index(fields=["scheme", "fiscal_year"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["payslip", "scheme"], name="unique_payslip_scheme_contribution"
            )
        ]

    def __str__(self):
        return f"{self.employee_id} {self.scheme} {self.period_year}-{self.period_month}"
