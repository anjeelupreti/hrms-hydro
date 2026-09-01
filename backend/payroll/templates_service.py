"""Putting a workforce on pay without a hundred identical forms.

Applying a template **copies** its lines into a new `SalaryStructure` for each
employee. The copy is the point: a structure is the record of what somebody was
actually paid from when, and it must not move because a template was edited
afterwards. Once stamped, the two have nothing to do with each other.

The awkward cases are all about people who already have a structure, and they
are the reason this is a service with a report rather than a loop in a view.
"""

from dataclasses import dataclass, field

from django.db import transaction

from employees.models import Employee
from payroll.models import SalaryStructure, SalaryStructureAssignment, SalaryTemplate


class TemplateError(Exception):
    """The request cannot be carried out at all — as opposed to a per-person
    outcome, which is reported rather than raised."""


@dataclass
class ApplyReport:
    """What actually happened, per person.

    A bulk action that answers only "done" is untrustworthy at exactly the
    moment it matters — putting ninety-seven people on pay and quietly skipping
    three is indistinguishable from putting a hundred on pay. Every employee
    lands in exactly one of these lists.
    """

    created: list[str] = field(default_factory=list)
    #: Already had a structure effective on that date. Left alone.
    already_dated: list[str] = field(default_factory=list)
    #: Had some other structure, and `replace_existing` was not asked for.
    already_on_pay: list[str] = field(default_factory=list)

    def as_dict(self):
        return {
            "created": self.created,
            "already_dated": self.already_dated,
            "already_on_pay": self.already_on_pay,
            "created_count": len(self.created),
            "skipped_count": len(self.already_dated) + len(self.already_on_pay),
        }


@transaction.atomic
def apply_template(
    template: SalaryTemplate,
    employees,
    *,
    effective_from,
    replace_existing: bool = False,
) -> ApplyReport:
    """Stamp `template` onto `employees`, effective from `effective_from`.

    `replace_existing=False` — the default, and the safe one — touches only
    people who have no structure at all. That is what "put everyone who is not
    yet on pay onto the standard structure" means, and it is the operation
    somebody reaches for when setting a workspace up.

    `replace_existing=True` adds a **new effective-dated row** to people who
    already have one. It does not edit or delete anything: the old structure
    stays exactly as it was, still governing every payroll run dated before
    `effective_from`. There is no mode that rewrites history, because there is
    no legitimate reason to want one.
    """
    lines = list(template.lines.select_related("component"))
    if not lines:
        # A template with no components would produce a structure that pays
        # nothing, silently, for everybody it touched. Refuse loudly instead.
        raise TemplateError(
            f"“{template.name}” has no components in it yet, so there is nothing to apply."
        )

    report = ApplyReport()

    for employee in employees:
        label = employee.employee_code or str(employee.pk)
        existing = employee.salary_structures.all()

        # Two different refusals, kept apart because they need different
        # answers from the person reading the result. One is "you have already
        # done this"; the other is "this person is on pay and you did not say
        # you meant to change that".
        if existing.filter(effective_from=effective_from).exists():
            report.already_dated.append(label)
            continue
        if existing.exists() and not replace_existing:
            report.already_on_pay.append(label)
            continue

        structure = SalaryStructure.objects.create(
            employee=employee,
            effective_from=effective_from,
            notes=f"From template “{template.name}”.",
        )
        SalaryStructureAssignment.objects.bulk_create(
            [
                SalaryStructureAssignment(
                    structure=structure, component=line.component, amount=line.amount
                )
                for line in lines
            ]
        )
        report.created.append(label)

    return report


def employees_without_structure():
    """Everybody currently employed who has no salary structure at all.

    Restricted to active employment on purpose: somebody who resigned last year
    does not need putting on pay, and including them would make the count on
    the setup screen permanently wrong in a way that never resolves.
    """
    return (
        Employee.objects.filter(employment_status=Employee.EmploymentStatus.ACTIVE)
        .filter(salary_structures__isnull=True)
        .order_by("employee_code")
    )
