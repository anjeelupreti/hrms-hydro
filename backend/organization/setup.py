"""What a new workspace still has to configure, and how far along it is.

**The problem this exists for.** A new company lands in an empty workspace with
no idea what to do first, and finds out what was missing when something fails —
which for payroll means finding out after the money is wrong. The worst case is
already on record: a fiscal year with no tax slabs seeded produced payslips that
silently deducted no income tax, and *a run that taxes nobody looks exactly like
a correct one*. The shortfall surfaced at filing time as the company's
liability.

**Checks resolve from live data. Never a stored boolean.** A check that still
says Done after somebody deleted the salary structure is worse than no check at
all, because it is trusted. So nothing here records *completion*; the resolver
asks the database every time.

**What is stored is the decision to skip**, which is a different fact. Skipping
is a judgement a person made and can revisit; being done is a state of the
world. Conflating them is what makes setup checklists rot.

**Three tiers, and the promise on each is the point.**

* ``MUST`` — before anyone can be paid correctly. **Not skippable**, because
  the whole value of the tier is that it means something. A must-have with a
  Skip button is a recommendation wearing a badge.
* ``RECOMMENDED`` — you will feel the absence in month one. Skippable, with a
  reason, and undoable.
* ``ADVANCED`` — only relevant to companies using that module, so it is hidden
  unless it applies rather than sitting there as a permanent red mark.

**What can be checked is ours; whether it matters to you is yours.** Same line
`notifications.reminders` draws: a resolver is a database query, so a settings
screen that let a customer write one could read the payroll table.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from enum import StrEnum


class Tier(StrEnum):
    MUST = "must"
    RECOMMENDED = "recommended"
    ADVANCED = "advanced"


@dataclass(frozen=True)
class SetupCheck:
    key: str
    tier: Tier
    domain: str
    title: str
    #: Why it matters, in the consequence rather than the requirement. "Payroll
    #: cannot price a day's absence" beats "working days not configured" —
    #: somebody reading this is deciding whether to care.
    why: str
    #: Where to go and do it.
    href: str
    resolve: Callable[[], bool]
    #: Only shown when this returns True. Lets the Advanced tier stay quiet for
    #: companies who do not use the module.
    applies: Callable[[], bool] = lambda: True

    @property
    def skippable(self) -> bool:
        return self.tier is not Tier.MUST


# ── Resolvers ────────────────────────────────────────────────────────────────
#
# Each is a query and nothing else. Kept as small named functions rather than
# lambdas in the registry so a failing check can be read on its own.


def _company_named() -> bool:
    """Named, and not still the placeholder.

    `get_solo()` seeds `"My Company"`, so a plain non-blank test would report
    this done for the company that has never opened the settings screen —
    which is exactly the company this whole module exists for.
    """
    from organization.models import CompanyProfile

    name = (CompanyProfile.get_solo().name or "").strip()
    return bool(name) and name.casefold() != "my company"


def _working_days_chosen() -> bool:
    from organization.models import CompanyProfile

    return bool(CompanyProfile.get_solo().working_days)


def _email_delivery() -> bool:
    """Outbound mail, without which nobody can be onboarded.

    Both employee-creation routes mail a generated password, and the account is
    unusable until it arrives — so onboarding depends on this configuration
    (D‑01).
    """
    from organization.models import CompanyEmailSettings

    settings = CompanyEmailSettings.get_solo()
    return bool(settings.is_active and settings.host and settings.from_email)


def _has_departments() -> bool:
    from employees.models import Department

    return Department.objects.exists()


def _has_designations() -> bool:
    from employees.models import Designation

    return Designation.objects.exists()


def _has_salary_components() -> bool:
    from payroll.models import SalaryComponent

    return SalaryComponent.objects.exists()


def _everyone_has_a_salary() -> bool:
    """No active employee is missing a salary structure.

    **Not "a structure exists".** A `SalaryStructure` is per-employee and
    effective-dated, so there is no company-level template to check for — and
    an employee without one is not refused by a payroll run, they are *skipped*
    by it. That is the silent failure worth catching here: the run completes,
    the totals look plausible, and one person simply is not paid.
    """
    from employees.models import Employee

    return not Employee.objects.filter(
        employment_status=Employee.EmploymentStatus.ACTIVE,
        salary_structures__isnull=True,
    ).exists()


def _has_employees_to_pay() -> bool:
    """Guards the check above — with nobody hired, "everyone is paid" is
    vacuously true and would show a green tick that means nothing."""
    from employees.models import Employee

    return Employee.objects.filter(
        employment_status=Employee.EmploymentStatus.ACTIVE
    ).exists()


def _current_fiscal_year() -> int:
    from core.calendars import fiscal_year_for

    return fiscal_year_for(date.today())


def _tax_slabs_for_this_year() -> bool:
    """🔒 The check that would have caught the worst payroll defect we have had.

    Slabs seeded under the wrong year meant every lookup missed and every
    payslip deducted no income tax. `finalize` refuses now — but refusing at
    the end of a run is a late place to learn it, and this says so at setup.
    """
    from payroll.models import TaxSlab

    return TaxSlab.objects.filter(fiscal_year=_current_fiscal_year()).exists()


def _statutory_rates_for_this_year() -> bool:
    from payroll.models import StatutoryRate

    return StatutoryRate.objects.filter(fiscal_year=_current_fiscal_year()).exists()


def _has_employee() -> bool:
    from employees.models import Employee

    return Employee.objects.exists()


def _has_leave_types() -> bool:
    from leave.models import LeaveType

    return LeaveType.objects.exists()


def _has_approval_chain() -> bool:
    from leave.models import ApprovalChain

    return ApprovalChain.objects.exists()


def _has_shift() -> bool:
    from attendance.models import Shift

    return Shift.objects.exists()


def _has_holidays() -> bool:
    """This year's, not any year's.

    Last year's Dashain does not stop payroll charging somebody for a day the
    office was shut — the dates move, which is why they are configured rather
    than assumed.
    """
    from notifications.models import Holiday

    return Holiday.objects.filter(date__year=date.today().year).exists()


def _has_logo() -> bool:
    from organization.models import CompanyProfile

    return bool(CompanyProfile.get_solo().logo)


def _has_reminder_rules() -> bool:
    from notifications.models import ReminderRule

    return ReminderRule.objects.filter(is_enabled=True).exists()


def _devices_permitted() -> bool:
    """Only ask about readers where the company permits readers.

    Reads the row rather than `get_solo`, because materialising a policy just
    to decide whether to *show* a setup hint would write to the database on a
    GET — and a missing row means nobody has configured attendance at all,
    which is not a company to nag about biometric devices.
    """
    from attendance.policy import AttendancePolicy

    policy = AttendancePolicy.objects.first()
    return policy is not None and policy.allow_biometric


def _has_devices() -> bool:
    from attendance.models import Device

    return Device.objects.exists()


# ── The registry ─────────────────────────────────────────────────────────────

CHECKS: tuple[SetupCheck, ...] = (
    # Must-have — nobody can be paid correctly without these.
    SetupCheck(
        key="company_named",
        tier=Tier.MUST,
        domain="Company",
        title="Name your company",
        why="It appears on every payslip, offer letter and email the system sends.",
        href="/settings/company",
        resolve=_company_named,
    ),
    SetupCheck(
        key="working_days",
        tier=Tier.MUST,
        domain="Company",
        title="Choose your working days",
        why="Payroll cannot price a day's absence, and attendance cannot tell a day off from an absence.",
        href="/settings/company",
        resolve=_working_days_chosen,
    ),
    SetupCheck(
        key="email_delivery",
        tier=Tier.MUST,
        domain="Company",
        title="Set up outgoing email",
        why="Both ways of adding an employee mail them a temporary password. Until this works, nobody you add can sign in.",
        href="/settings/email",
        resolve=_email_delivery,
    ),
    SetupCheck(
        key="departments",
        tier=Tier.MUST,
        domain="People",
        title="Add your departments",
        why="An employee record needs one, and reports group by it.",
        href="/settings/org",
        resolve=_has_departments,
    ),
    SetupCheck(
        key="designations",
        tier=Tier.MUST,
        domain="People",
        title="Add your job titles",
        why="Offers and employee records both carry one.",
        href="/settings/org",
        resolve=_has_designations,
    ),
    SetupCheck(
        key="salary_components",
        tier=Tier.MUST,
        domain="Payroll",
        title="Define your salary components",
        why="Basic, allowances and deductions. A payslip is built from these, so there is nothing to pay without them.",
        href="/payroll/components",
        resolve=_has_salary_components,
    ),

    SetupCheck(
        key="tax_slabs",
        tier=Tier.MUST,
        domain="Payroll",
        title="Confirm this year's income tax slabs",
        why=(
            "Without slabs for the current fiscal year, every payslip deducts no income tax — "
            "and a run that taxes nobody looks exactly like a correct one until filing time."
        ),
        href="/payroll/tax-slabs",
        resolve=_tax_slabs_for_this_year,
    ),
    SetupCheck(
        key="statutory_rates",
        tier=Tier.MUST,
        domain="Payroll",
        title="Confirm this year's statutory rates",
        why="SSF, PF, CIT and the insurance ceilings. Shipped defaults are unverified until somebody checks them against the Finance Act.",
        href="/payroll/statutory-rates",
        resolve=_statutory_rates_for_this_year,
    ),
    # Recommended — the absence shows up in month one.
    SetupCheck(
        key="salary_assigned",
        tier=Tier.RECOMMENDED,
        domain="Payroll",
        title="Give every employee a salary structure",
        why=(
            "Somebody without one is not refused by a payroll run — they are skipped by it. "
            "The run completes, the totals look plausible, and one person is simply not paid."
        ),
        # Per-employee, so there is no company-level structures page to link
        # to — the assignment happens on somebody's record.
        href="/employees",
        resolve=_everyone_has_a_salary,
        applies=_has_employees_to_pay,
    ),
    SetupCheck(
        key="first_employee",
        tier=Tier.RECOMMENDED,
        domain="People",
        title="Add your first employee",
        why="Everything else — attendance, leave, payroll, the portal — reads from employee records.",
        href="/employees",
        resolve=_has_employee,
    ),
    SetupCheck(
        key="leave_types",
        tier=Tier.RECOMMENDED,
        domain="Leave",
        title="Set up your leave types and quotas",
        why="Nobody can request leave until there is a type to request, and unpaid absence reaches the payslip instead.",
        href="/leave",
        resolve=_has_leave_types,
    ),
    SetupCheck(
        key="approval_chain",
        tier=Tier.RECOMMENDED,
        domain="Leave",
        title="Decide who approves leave",
        why="Without a chain, requests have nowhere to go.",
        href="/leave",
        resolve=_has_approval_chain,
    ),
    SetupCheck(
        key="shift",
        tier=Tier.RECOMMENDED,
        domain="Attendance",
        title="Define at least one shift",
        why="A shift is what decides who is late. Without one there is no such thing as late.",
        href="/settings/attendance",
        resolve=_has_shift,
    ),
    SetupCheck(
        key="holidays",
        tier=Tier.RECOMMENDED,
        domain="Attendance",
        title="Add this year's public holidays",
        why="Otherwise a day the office was shut is charged as an absence. The dates move each year, so they cannot be assumed.",
        href="/settings/holidays",
        resolve=_has_holidays,
    ),
    SetupCheck(
        key="logo",
        tier=Tier.RECOMMENDED,
        domain="Company",
        title="Upload your logo",
        why="It appears on payslips and offer letters, which are documents your staff keep.",
        href="/settings/company",
        resolve=_has_logo,
    ),
    # Advanced — only where the module is in use.
    SetupCheck(
        key="reminder_rules",
        tier=Tier.ADVANCED,
        domain="Notifications",
        title="Turn on the reminders you want",
        why="Probation ending, passports expiring and holidays coming up all pass silently otherwise.",
        href="/settings/reminders",
        resolve=_has_reminder_rules,
    ),
    SetupCheck(
        key="devices",
        tier=Tier.ADVANCED,
        domain="Attendance",
        title="Register your attendance readers",
        why="You have allowed device check-in, so the readers need to be registered before they can send punches.",
        href="/settings/devices",
        resolve=_has_devices,
        applies=_devices_permitted,
    ),
)


CHECKS_BY_KEY = {check.key: check for check in CHECKS}


# ── Reading the state ────────────────────────────────────────────────────────


def readiness(include_skipped_as_done: bool = True) -> dict:
    """The whole picture: every applicable check, resolved now.

    **The score counts must-haves only.** A company who has done everything that
    stops them paying people correctly is ready, and showing them 71% because
    they have not uploaded a logo turns a real signal into decoration nobody
    reads. Recommended and advanced progress is reported separately, so it is
    visible without diluting the number that decides whether payroll is safe.
    """
    from organization.models import SetupSkip

    skipped = dict(SetupSkip.objects.values_list("check_key", "reason"))

    tiers: dict[str, list[dict]] = {tier.value: [] for tier in Tier}
    for check in CHECKS:
        if not _safe(check.applies, default=False):
            continue
        done = _safe(check.resolve, default=False)
        was_skipped = check.key in skipped and check.skippable
        tiers[check.tier.value].append(
            {
                "key": check.key,
                "domain": check.domain,
                "title": check.title,
                "why": check.why,
                "href": check.href,
                "done": done,
                "skippable": check.skippable,
                "skipped": was_skipped,
                "skip_reason": skipped.get(check.key) if was_skipped else None,
            }
        )

    must = tiers[Tier.MUST.value]
    # Must-haves are never skippable, so nothing is forgiven here.
    must_done = [c for c in must if c["done"]]

    def _settled(rows):
        return [c for c in rows if c["done"] or (include_skipped_as_done and c["skipped"])]

    rest = tiers[Tier.RECOMMENDED.value] + tiers[Tier.ADVANCED.value]

    return {
        "tiers": tiers,
        "must_total": len(must),
        "must_done": len(must_done),
        #: The headline. Whole per cent — a setup score with a decimal point is
        #: claiming a precision that fifteen boolean checks do not have.
        "percent": round(len(must_done) / len(must) * 100) if must else 100,
        "is_ready": len(must_done) == len(must),
        "blocking": [c for c in must if not c["done"]],
        "optional_total": len(rest),
        "optional_settled": len(_settled(rest)),
    }


def _safe(fn, default):
    """A check that raises must not take the setup page down with it.

    A resolver touches another app's tables, and one of those failing — a
    migration mid-flight, a model that moved — should show that check as
    unresolved rather than 500 the one screen a stuck company is on.
    """
    try:
        return fn()
    except Exception:  # noqa: BLE001 — see the docstring
        return default
