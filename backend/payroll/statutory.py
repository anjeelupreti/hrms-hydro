"""Statutory rates as configuration, with defaults that ship.

**Why this is a table and not a set of constants.** Every figure here is set
annually — by the Finance Act, the Labour Act, or a government notice — and
differs by country. A constant in the engine makes us a Nepal product with a
release cycle tied to somebody else's budget speech. This is the same argument
as `TaxSlab`, and §1.1 advantage #2 depends on it.

**Why it is effective-dated.** Changing a rate must not restate history. A
payslip computed last fiscal year was correct under last year's rates and has to
stay computable that way, so rates are keyed by fiscal year rather than
overwritten in place.

**Why defaults ship anyway.** An empty rate table means a company cannot run
payroll at all until an accountant has been consulted, which makes the product
untestable and undemoable. So the Nepal pack seeds with the figures below — but
each row carries `is_verified=False` until somebody confirms it against the
current Act, so an unchecked default is *visible as unchecked* rather than
looking authoritative. That flag is the honest part of this design: it does not
pretend the seeded numbers are law, it records that nobody has checked them yet.
"""

from decimal import Decimal


class RateCode:
    """Codes are strings, not an enum on the model, so a country pack can add
    a rate this codebase has never heard of without a migration."""

    SSF_EMPLOYEE = "ssf_employee"
    SSF_EMPLOYER = "ssf_employer"
    PF_EMPLOYEE = "pf_employee"
    PF_EMPLOYER = "pf_employer"
    GRATUITY = "gratuity"
    OVERTIME_MULTIPLIER = "overtime_multiplier"
    RETIREMENT_RELIEF_CEILING = "retirement_relief_ceiling"
    #: The SSF ceiling is set higher than the PF/CIT one, so "the ceiling" is
    #: not a single number and cannot be one row.
    RETIREMENT_RELIEF_CEILING_SSF = "retirement_relief_ceiling_ssf"
    #: The second of the three quantities: relief is capped at a proportion of
    #: assessable income as well as by the absolute ceiling.
    RETIREMENT_RELIEF_FRACTION = "retirement_relief_fraction"
    LIFE_INSURANCE_CEILING = "life_insurance_ceiling"
    HEALTH_INSURANCE_CEILING = "health_insurance_ceiling"
    FEMALE_REBATE = "female_rebate"
    MINIMUM_WAGE = "minimum_wage"


