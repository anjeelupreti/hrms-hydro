"""How a company clocks in — and how it refuses the ways it does not.

**The gap this closes.** `AttendanceLog.Source` has always listed web, manual,
biometric and system, and `Device` has always had an authenticated ingest
webhook. What was missing was anybody deciding *which of those a company
permits*. So the company implicitly allowed all of them, and a company that
bought readers precisely so people cannot clock each other in had web
self-check-in switched on with no way to turn it off.

**Three rules shape this, and each exists because the obvious design breaks.**

1. *A per-employee override, not three booleans on the company.* The factory
   floor uses a reader and the field sales team cannot — a single company-wide
   answer forces a company to pick which half of their staff is unsupported.

2. *`manual` is always available to HR.* A policy that can be configured into
   "reader only" becomes an outage the morning the reader breaks: nobody can be
   marked present, and the month cannot be paid. Attendance feeds payroll, so a
   lockout here is a lockout from money. HR keeps a way in, always.

3. *Silence permits.* A company with no policy row behaves exactly as before.
   That makes this additive — no migration has to guess what existing customers
   intended, and nobody arrives on Monday unable to clock in.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models

from core.models import AuditModel
from employees.models import Employee


class AttendanceSourceError(ValidationError):
    """This company does not accept attendance from that source."""


class AttendancePolicy(AuditModel):
    """Singleton per company — the company's answer to "how do people clock in?"."""

    #: Sources anybody may use. `manual` is deliberately absent from the default
    #: set *as an employee-facing option* — it is HR's correction path, granted
    #: by `allows` below rather than by configuration.
    allow_web = models.BooleanField(
        default=True,
        help_text="Employees may clock in and out from the workspace.",
    )
    allow_biometric = models.BooleanField(
        default=True,
        help_text="Registered devices may post attendance for employees.",
    )

    # ── Lateness (D‑05) ──────────────────────────────────────────────────
    #
    # **A mechanism, off by default.** `Shift.grace_period_minutes` has always
    # decided who is *late*, and `late_days` has always reached payroll — but
    # nothing turned it into money, and that was deliberate: inventing a default
    # would dock pay under a rule nobody agreed to. So the rule exists and does
    # nothing until a company switches it on and says what it is.
    #
    # **Counted in whole late days, not minutes.** Charging by the minute makes
    # every late arrival an argument about traffic, and it is the same reasoning
    # that keeps hours worked away from pay entirely (see `PeriodAttendance`).
    # A company that wants a consequence usually means "three lates cost a day",
    # which is a rule people can hold in their head and check on a payslip.
    lateness_deduction_enabled = models.BooleanField(
        default=False,
        help_text="Turn late arrivals into a pay deduction. Off unless a company chooses it.",
    )
    late_days_per_deduction = models.PositiveSmallIntegerField(
        default=3,
        help_text=(
            "How many late days cost one day's pay. Ignored while the deduction "
            "is off."
        ),
    )

    def lateness_penalty_days(self, late_days) -> Decimal:
        """Days of pay lost to lateness this period.

        Whole days only, rounded **down**: a company that says three lates cost
        a day means exactly that, and charging two-thirds of a day for two lates
        is a number nobody agreed to and nobody can check.
        """
        if not self.lateness_deduction_enabled or not self.late_days_per_deduction:
            return Decimal("0")
        return Decimal(int(Decimal(late_days) // Decimal(self.late_days_per_deduction)))

    class Meta:
        verbose_name_plural = "Attendance policies"

    def __str__(self):
        return f"Attendance policy ({', '.join(self.permitted_sources()) or 'HR only'})"

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def permitted_sources(self):
        """The sources an ordinary employee or device may write through."""
        from attendance.models import AttendanceLog

        sources = []
        if self.allow_web:
            sources.append(AttendanceLog.Source.WEB)
        if self.allow_biometric:
            sources.append(AttendanceLog.Source.BIOMETRIC)
        return sources


class EmployeeAttendanceMethod(AuditModel):
    """One employee's override of the company policy.

    Exists because "how does this company clock in" is the wrong question for
    any company with more than one kind of job in it.
    """

    employee = models.OneToOneField(
        Employee, on_delete=models.CASCADE, related_name="attendance_method"
    )
    allow_web = models.BooleanField(null=True, blank=True)
    allow_biometric = models.BooleanField(null=True, blank=True)
    note = models.CharField(
        max_length=255,
        blank=True,
        help_text="Why this person differs from the company default.",
    )

    def __str__(self):
        return f"{self.employee.employee_code} attendance method"


def allows(source, *, employee=None, by_hr=False):
    """Whether `source` may write attendance, for this employee, right now.

    `by_hr=True` is the escape hatch rule 2 exists for: HR correcting a record,
    or the absence sweep, is never refused. Everything else is checked against
    the employee's override first and the company policy second.
    """
    from attendance.models import AttendanceLog

    if by_hr or source in (AttendanceLog.Source.MANUAL, AttendanceLog.Source.SYSTEM):
        return True

    policy = AttendancePolicy.objects.first()
    if policy is None:
        # Silence permits — an unconfigured company behaves exactly as it did
        # before this module existed.
        return True

    field = {
        AttendanceLog.Source.WEB: "allow_web",
        AttendanceLog.Source.BIOMETRIC: "allow_biometric",
    }.get(source)
    if field is None:
        return True

    if employee is not None:
        override = getattr(employee, "attendance_method", None)
        if override is not None and getattr(override, field) is not None:
            return getattr(override, field)

    return getattr(policy, field)


def require(source, *, employee=None, by_hr=False):
    """`allows`, but raising the reason instead of returning False.

    Callers use this in the **service layer** rather than hiding a button: a
    hidden control leaves the API open, and the ingest webhook has no UI to hide
    anything in.
    """
    if allows(source, employee=employee, by_hr=by_hr):
        return True
    from attendance.models import AttendanceLog

    label = AttendanceLog.Source(source).label
    raise AttendanceSourceError(
        f"This workspace does not accept attendance from “{label}”. "
        "Ask HR to record it for you, or to enable this method."
    )
