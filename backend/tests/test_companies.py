"""The group's operating companies, and an employee's place in them.

Two things are pinned here.

**Primary and secondary are different relationships.** One is employment — who
pays this person, on their contract and their payslip — and there is exactly
one. The other is where they also work, and carries no money. A single
many-to-many could not tell "who works at Sanjen?" from "whose payroll does
Sanjen run?", and both questions get asked.

**A company with people on it is deactivated, not deleted.** It still owns the
employment history of everyone who worked for it.
"""

from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from companies.models import Company
from employees.models import Employee

pytestmark = pytest.mark.django_db


LIST = "/api/v1/companies/companies/"


# ── The record ───────────────────────────────────────────────────────────


def test_a_company_can_be_created_by_an_hr_admin(admin_client):
    response = admin_client.post(
        LIST,
        {
            "name": "Upper Tamakoshi Hydropower Ltd",
            "code": "UTKHPL",
            "kind": Company.Kind.SPV,
            "project_stage": Company.ProjectStage.OPERATION,
            "installed_capacity_mw": "456.000",
            "river": "Tamakoshi",
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["kind_display"] == "Project company (SPV)"
    assert response.data["employee_count"] == 0


def test_capacity_keeps_its_fractions(admin_client):
    """Plants of 4.5 and 25.5 MW are ordinary, and rounding one to 5 misstates
    a licence."""
    response = admin_client.post(
        LIST,
        {"name": "Sanjen Upper", "code": "SUJ", "installed_capacity_mw": "14.800"},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert Decimal(response.data["installed_capacity_mw"]) == Decimal("14.800")


def test_a_company_cannot_be_its_own_parent(company):
    company.parent = company
    with pytest.raises(ValidationError):
        company.clean()


def test_a_parent_loop_is_refused(company, second_company):
    """A→B→A makes every org-chart read non-terminating, so it is caught on the
    way in rather than at render time."""
    company.parent = second_company
    company.save()
    second_company.parent = company

    with pytest.raises(ValidationError):
        second_company.clean()


# ── Deleting ─────────────────────────────────────────────────────────────


def test_a_company_with_employees_cannot_be_deleted(admin_client, company, employee_user):
    Employee.objects.create(
        user=employee_user,
        employee_code="EMP-C1",
        date_joined=date(2024, 1, 1),
        primary_company=company,
    )

    response = admin_client.delete(f"{LIST}{company.pk}/")

    assert response.status_code == 409
    assert response.data["code"] == "company_in_use"
    assert Company.objects.filter(pk=company.pk).exists()


def test_an_empty_company_can_be_deleted(admin_client, company):
    response = admin_client.delete(f"{LIST}{company.pk}/")

    assert response.status_code == 204
    assert not Company.objects.filter(pk=company.pk).exists()


# ── Primary and secondary ────────────────────────────────────────────────


def test_an_employee_belongs_to_one_company_and_works_at_several(
    admin_client, employee_user, company, second_company
):
    employee = Employee.objects.create(
        user=employee_user,
        employee_code="EMP-C2",
        date_joined=date(2024, 1, 1),
        primary_company=company,
    )
    employee.secondary_companies.add(second_company)

    response = admin_client.get(f"/api/v1/employees/employees/{employee.pk}/")

    assert response.status_code == 200, response.data
    assert response.data["primary_company_name"] == company.name
    assert response.data["secondary_company_names"] == [second_company.name]


def test_the_primary_company_cannot_also_be_a_secondary_one(
    admin_client, employee_user, company
):
    """A secondary company is somewhere they *also* work. Listing the primary
    there again is either a mistake or a claim that means nothing."""
    employee = Employee.objects.create(
        user=employee_user,
        employee_code="EMP-C3",
        date_joined=date(2024, 1, 1),
        primary_company=company,
    )

    response = admin_client.patch(
        f"/api/v1/employees/employees/{employee.pk}/",
        {"secondary_companies": [company.pk]},
        format="json",
    )

    assert response.status_code == 400
    assert "secondary_companies" in response.data


def test_the_roster_can_be_filtered_by_company_including_secondments(
    admin_client, employee_user, hr_user, company, second_company
):
    """"Everyone who works here" is neither field on its own."""
    on_payroll = Employee.objects.create(
        user=employee_user, employee_code="EMP-C4",
        date_joined=date(2024, 1, 1), primary_company=company,
    )
    seconded = Employee.objects.create(
        user=hr_user, employee_code="EMP-C5",
        date_joined=date(2024, 1, 1), primary_company=second_company,
    )
    seconded.secondary_companies.add(company)

    response = admin_client.get(f"/api/v1/employees/employees/?company={company.pk}")

    assert response.status_code == 200, response.data
    returned = {row["id"] for row in response.data["results"]}
    assert returned == {on_payroll.pk, seconded.pk}


def test_headcount_counts_the_payroll_not_the_secondments(
    admin_client, employee_user, hr_user, company, second_company
):
    Employee.objects.create(
        user=employee_user, employee_code="EMP-C6",
        date_joined=date(2024, 1, 1), primary_company=company,
    )
    seconded = Employee.objects.create(
        user=hr_user, employee_code="EMP-C7",
        date_joined=date(2024, 1, 1), primary_company=second_company,
    )
    seconded.secondary_companies.add(company)

    response = admin_client.get(f"{LIST}{company.pk}/")

    assert response.data["employee_count"] == 1
