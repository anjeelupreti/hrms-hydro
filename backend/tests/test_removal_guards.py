"""Removal is possible, and refused with a reason when the row is binding.

Implements docs/checklist.md §R2. Each pair of tests is deliberate: one proves
the removal *works* in the ordinary case, one proves it is refused once
something depends on it. A guard that only ever refuses is not a guard, it is
just the old "you cannot delete this" with extra steps.
"""

from datetime import date
from decimal import Decimal

import pytest
from rest_framework import status

from accounts.models import User
from employees.models import Department, Designation, Employee
from leave.models import LeaveRequest, LeaveType
from payroll.models import PayrollRun, SalaryComponent, SalaryStructure, SalaryStructureAssignment

pytestmark = pytest.mark.django_db


@pytest.fixture
def employee(company):
    user = User.objects.create_user(
        username="worker",
        email="worker@t.test",
        password="pw",
        role=User.Role.EMPLOYEE,
        first_name="Work",
        last_name="Er",
    )
    return Employee.objects.create(
        user=user,
        employee_code="EMP-RM1",
        date_joined=date(2026, 1, 1),
        department=Department.objects.create(name="Ops", code="OPSR"),
        designation=Designation.objects.create(title="Operator I"),
    )


# ── Salary components ────────────────────────────────────────────────────


def test_an_unused_salary_component_can_be_deleted(hr_client, company):
    component = SalaryComponent.objects.create(
        code="TYPO", name="Typo", component_type="earning", calc_type="flat", amount=1
    )

    response = hr_client.delete(f"/api/v1/payroll/components/{component.id}/")

    assert response.status_code == status.HTTP_204_NO_CONTENT
    assert not SalaryComponent.objects.filter(id=component.id).exists()


def test_a_component_used_by_a_structure_is_refused_with_the_reason(hr_client, company, employee):
    component = SalaryComponent.objects.create(
        code="BASIC_RM", name="Basic", component_type="earning", calc_type="flat", amount=1000
    )
    structure = SalaryStructure.objects.create(employee=employee, effective_from=date(2026, 1, 1))
    SalaryStructureAssignment.objects.create(
        structure=structure, component=component, amount=Decimal("1000")
    )

    response = hr_client.delete(f"/api/v1/payroll/components/{component.id}/")

    assert response.status_code == status.HTTP_409_CONFLICT
    # The message has to name what is blocking it, not just say "no".
    assert "in use" in response.data["detail"].lower()
    assert "deactivate" in response.data["detail"].lower()
    assert SalaryComponent.objects.filter(id=component.id).exists()


def test_deactivating_is_the_way_out_when_deleting_is_refused(hr_client, company):
    component = SalaryComponent.objects.create(
        code="OLDALW", name="Old allowance", component_type="earning", calc_type="flat", amount=5
    )

    response = hr_client.post(f"/api/v1/payroll/components/{component.id}/deactivate/")

    assert response.status_code == status.HTTP_200_OK
    component.refresh_from_db()
    assert component.is_active is False


def test_deactivation_is_itself_reversible(hr_client, company):
    component = SalaryComponent.objects.create(
        code="SEASON", name="Seasonal", component_type="earning",
        calc_type="flat", amount=5, is_active=False,
    )

    response = hr_client.post(f"/api/v1/payroll/components/{component.id}/reactivate/")

    assert response.status_code == status.HTTP_200_OK
    component.refresh_from_db()
    assert component.is_active is True


# ── Leave types ──────────────────────────────────────────────────────────


def test_an_unused_leave_type_can_be_deleted(hr_client, company):
    leave_type = LeaveType.objects.create(name="Mistake", code="MIS", annual_quota_days=1)

    response = hr_client.delete(f"/api/v1/leave/types/{leave_type.id}/")

    assert response.status_code == status.HTTP_204_NO_CONTENT


def test_leave_types_still_list(hr_client, company):
    """The listing is what the retire toggle reads.

    This exists because the first version of the retire feature was built on an
    `is_active` field LeaveType did not have — the `is_active` I had found
    belonged to ApprovalChain further down the same file. Every DELETE test
    still passed, because none of them listed anything; the serializer only
    blew up on GET, which a live check caught and the suite did not.
    """
    LeaveType.objects.create(name="Listed", code="LST", annual_quota_days=3)

    response = hr_client.get("/api/v1/leave/types/")

    assert response.status_code == status.HTTP_200_OK
    assert "is_active" in response.data["results"][0]


def test_a_retired_leave_type_can_be_offered_again(hr_client, company):
    leave_type = LeaveType.objects.create(name="Sabbatical", code="SAB", annual_quota_days=0)

    assert hr_client.post(f"/api/v1/leave/types/{leave_type.id}/deactivate/").status_code == 200
    leave_type.refresh_from_db()
    assert leave_type.is_active is False

    assert hr_client.post(f"/api/v1/leave/types/{leave_type.id}/reactivate/").status_code == 200
    leave_type.refresh_from_db()
    assert leave_type.is_active is True


def test_a_leave_type_with_requests_is_refused_rather_than_taking_them_with_it(
    hr_client, company, employee
):
    leave_type = LeaveType.objects.create(name="Annual RM", code="ALRM", annual_quota_days=20)
    LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=date(2026, 3, 1),
        end_date=date(2026, 3, 2),
        days_requested=Decimal("2"),
    )

    response = hr_client.delete(f"/api/v1/leave/types/{leave_type.id}/")

    assert response.status_code == status.HTTP_409_CONFLICT
    detail = response.data["detail"].lower()
    assert "leave request" in detail        # names what blocks it
    assert "deactivate" in detail           # and the way out
    assert LeaveType.objects.filter(id=leave_type.id).exists()
    assert LeaveRequest.objects.filter(leave_type=leave_type).exists()


# ── Payroll runs ─────────────────────────────────────────────────────────


def test_a_draft_payroll_run_can_be_deleted(hr_client, company):
    """A run created for the wrong month can be undone while it is a draft."""
    run = PayrollRun.objects.create(period_calendar="AD", period_year=2026, period_month=4)

    response = hr_client.delete(f"/api/v1/payroll/runs/{run.id}/")

    assert response.status_code == status.HTTP_204_NO_CONTENT


@pytest.mark.parametrize("locked_status", ["completed", "processing"])
def test_a_run_that_is_no_longer_a_draft_cannot_be_deleted(hr_client, company, locked_status):
    """Its payslips are the record of what people were paid."""
    run = PayrollRun.objects.create(period_calendar="AD", period_year=2026, period_month=5, status=locked_status)

    response = hr_client.delete(f"/api/v1/payroll/runs/{run.id}/")

    assert response.status_code == status.HTTP_409_CONFLICT
    assert "draft" in response.data["detail"].lower()
    assert PayrollRun.objects.filter(id=run.id).exists()
