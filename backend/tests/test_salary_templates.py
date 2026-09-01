"""Putting a workforce on pay from a template.

The interesting cases are all refusals. A bulk action that reports "done" while
quietly skipping three people is indistinguishable from one that worked, right
up until payday — so every skip has to be visible, and each kind of skip has to
be distinguishable from the others, because they need different answers.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from employees.models import Employee
from payroll.models import (
    SalaryComponent,
    SalaryStructure,
    SalaryTemplate,
    SalaryTemplateLine,
)
from payroll.templates_service import (
    TemplateError,
    apply_template,
    employees_without_structure,
)

pytestmark = [pytest.mark.django_db]

TODAY = date.today()


def _component(code="BASIC", name="Basic"):
    return SalaryComponent.objects.create(
        code=code,
        name=name,
        component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.FLAT,
        amount=Decimal("40000"),
    )


def _template(company, *, name="Officer", with_lines=True):
    template = SalaryTemplate.objects.create(name=name)
    if with_lines:
        SalaryTemplateLine.objects.create(
            template=template, component=_component(f"BASIC_{name.upper()}"), amount=Decimal("40000")
        )
    return template


def _employee(company, code, *, status=Employee.EmploymentStatus.ACTIVE):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    user = User.objects.create_user(username=f"u{code}", email=f"{code}@x.test", password="x")
    return Employee.objects.create(
        user=user, employee_code=code, date_joined=TODAY - timedelta(days=30), employment_status=status
    )


def test_applying_a_template_creates_a_structure_with_its_components(company):
    template = _template(company)
    person = _employee(company, "EMP-100")

    report = apply_template(template, [person], effective_from=TODAY)

    assert report.created == ["EMP-100"]
    structure = SalaryStructure.objects.get(employee=person)
    assert structure.effective_from == TODAY
    assert [a.amount for a in structure.assignments.all()] == [Decimal("40000.00")]


def test_the_copy_does_not_follow_the_template_afterwards(company):
    """The whole reason a template and a structure are two models.

    Editing a template must not restate what somebody was already paid from.
    """
    template = _template(company)
    person = _employee(company, "EMP-101")
    apply_template(template, [person], effective_from=TODAY)

    line = template.lines.first()
    line.amount = Decimal("99999")
    line.save()

    structure = SalaryStructure.objects.get(employee=person)
    assert structure.assignments.first().amount == Decimal("40000.00")


def test_somebody_already_on_pay_is_skipped_and_named(company):
    template = _template(company)
    person = _employee(company, "EMP-102")
    SalaryStructure.objects.create(employee=person, effective_from=TODAY - timedelta(days=90))

    report = apply_template(template, [person], effective_from=TODAY)

    assert report.created == []
    assert report.already_on_pay == ["EMP-102"]
    # And nothing was added behind their back.
    assert SalaryStructure.objects.filter(employee=person).count() == 1


def test_replacing_adds_a_new_dated_row_and_leaves_the_old_one_alone(company):
    """There is no mode that rewrites history, and this is what that means."""
    template = _template(company)
    person = _employee(company, "EMP-103")
    old = SalaryStructure.objects.create(employee=person, effective_from=TODAY - timedelta(days=90))

    report = apply_template(template, [person], effective_from=TODAY, replace_existing=True)

    assert report.created == ["EMP-103"]
    assert SalaryStructure.objects.filter(employee=person).count() == 2
    old.refresh_from_db()
    assert old.effective_from == TODAY - timedelta(days=90)


def test_applying_twice_on_the_same_date_is_reported_separately(company):
    """Distinguished from "already on pay" on purpose.

    One means "you have already done exactly this"; the other means "this
    person is on pay and you did not say you meant to change that". Collapsing
    them would leave somebody unable to tell a repeat click from a real
    conflict.
    """
    template = _template(company)
    person = _employee(company, "EMP-104")
    apply_template(template, [person], effective_from=TODAY)

    report = apply_template(template, [person], effective_from=TODAY, replace_existing=True)

    assert report.already_dated == ["EMP-104"]
    assert report.created == []
    assert SalaryStructure.objects.filter(employee=person).count() == 1


def test_an_empty_template_is_refused_rather_than_paying_nothing(company):
    template = _template(company, with_lines=False)
    person = _employee(company, "EMP-105")

    with pytest.raises(TemplateError):
        apply_template(template, [person], effective_from=TODAY)

    assert not SalaryStructure.objects.filter(employee=person).exists()


def test_only_one_template_can_be_the_default(company):
    """Marking a second default demotes the first rather than raising —
    which is what somebody clicking "make this the default" means."""
    first = SalaryTemplate.objects.create(name="Officer", is_default=True)
    second = SalaryTemplate.objects.create(name="Technician", is_default=True)

    first.refresh_from_db()
    assert not first.is_default
    assert second.is_default


def test_people_who_have_left_are_not_waiting_to_be_put_on_pay(company):
    """Otherwise the count on the setup screen is permanently wrong in a way
    that never resolves."""
    _employee(company, "EMP-106")
    _employee(company, "EMP-107", status=Employee.EmploymentStatus.RESIGNED)

    codes = list(employees_without_structure().values_list("employee_code", flat=True))

    assert "EMP-106" in codes
    assert "EMP-107" not in codes


# ── Through the API ──────────────────────────────────────────────────────


def test_apply_with_no_employees_means_everybody_not_yet_on_pay(hr_client, company):
    template = _template(company)
    _employee(company, "EMP-200")
    _employee(company, "EMP-201")
    settled = _employee(company, "EMP-202")
    SalaryStructure.objects.create(employee=settled, effective_from=TODAY - timedelta(days=10))

    response = hr_client.post(
        f"/api/v1/payroll/salary-templates/{template.pk}/apply/",
        {"effective_from": TODAY.isoformat()},
        format="json",
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body["created"]) >= {"EMP-200", "EMP-201"}
    assert "EMP-202" not in body["created"]


def test_an_employee_cannot_put_the_company_on_pay(employee_client, company):
    template = _template(company)
    _employee(company, "EMP-203")

    response = employee_client.post(
        f"/api/v1/payroll/salary-templates/{template.pk}/apply/",
        {"effective_from": TODAY.isoformat()},
        format="json",
    )

    assert response.status_code in (403, 404)


def test_the_unassigned_count_is_the_whole_workforce_not_one_page(hr_client, company):
    for n in range(5):
        _employee(company, f"EMP-3{n:02d}")

    response = hr_client.get("/api/v1/payroll/salary-templates/unassigned/")

    assert response.status_code == 200
    assert response.json()["count"] >= 5