#: (code, value, unit, label, note)
#:
#: `note` is what a person entering the real figure needs to know — mostly
#: *what the number means*, since several of these are easy to enter against the
#: wrong base (gross instead of basic) or to conflate with each other.
NEPAL_DEFAULTS = [
    (
        RateCode.SSF_EMPLOYEE, Decimal("11"), "percent",
        "SSF — employee contribution",
        "Percentage of BASIC, not gross. Deducted from the employee's pay.",
    ),
    (
        RateCode.SSF_EMPLOYER, Decimal("20"), "percent",
        "SSF — employer contribution",
        "Percentage of BASIC. A company cost — it does not reduce net pay, but "
        "belongs on the payslip because the employee is entitled to see it.",
    ),
    (
        RateCode.PF_EMPLOYEE, Decimal("10"), "percent",
        "Provident fund — employee",
        "Only for companies NOT enrolled in the SSF. SSF and PF are alternatives, "
        "not both — running the two together double-deducts.",
    ),
    (
        RateCode.PF_EMPLOYER, Decimal("10"), "percent",
        "Provident fund — employer",
        "Only for companies not enrolled in the SSF.",
    ),
    (
        RateCode.GRATUITY, Decimal("8.33"), "percent",
        "Gratuity",
        "Statutory employer liability for non-SSF employers. Percentage of basic.",
    ),
    (
        RateCode.OVERTIME_MULTIPLIER, Decimal("1.5"), "multiplier",
        "Overtime rate multiplier",
        "Applied to the ordinary hourly rate. The Labour Act also caps overtime "
        "per day and per week — those limits are not this figure.",
    ),
    (
        RateCode.RETIREMENT_RELIEF_CEILING, Decimal("500000"), "amount",
        "Retirement contribution — relief ceiling",
        "Caps the combined SSF/PF and CIT deduction. The relief is the LEAST of "
        "this, the actual contribution, and a proportion of assessable income.",
    ),
    (
        RateCode.RETIREMENT_RELIEF_CEILING_SSF, Decimal("500000"), "amount",
        "Retirement relief ceiling — SSF contributors",
        "The absolute cap where the employer is enrolled in the SSF. Set higher "
        "than the PF/CIT ceiling, which is why this is a separate figure.",
    ),
    (
        RateCode.RETIREMENT_RELIEF_FRACTION, Decimal("33.33"), "percent",
        "Retirement relief — share of assessable income",
        "The second of the three quantities. Relief is the LEAST of the actual "
        "contribution, this share of assessable income, and the ceiling.",
    ),
    (
        RateCode.LIFE_INSURANCE_CEILING, Decimal("40000"), "amount",
        "Life insurance premium — deduction ceiling",
        "Separate from the health insurance ceiling; they are not interchangeable.",
    ),
    (
        RateCode.HEALTH_INSURANCE_CEILING, Decimal("20000"), "amount",
        "Health insurance premium — deduction ceiling",
        "Separate from the life insurance ceiling.",
    ),
    (
        RateCode.FEMALE_REBATE, Decimal("10"), "percent",
        "Female rebate",
        "Rebate on the tax LIABILITY (not on income), for women with "
        "remuneration-only income.",
    ),
    (
        RateCode.MINIMUM_WAGE, Decimal("17300"), "amount",
        "Minimum monthly wage",
        "Set by government notice rather than the Finance Act, so it changes on "
        "its own schedule.",
    ),
]


def seed_statutory_rates(fiscal_year, defaults=None):
    """Create any missing rates for a fiscal year. Never overwrites.

    Idempotent and non-destructive on purpose: re-running the seed after
    somebody has entered and verified the real figures must not quietly put the
    placeholders back.
    """
    from payroll.models import StatutoryRate

    created = []
    for code, value, unit, label, note in (defaults or NEPAL_DEFAULTS):
        _, was_created = StatutoryRate.objects.get_or_create(
            code=code,
            fiscal_year=fiscal_year,
            defaults={
                "value": value,
                "unit": unit,
                "label": label,
                "note": note,
                "is_verified": False,
            },
        )
        if was_created:
            created.append(code)
    return created


def get_rate(code, fiscal_year, default=None):
    """The value of one rate, or `default` if it has not been configured.

    Falls back to the most recent *earlier* year before giving up: a company who
    has not yet entered next year's figures should keep computing on last
    year's rather than silently dropping to zero, which would look like a
    correct payslip with a contribution missing.
    """
    from payroll.models import StatutoryRate

    rate = (
        StatutoryRate.objects.filter(code=code, fiscal_year__lte=fiscal_year)
        .order_by("-fiscal_year")
        .first()
    )
    return rate.value if rate else default


