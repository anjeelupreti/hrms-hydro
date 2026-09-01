"""Retirement and savings schemes — who is in which, and what has been paid in.

**What was here before this module.** Nothing. SSF, PF, CIT and gratuity were
not concepts the system knew: `StatutoryRate` held the percentages and was read
by nothing, `Employee` held the identifiers and nothing stood behind them, and
the actual deduction was whatever a company happened to name a `SalaryComponent`
and type as a percentage. So the statutory table and the money leaving somebody's
pay were two unconnected sources of truth, and the second one won.

Three consequences, all of them live before this:

* **Nothing enforced SSF-xor-PF.** The rate registry's own note says running
  both double-deducts. It was a comment.
* **No cumulative record.** "How much have I paid into the fund this year" had
  no answer. Summing `PayslipLineItem` cannot answer it either, because a line
  item points at a company-named component — rename it and the history is gone.
* **The employer side had nowhere to live.** SSF employer contribution is 20%
  of basic and a real company liability. It was computed nowhere and stored
  nowhere.

**Additive by construction.** A company that has not chosen a scheme behaves
exactly as it did — the same decision `AttendancePolicy` made about silence
permitting, and `fiscal_year_start_month` about null meaning the calendar's own
year. Nobody's payslip changes until somebody configures this deliberately.

**The rates stay configuration.** This module decides *shape* — who is enrolled,
which schemes may coexist, what gets recorded. Every percentage comes from
`StatutoryRate`, effective-dated per fiscal year, each row shipping
`is_verified=False` until an accountant confirms it. §2.3: the moment a Nepali
percentage is hardcoded here, the engine stops being teachable.
"""

from __future__ import annotations

from decimal import Decimal

from payroll.statutory import RateCode


class Scheme:
    """The schemes a contribution can belong to.

    Strings rather than an enum on a model, matching `RateCode`, so a country
    pack can add one this codebase has never heard of without a migration.
    """

    SSF = "ssf"
    PF = "pf"
    CIT = "cit"
    GRATUITY = "gratuity"

    CHOICES = [
        (SSF, "Social Security Fund"),
        (PF, "Provident Fund"),
        (CIT, "Citizen Investment Trust"),
        (GRATUITY, "Gratuity"),
    ]


#: 🔒 **SSF and PF are alternatives, never both.** Enforced in `contributions_for`
#: and in the company serializer rather than left as a note, because the failure
#: is silent: both deduct from the same base, so a company running the two
#: together takes 21% of basic off somebody who owes 11%, and the payslip looks
#: entirely ordinary.
RETIREMENT_SCHEMES = (Scheme.SSF, Scheme.PF)

#: Which rate supplies each side of each scheme. The single place that knows.
RATE_CODES = {
    Scheme.SSF: (RateCode.SSF_EMPLOYEE, RateCode.SSF_EMPLOYER),
    Scheme.PF: (RateCode.PF_EMPLOYEE, RateCode.PF_EMPLOYER),
    #: Gratuity is employer-only — the employee contributes nothing to it.
    Scheme.GRATUITY: (None, RateCode.GRATUITY),
    #: CIT has no statutory percentage: it is a voluntary amount the employee
    #: chooses, within the relief ceiling. So the rate table has nothing to say
    #: and the enrolment carries the figure.
    Scheme.CIT: (None, None),
}


#: Scheme → the name that appears on a payslip. Here rather than in the payroll
#: service so the label and the scheme code stay in one file.
SCHEME_LABELS = dict(Scheme.CHOICES)


class SchemeError(Exception):
    """Refused for a stated reason the UI can show."""


#: Codes and words that have historically meant "this is a retirement
#: contribution" in a hand-built component. Used only to *suggest* what a company
#: should tag — never to act on. Acting on a name would silently stop deducting
#: somebody's "PF Loan Repayment", which is the opposite failure.
_LIKELY_SCHEME_WORDS = (
    "ssf", "social security",
    "pf", "provident",
    "cit", "citizen investment",
    "gratuity",
)


def overlapping_components(scheme):
    """Active deduction components that would double-deduct against `scheme`.

    **Tagged components are the authoritative answer.** A component whose
    `scheme` field names the one now being run by the company config is,
    unambiguously, a second deduction for the same obligation.

    Returns `(tagged, suspected)`. The second list is a heuristic over names and
    codes, offered so an error message can say *which* component somebody
    probably needs to look at — a company with fifty components should not have
    to find it themselves. It is never acted on: "PF Loan Repayment" contains
    "PF" and is not a contribution, and refusing payroll over a substring would
    be a worse bug than the one being prevented.
    """
    from payroll.models import SalaryComponent

    active = SalaryComponent.objects.filter(
        is_active=True, component_type=SalaryComponent.ComponentType.DEDUCTION
    )
    tagged = [c for c in active if c.scheme and c.scheme == scheme]

    tagged_ids = {c.id for c in tagged}
    suspected = [
        c
        for c in active
        if c.id not in tagged_ids
        and not c.scheme
        and any(word in f"{c.code} {c.name}".lower() for word in _LIKELY_SCHEME_WORDS)
    ]
    return tagged, suspected


