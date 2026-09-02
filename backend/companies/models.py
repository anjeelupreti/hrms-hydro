"""The operating companies people are employed by.

**Why this is not the same thing as `organization.CompanyProfile`.** That is
the singleton the deployment runs on — the calendar, the office hours, the
timezone, one row. This is a *list*: a hydropower group runs several legal
entities at once, typically one per project, and a person is employed by one of
them while working across others.

**One primary, several secondary, and the distinction is not cosmetic.**

* `primary_company` is where somebody is actually on the payroll. It is the
  entity that signs their contract, files their tax and appears on their
  payslip, so there is exactly one and it is required to be one.
* `secondary_companies` is where they also work — a chief engineer at the
  parent seconded to two project SPVs, a shared finance team serving the whole
  group. It carries no employment relationship and no money.

Splitting them this way is what lets a headcount question have an answer.
"Who works for Sanjen Jalavidyut?" and "whose payroll does Sanjen run?" are
different questions, and a single many-to-many cannot tell them apart.
"""

from django.core.exceptions import ValidationError
from django.db import models

from core.models import AuditModel


def company_logo_upload_path(instance, filename):
    return f"companies/{instance.pk or 'new'}/logo/{filename}"


class Company(AuditModel):
    """One legal entity in the group."""

    class Kind(models.TextChoices):
        #: The holding company. There is normally one, and nothing enforces
        #: that — a group formed by merger legitimately has two for a while.
        PARENT = "parent", "Parent / holding"
        SUBSIDIARY = "subsidiary", "Subsidiary"
        #: A project company. The common case in this industry: one licence,
        #: one powerhouse, its own balance sheet.
        SPV = "spv", "Project company (SPV)"
        JV = "jv", "Joint venture"
        BRANCH = "branch", "Branch office"

    class ProjectStage(models.TextChoices):
        """Where the project is in its life, which is what decides the shape of
        the workforce. A company under construction is mostly civil staff on
        fixed terms; the same company operating is a small permanent crew."""

        SURVEY = "survey", "Survey / feasibility"
        LICENSED = "licensed", "Licensed, pre-construction"
        CONSTRUCTION = "construction", "Under construction"
        COMMISSIONING = "commissioning", "Commissioning"
        OPERATION = "operation", "In operation"
        NOT_APPLICABLE = "na", "Not a project company"

    # ── Which entity the installation runs through ──────────────────────
    #
    # **Exactly one, and it is not the same question as `kind`.**
    #
    # `kind` describes what a company *is* — a holding company, an SPV, a
    # branch — and deliberately does not enforce uniqueness, because a group
    # formed by merger legitimately has two parents for a while. This flag
    # answers a different and narrower question: which single entity does this
    # installation run its company-wide processes through. Payroll is the one
    # that matters. There is one payroll for the group, it is run once a month,
    # and it is run by somebody sitting in one office under one PAN.
    #
    # Conflating the two would mean either "the parent is always the payer",
    # which is not true of every group, or a payroll that has to pick between
    # two parents and cannot.
    #
    # Enforced twice, and both are needed. `clean()` gives the person on the
    # form a sentence they can act on; the constraint stops two concurrent
    # saves from both believing they were the only one — a check-then-write in
    # Python cannot, because the window between them is where the second write
    # lands.
    is_primary = models.BooleanField(
        default=False,
        help_text=(
            "The entity this installation runs payroll and other company-wide "
            "processes through. Exactly one company may be marked."
        ),
    )

    # ── Identity ────────────────────────────────────────────────────────
    name = models.CharField(max_length=200, unique=True)
    #: Short form used on employee codes, payroll exports and anywhere a full
    #: legal name will not fit. Unique because it is an identifier, not a label.
    code = models.CharField(max_length=20, unique=True)
    legal_name = models.CharField(
        max_length=255,
        blank=True,
        help_text="As registered, if it differs from the name people use.",
    )
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.SPV)

    #: The group structure, as far as HR needs it.
    #:
    #: `SET_NULL` rather than cascade: dissolving a holding company must not
    #: delete the subsidiaries' records along with it.
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="children",
    )

    # ── Registration ────────────────────────────────────────────────────
    registration_number = models.CharField(max_length=64, blank=True)
    pan_vat_number = models.CharField(max_length=32, blank=True, verbose_name="PAN / VAT")
    #: The generation licence. Blank for anything that is not a project company.
    licence_number = models.CharField(max_length=64, blank=True)
    established_on = models.DateField(null=True, blank=True)

    # ── The project, where there is one ─────────────────────────────────
    project_stage = models.CharField(
        max_length=20, choices=ProjectStage.choices, default=ProjectStage.NOT_APPLICABLE
    )
    #: Installed capacity in megawatts. Decimal rather than integer — plants of
    #: 4.5 and 25.5 MW are ordinary, and rounding one to 5 misstates a licence.
    installed_capacity_mw = models.DecimalField(
        max_digits=9, decimal_places=3, null=True, blank=True
    )
    river = models.CharField(max_length=120, blank=True)

    # ── Where and how to reach it ───────────────────────────────────────
    address = models.TextField(blank=True)
    district = models.CharField(max_length=100, blank=True)
    province = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    email = models.EmailField(blank=True)
    website = models.URLField(blank=True)
    logo = models.ImageField(upload_to=company_logo_upload_path, null=True, blank=True)

    #: Deactivated rather than deleted. A company that has been wound up still
    #: owns the employment history of everyone who worked for it, and a payslip
    #: naming an entity that no longer exists in the database is unreadable.
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "companies"
        constraints = [
            # A partial unique index: it constrains only the rows where the flag
            # is true, so every company can carry `False` and exactly one can
            # carry `True`. A plain `unique=True` on a boolean would allow one
            # row of each value and cap the table at two companies.
            models.UniqueConstraint(
                fields=["is_primary"],
                condition=models.Q(is_primary=True),
                name="one_primary_company",
            )
        ]

    def __str__(self):
        return self.name

    def clean(self):
        if self.is_primary:
            clash = Company.objects.filter(is_primary=True).exclude(pk=self.pk).first()
            if clash is not None:
                raise ValidationError(
                    {
                        "is_primary": (
                            f"{clash.name} is already the primary company. Clear it there "
                            "first — payroll runs through one entity, and two would leave "
                            "it with no answer about which."
                        )
                    }
                )
        if self.parent_id and self.parent_id == self.pk:
            raise ValidationError({"parent": "A company cannot be its own parent."})
        # Walk up rather than trusting one level: A→B→A is the loop that
        # actually gets created, and it makes every org-chart read non-terminating.
        seen = {self.pk}
        node = self.parent
        while node is not None:
            if node.pk in seen:
                raise ValidationError({"parent": "That would make the group structure a loop."})
            seen.add(node.pk)
            node = node.parent


def primary_company():
    """The entity this installation runs its company-wide processes through.

    `None` when nobody has marked one, which is a real state on a fresh install
    and the reason every caller has to handle it rather than assume. Payroll
    refuses to start in that case, with a sentence saying what to set — a run
    attributed to no entity is a payroll nobody can file.

    Read on demand rather than cached: it changes about once in the life of an
    installation, and a stale cache would attribute a month's payroll to the
    wrong company for the worst possible reason.
    """
    return Company.objects.filter(is_primary=True, is_active=True).first()
