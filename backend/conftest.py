"""Root test fixtures.

One company, one database, one schema — so a fixture's whole job is to put a
signed-in user of the right role in front of an API client. The three roles that
matter to authorisation each get a client, because most of what is worth
asserting here is the difference between them.
"""

from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from companies.models import Company
from employees.models import Department, Designation, Employee
from organization.models import CompanyProfile
from payroll.models import PayrollRun, SalaryComponent
from payroll.services import _upsert_structure_version

User = get_user_model()


# ── Users ────────────────────────────────────────────────────────────────


def _make_user(*, username: str, role: str, is_staff=False, is_superuser=False):
    user = User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="test-pass-123",
        role=role,
    )
    user.is_staff = is_staff
    user.is_superuser = is_superuser
    user.save()
    return user


@pytest.fixture
def owner_user(db):
    """The account the system was installed under. Holds everything, and is the
    only one that may appoint an HR admin."""
    return _make_user(username="owner", role=User.Role.OWNER)


@pytest.fixture
def admin_user(db):
    return _make_user(username="admin", role=User.Role.HR_ADMIN, is_staff=True, is_superuser=True)


@pytest.fixture
def hr_user(db):
    return _make_user(username="hr", role=User.Role.HR_ADMIN)


@pytest.fixture
def officer_user(db):
    """An HR officer, holding exactly what the role carries.

    Nothing is granted here any more. The role used to carry no permissions at
    all, so a fixture that granted nothing was testing an employee under
    another name; it now carries the *operating* set outright — see
    `OFFICER_PERMISSIONS` — and the restriction that makes an officer an
    officer is the verb, not the absence of a grant.

    Left ungranted deliberately: a test that wants to see a grant working
    should grant something the role does *not* hold, or it is watching the
    default and calling it a grant.
    """
    return _make_user(username="officer", role=User.Role.HR_OFFICER)


@pytest.fixture
def employee_user(db):
    return _make_user(username="employee", role=User.Role.EMPLOYEE)


# ── API clients ──────────────────────────────────────────────────────────


@pytest.fixture
def api_client():
    """Unauthenticated — used to prove endpoints fail closed."""
    return APIClient()


def _authenticated_client(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def owner_client(owner_user):
    return _authenticated_client(owner_user)


@pytest.fixture
def admin_client(admin_user):
    return _authenticated_client(admin_user)


@pytest.fixture
def hr_client(hr_user):
    return _authenticated_client(hr_user)


@pytest.fixture
def officer_client(officer_user):
    return _authenticated_client(officer_user)


@pytest.fixture
def employee_client(employee_user):
    return _authenticated_client(employee_user)


# ── Companies ────────────────────────────────────────────────────────────


@pytest.fixture
def company(db):
    """One operating entity, for anything that touches the employment record."""
    return Company.objects.create(
        name="Sanjen Jalavidyut Company Ltd",
        code="SJCL",
        kind=Company.Kind.SPV,
        project_stage=Company.ProjectStage.OPERATION,
        installed_capacity_mw=Decimal("42.500"),
        river="Sanjen Khola",
    )


@pytest.fixture
def second_company(db):
    """A second entity — a secondary posting needs somewhere to point."""
    return Company.objects.create(
        name="Rasuwagadhi Hydropower Company Ltd",
        code="RHCL",
        kind=Company.Kind.SPV,
        project_stage=Company.ProjectStage.CONSTRUCTION,
        installed_capacity_mw=Decimal("111.000"),
        river="Bhotekoshi",
    )


# ── Payroll ──────────────────────────────────────────────────────────────


@pytest.fixture
def payroll_setup(db, admin_user, company):
    profile = CompanyProfile.get_solo()
    profile.payroll_prorate = True
    profile.save()

    dept = Department.objects.create(name="Engineering", code="ENG-01")
    desig = Designation.objects.create(title="Engineer", department=dept)
    emp = Employee.objects.create(
        user=admin_user,
        employee_code="EMP-001",
        date_joined=date(2026, 1, 1),
        department=dept,
        designation=desig,
        primary_company=company,
    )

    basic = SalaryComponent.objects.create(
        code="basic", name="Basic", component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.FLAT, amount=Decimal("50000"), is_active=True, order=1,
    )
    hra = SalaryComponent.objects.create(
        code="hra", name="HRA", component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.PERCENTAGE_OF, percentage_of=basic,
        amount=Decimal("40"), is_active=True, order=2,
    )
    tax = SalaryComponent.objects.create(
        code="tax", name="Tax", component_type=SalaryComponent.ComponentType.DEDUCTION,
        calc_type=SalaryComponent.CalcType.FORMULA, formula="basic * 0.1", is_active=True, order=3,
    )

    _upsert_structure_version(
        emp,
        date(2026, 1, 1),
        [(basic, Decimal("50000")), (hra, Decimal("40")), (tax, None)],
        notes="Initial",
    )

    run = PayrollRun.objects.create(
        period_calendar="AD", period_year=2026, period_month=8,
        status=PayrollRun.Status.DRAFT, created_by=admin_user,
    )

    return {
        "emp": emp,
        "run": run,
        "components": {"basic": basic, "hra": hra, "tax": tax},
        "dept": dept,
        "desig": desig,
        "company": company,
    }