def describe_overlap(scheme):
    """A sentence naming what clashes, or `None` when nothing does."""
    tagged, suspected = overlapping_components(scheme)
    if not tagged:
        return None
    names = ", ".join(f"“{c.name}”" for c in tagged)
    message = (
        f"{names} already deducts {scheme.upper()} from pay, and the company "
        f"scheme would deduct it again — the same amount twice, off the same "
        f"basic. Retire that component, or clear its scheme tag if it is "
        f"something else."
    )
    if suspected:
        others = ", ".join(f"“{c.name}”" for c in suspected)
        message += f" Also worth checking: {others}."
    return message


def company_schemes(profile) -> dict:
    """What this company runs, resolved once.

    **`chosen` and `retirement` are deliberately different.** `chosen` is the
    programme this company is on; `retirement` is what actually deducts *this
    period*, which is `None` while paused. Collapsing them would make a paused
    company indistinguishable from one that never enrolled — and the two want
    very different things said to them, and very different things done with
    their history when contributions resume.

    **Gratuity only where the employer is not on SSF** — SSF absorbs it, so
    charging both would be the same double-count as SSF plus PF, one layer up.
    Judged on the *chosen* scheme, not the paused one: pausing contributions
    does not turn an SSF employer into a gratuity employer for a month.
    """
    chosen = profile.retirement_scheme or None
    paused = bool(profile.retirement_paused)
    return {
        "chosen": chosen,
        "paused": paused,
        "retirement": None if paused else chosen,
        # CIT is paused by the company withdrawing the offer, or by the person
        # deactivating their own enrolment — it needs no separate switch.
        "offers_cit": bool(profile.offers_cit),
        "gratuity": bool(
            profile.provides_gratuity and chosen != Scheme.SSF and not paused
        ),
    }


def _rate(code, fiscal_year, default=Decimal("0")):
    from payroll.statutory import get_rate

    return get_rate(code, fiscal_year, default=default) or default


def contributions_for(employee, basic, fiscal_year, profile=None):
    """Every contribution this employee owes this period, per scheme.

    `basic` is the base, and it is **basic rather than gross** on purpose — the
    rate registry says so on every row, and it is the single easiest figure to
    get wrong here. Passing gross would silently inflate every contribution by
    the allowances.

    Returns a list of `{scheme, employee_amount, employer_amount}`. An empty
    list is the correct answer for a company that has not configured anything,
    which is what keeps this additive.
    """
    from organization.models import CompanyProfile
    from payroll.models import EmployeeSchemeEnrolment

    profile = profile or CompanyProfile.get_solo()
    config = company_schemes(profile)
    if not any((config["retirement"], config["offers_cit"], config["gratuity"])):
        return []

    # **Every enrolment, not just the active ones.** Filtering to `is_active`
    # here is a bug that hides itself: an opted-out row would never reach the
    # dict, `enrolment is None` would be true, and the person would be charged
    # exactly as if they had never opted out. Absence and opting out are
    # different facts and have to stay distinguishable at the lookup.
    enrolments = {
        row.scheme: row
        for row in EmployeeSchemeEnrolment.objects.filter(employee=employee)
    }

    out = []

    retirement = config["retirement"]
    if retirement:
        # 🔒 The safety net. Configuration is validated when it is saved, but a
        # component can be created *afterwards* — so this is checked again at
        # the moment money is calculated. Raising lands it in the run's error
        # list against this employee, which is loud; deducting twice is silent.
        clash = describe_overlap(retirement)
        if clash:
            raise SchemeError(clash)
        # An employee can be out of the company scheme — somebody on a contract
        # that predates it, or a foreign national outside the fund. Absence of
        # an enrolment row means "follow the company", because requiring a row
        # per employee would make enabling the scheme a data-entry project.
        enrolment = enrolments.get(retirement)
        if enrolment is None or enrolment.is_active:
            employee_code, employer_code = RATE_CODES[retirement]
            employee_pct = (
                enrolment.employee_rate
                if enrolment is not None and enrolment.employee_rate is not None
                else _rate(employee_code, fiscal_year)
            )
            out.append(
                {
                    "scheme": retirement,
                    "employee_amount": _pct(basic, employee_pct),
                    "employer_amount": _pct(basic, _rate(employer_code, fiscal_year)),
                }
            )

    if config["gratuity"]:
        out.append(
            {
                "scheme": Scheme.GRATUITY,
                "employee_amount": Decimal("0"),
                "employer_amount": _pct(basic, _rate(RateCode.GRATUITY, fiscal_year)),
            }
        )

    # CIT is voluntary and per-person, so it comes only from an enrolment — and
    # it is a flat monthly amount rather than a percentage, because that is how
    # somebody decides to save.
    if config["offers_cit"]:
        cit = enrolments.get(Scheme.CIT)
        if cit is not None and cit.monthly_amount:
            out.append(
                {
                    "scheme": Scheme.CIT,
                    "employee_amount": Decimal(cit.monthly_amount),
                    "employer_amount": Decimal("0"),
                }
            )

    return out