# ── The slab table, shipped ──────────────────────────────────────────────────
#
# **Why this is here now.** Until this, the only code that created a `TaxSlab`
# was `seed_demo` — a demo command. A real company provisioned normally got zero
# slabs, so `compute_payslip` raised `PayrollConfigurationError` and payroll
# could not be finalised until somebody hand-entered the whole table. That is a
# country pack with its most important table missing.
#
# **The figures are ANNUAL, as published.** The engine annualises the period's
# income before applying them, so what is stored matches the Finance Act line
# for line and whoever verifies it is comparing like with like. Storing them
# pre-divided by twelve would mean nobody could ever check them against the Act
# without doing arithmetic first — and an unverifiable figure is the thing
# `is_verified` exists to prevent.
#
# `(min, max, rate, waived_if_retirement_contributor)`.
#
# The lowest band is flagged waived because it is a **social security tax**
# rather than income tax, and is not charged to somebody already contributing
# to a recognised fund. It is still *traversed*, so the bands above it start in
# the right place.
NEPAL_SLABS_INDIVIDUAL = [
    (Decimal("0"), Decimal("500000"), Decimal("1"), True),
    (Decimal("500000"), Decimal("700000"), Decimal("10"), False),
    (Decimal("700000"), Decimal("1000000"), Decimal("20"), False),
    (Decimal("1000000"), Decimal("2000000"), Decimal("30"), False),
    (Decimal("2000000"), None, Decimal("36"), False),
]

#: A couple electing joint assessment gets wider low bands. Same rates, and the
#: same waived first band — the Act sets two tables, and filtering without
#: `taxpayer` would silently mix them.
NEPAL_SLABS_COUPLE = [
    (Decimal("0"), Decimal("600000"), Decimal("1"), True),
    (Decimal("600000"), Decimal("800000"), Decimal("10"), False),
    (Decimal("800000"), Decimal("1100000"), Decimal("20"), False),
    (Decimal("1100000"), Decimal("2000000"), Decimal("30"), False),
    (Decimal("2000000"), None, Decimal("36"), False),
]


def seed_tax_slabs(fiscal_year, individual=None, couple=None):
    """Create the slab table for a fiscal year. Never overwrites.

    Same contract as `seed_statutory_rates`: idempotent, non-destructive, and
    every band ships `is_verified=False`. Re-running after somebody has entered
    and verified the real table must not put the placeholders back.

    **These are defaults, not law.** They are a starting point that makes the
    product usable on day one; the numbers still have to be checked against the
    current Finance Act, and the flag is what makes an unchecked band visible
    as unchecked.
    """
    from payroll.models import TaxSlab

    created = []
    tables = [
        (TaxSlab.Taxpayer.INDIVIDUAL, individual or NEPAL_SLABS_INDIVIDUAL),
        (TaxSlab.Taxpayer.COUPLE, couple or NEPAL_SLABS_COUPLE),
    ]
    for taxpayer, bands in tables:
        for order, (low, high, rate, waived) in enumerate(bands, start=1):
            _, was_created = TaxSlab.objects.get_or_create(
                fiscal_year=fiscal_year,
                taxpayer=taxpayer,
                order=order,
                defaults={
                    "min_amount": low,
                    "max_amount": high,
                    "rate": rate,
                    "waived_if_retirement_contributor": waived,
                    "is_verified": False,
                },
            )
            if was_created:
                created.append(f"{taxpayer}:{order}")
    return created


def unverified_figures(fiscal_year):
    """The statutory rows for a year that nobody has checked yet.

    `is_verified` is what separates a figure somebody checked against the
    Finance Act from one that shipped as a default. This is what the payroll
    viewset consults before allowing a run to be finalised, which locks the
    period irreversibly.

    Returns named rows, not a count. "7 unverified figures" sends somebody
    hunting; "SSF employee, PF employer, slab 3" tells them what to open.
    """
    from payroll.models import StatutoryRate, TaxSlab

    rates = [
        {"kind": "rate", "code": r.code, "label": r.label or r.code, "value": str(r.value)}
        for r in StatutoryRate.objects.filter(fiscal_year=fiscal_year, is_verified=False)
        .order_by("code")
    ]
    slabs = [
        {
            "kind": "slab",
            "code": f"{s.taxpayer}-{s.order}",
            "label": f"{s.get_taxpayer_display()} band {s.order}",
            "value": f"{s.rate}%",
        }
        for s in TaxSlab.objects.filter(fiscal_year=fiscal_year, is_verified=False)
        .order_by("taxpayer", "order")
    ]
    return rates + slabs