def _pct(base, percent):
    from payroll.services import _quantize

    return _quantize(Decimal(base) * (Decimal(percent) / Decimal("100")))


def record_contributions(payslip, rows, fiscal_year):
    """Write this period's contributions, replacing any previous attempt.

    **Replaced rather than appended**, because `compute_payslip` is idempotent
    by design and reruns after a corrected salary structure are ordinary. An
    append would double somebody's year-to-date every time payroll was re-run,
    which is precisely the number this exists to make trustworthy.

    `fiscal_year` is passed in rather than derived here: `compute_payslip`
    already worked it out from the period end, and a second derivation is a
    second answer to a question this codebase has already had two answers to
    three times.
    """
    from payroll.models import ContributionRecord

    ContributionRecord.objects.filter(payslip=payslip).delete()
    if not rows:
        return []

    run = payslip.payroll_run
    return ContributionRecord.objects.bulk_create(
        [
            ContributionRecord(
                payslip=payslip,
                employee_id=payslip.employee_id,
                scheme=row["scheme"],
                employee_amount=row["employee_amount"],
                employer_amount=row["employer_amount"],
                fiscal_year=fiscal_year,
                period_year=run.period_year,
                period_month=run.period_month,
            )
            for row in rows
        ]
    )


def totals_to_date(employee, fiscal_year=None):
    """How much has been paid in — the question with no answer before this.

    Keyed on the **scheme** rather than on a salary component, which is what
    makes it survive a company renaming their deduction. Both sides are returned:
    the employee's own contribution is what they care about at filing time, and
    the employer's is a company liability that had nowhere to live at all.

    **Draft payslips are excluded.** A draft is a calculation somebody may still
    throw away, and a year-to-date figure that moves when a draft is deleted is
    one nobody can reconcile against a fund deposit.
    """
    from django.db.models import Sum

    from payroll.models import ContributionRecord, Payslip

    rows = ContributionRecord.objects.filter(employee=employee).exclude(
        payslip__status=Payslip.Status.DRAFT
    )
    if fiscal_year is not None:
        rows = rows.filter(fiscal_year=fiscal_year)

    by_scheme = (
        rows.values("scheme")
        .annotate(employee_total=Sum("employee_amount"), employer_total=Sum("employer_amount"))
        .order_by("scheme")
    )

    labels = dict(Scheme.CHOICES)
    return [
        {
            "scheme": row["scheme"],
            "label": labels.get(row["scheme"], row["scheme"]),
            "employee_total": row["employee_total"] or Decimal("0"),
            "employer_total": row["employer_total"] or Decimal("0"),
            "total": (row["employee_total"] or Decimal("0"))
            + (row["employer_total"] or Decimal("0")),
        }
        for row in by_scheme
    ]


def company_totals(fiscal_year, scheme=None):
    """Every employee's contributions for a year, per scheme.

    **This is what gets reconciled against the fund deposit**, so it is built
    from `ContributionRecord` rather than from payslip line items: the record is
    keyed on the scheme, survives a component being renamed, and carries the
    employer side, which no line item ever could.

    Draft payslips are excluded for the same reason as `totals_to_date` — a
    figure that moves when somebody deletes a draft cannot be reconciled against
    a payment that has already left the bank.
    """
    from django.db.models import Sum

    from payroll.models import ContributionRecord, Payslip

    rows = ContributionRecord.objects.filter(fiscal_year=fiscal_year).exclude(
        payslip__status=Payslip.Status.DRAFT
    )
    if scheme:
        rows = rows.filter(scheme=scheme)

    per_employee = (
        rows.values(
            "employee_id",
            "employee__employee_code",
            "employee__user__first_name",
            "employee__user__last_name",
            "scheme",
        )
        .annotate(employee_total=Sum("employee_amount"), employer_total=Sum("employer_amount"))
        .order_by("employee__employee_code", "scheme")
    )

    labels = dict(Scheme.CHOICES)
    people = [
        {
            "employee": row["employee_id"],
            "employee_code": row["employee__employee_code"],
            "employee_name": (
                f"{row['employee__user__first_name']} {row['employee__user__last_name']}".strip()
                or row["employee__employee_code"]
            ),
            "scheme": row["scheme"],
            "label": labels.get(row["scheme"], row["scheme"]),
            "employee_total": row["employee_total"] or Decimal("0"),
            "employer_total": row["employer_total"] or Decimal("0"),
        }
        for row in per_employee
    ]

    by_scheme = (
        rows.values("scheme")
        .annotate(employee_total=Sum("employee_amount"), employer_total=Sum("employer_amount"))
        .order_by("scheme")
    )
    totals = [
        {
            "scheme": row["scheme"],
            "label": labels.get(row["scheme"], row["scheme"]),
            "employee_total": row["employee_total"] or Decimal("0"),
            "employer_total": row["employer_total"] or Decimal("0"),
            # The figure that actually goes to the fund: both sides together.
            "total": (row["employee_total"] or Decimal("0"))
            + (row["employer_total"] or Decimal("0")),
        }
        for row in by_scheme
    ]

    return {"totals": totals, "people": people}
