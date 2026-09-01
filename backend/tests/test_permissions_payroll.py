"""P1.3 — payroll access control.

Salary is the most sensitive data in an HR system, and the failure mode is
silent: nothing errors when an employee can read a colleague's payslip, the
data just arrives. So these tests assert from the *attacker's* side — they
create a second employee with real payslips and prove the first one cannot
reach them by any route the API exposes.

Three routes exist to a payslip and each is checked separately, because they
are separately implemented: the list, the detail retrieve, and the PDF
download. A queryset fix that misses one of the three is the exact shape this
suite is built to catch.
"""

from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from employees.models import Employee
from payroll.models import Payslip
from payroll.services import _upsert_structure_version, compute_payslip

pytestmark = pytest.mark.django_db

User = get_user_model()


@pytest.fixture
def two_employees_with_payslips(company, payroll_setup):
    """Alice and Bob, each with a FINALIZED payslip.

    FINALIZED rather than DRAFT on purpose: employees are meant to see their
    own finalized payslips, so a scoping bug can't hide behind the DRAFT
    filter. If Alice can see Bob's, it is a real leak and not a status quirk.
    """
    run = payroll_setup["run"]
    basic = payroll_setup["components"]["basic"]

    made = {}
    for name, salary in (("alice", "40000"), ("bob", "90000")):
        user = User.objects.create_user(
            username=name, email=f"{name}@t.test", password="pw",
            role=User.Role.EMPLOYEE,
        )
        employee = Employee.objects.create(
            user=user, employee_code=f"EMP-{name.upper()}",
            date_joined=date(2026, 1, 1),
            department=payroll_setup["dept"], designation=payroll_setup["desig"],
        )
        _upsert_structure_version(
            employee, date(2026, 1, 1), [(basic, Decimal(salary))], notes="Initial"
        )
        payslip = compute_payslip(run, employee)
        payslip.status = Payslip.Status.FINALIZED
        payslip.save(update_fields=["status"])
        made[name] = {"user": user, "employee": employee, "payslip": payslip}

    return made


def _as(company, user):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=user)
    return client


# ── P1.3.7 — the highest-sensitivity path ────────────────────────────────


def test_employee_list_shows_only_their_own_payslips(company, two_employees_with_payslips):
    alice = two_employees_with_payslips["alice"]
    bob = two_employees_with_payslips["bob"]

    response = _as(company, alice["user"]).get("/api/v1/payroll/payslips/")

    assert response.status_code == 200
    results = response.data["results"] if isinstance(response.data, dict) else response.data
    returned_ids = {row["id"] for row in results}
    assert returned_ids == {alice["payslip"].id}
    assert bob["payslip"].id not in returned_ids


def test_employee_cannot_retrieve_another_employees_payslip(
    company, two_employees_with_payslips
):
    """404 rather than 403 — the object is filtered out of the queryset, so
    its existence is not confirmed either way. That is the right answer for
    salary data: 403 would leak that the payslip exists."""
    alice = two_employees_with_payslips["alice"]
    bob = two_employees_with_payslips["bob"]

    response = _as(company, alice["user"]).get(f"/api/v1/payroll/payslips/{bob['payslip'].id}/")

    assert response.status_code == 404


def test_employee_cannot_download_another_employees_payslip_pdf(
    company, two_employees_with_payslips
):
    """The download action is a separate code path from retrieve. It calls
    get_object(), so it inherits the scoping — this test exists to make sure
    it keeps doing so."""
    alice = two_employees_with_payslips["alice"]
    bob = two_employees_with_payslips["bob"]

    response = _as(company, alice["user"]).get(
        f"/api/v1/payroll/payslips/{bob['payslip'].id}/download/"
    )

    assert response.status_code == 404


def test_filtering_by_another_employee_id_returns_nothing(
    company, two_employees_with_payslips
):
    """`employee` is an exposed filterset field. Filtering is applied on top
    of the scoped queryset, so asking for Bob's must return an empty list
    rather than reaching past the scope."""
    alice = two_employees_with_payslips["alice"]
    bob = two_employees_with_payslips["bob"]

    response = _as(company, alice["user"]).get(
        f"/api/v1/payroll/payslips/?employee={bob['employee'].id}"
    )

    assert response.status_code == 200
    results = response.data["results"] if isinstance(response.data, dict) else response.data
    assert results == []


def test_employee_cannot_mark_a_payslip_paid(company, two_employees_with_payslips):
    alice = two_employees_with_payslips["alice"]

    response = _as(company, alice["user"]).post(
        f"/api/v1/payroll/payslips/{alice['payslip'].id}/mark_paid/",
        {"disbursement_method": "bank", "disbursement_reference": "X"},
        format="json",
    )

    assert response.status_code == 403


# ── Employees do not see drafts ──────────────────────────────────────────


def test_employee_cannot_see_their_own_draft_payslip(company, two_employees_with_payslips):
    """A DRAFT is HR's working computation, not a paycheck. Showing it would
    have employees querying figures that are still going to change."""
    alice = two_employees_with_payslips["alice"]
    alice["payslip"].status = Payslip.Status.DRAFT
    alice["payslip"].save(update_fields=["status"])

    response = _as(company, alice["user"]).get(
        f"/api/v1/payroll/payslips/{alice['payslip'].id}/"
    )

    assert response.status_code == 404


# ── P1.3.4/5 — HR and superuser see everything ───────────────────────────


def test_hr_admin_sees_every_payslip(company, two_employees_with_payslips, hr_user):
    response = _as(company, hr_user).get("/api/v1/payroll/payslips/")

    assert response.status_code == 200
    results = response.data["results"] if isinstance(response.data, dict) else response.data
    returned = {row["id"] for row in results}
    assert two_employees_with_payslips["alice"]["payslip"].id in returned
    assert two_employees_with_payslips["bob"]["payslip"].id in returned


def test_hr_admin_sees_drafts_too(company, two_employees_with_payslips, hr_user):
    alice = two_employees_with_payslips["alice"]
    alice["payslip"].status = Payslip.Status.DRAFT
    alice["payslip"].save(update_fields=["status"])

    response = _as(company, hr_user).get(f"/api/v1/payroll/payslips/{alice['payslip'].id}/")

    assert response.status_code == 200


# ── Compensation config is HR-only, even to read ─────────────────────────


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/payroll/components/",
        "/api/v1/payroll/structures/",
        "/api/v1/payroll/runs/",
        "/api/v1/payroll/tax-slabs/",
    ],
)
def test_employee_cannot_read_compensation_configuration(
    company, two_employees_with_payslips, path
):
    """Salary components and structures reveal the whole pay scale. Unlike
    leave types or holidays, even read access is HR-only — `IsHRAdmin` says
    so explicitly and this pins it per endpoint."""
    alice = two_employees_with_payslips["alice"]

    response = _as(company, alice["user"]).get(path)

    assert response.status_code == 403


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/payroll/components/",
        "/api/v1/payroll/structures/",
        "/api/v1/payroll/runs/",
        "/api/v1/payroll/payslips/",
    ],
)
def test_unauthenticated_access_is_refused(api_client, path):
    """P1.3.6 — fails closed. Company resolves, but no credentials."""
    response = api_client.get(path)

    assert response.status_code in (401, 403)


# ── Gate 5 — payroll is its own capability ───────────────────────────────────


@pytest.mark.django_db
def test_people_management_alone_does_not_reach_payroll(company, hr_user, api_client):
    """🔒 The gap gate 5 existed to close.

    Every payroll viewset used `IsHRAdmin` — which asks the policy, so it was
    never a copy-pasted role check — but **none named a capability**, so all of
    them fell back to the class default of `people.manage`. An officer granted
    people management and deliberately *not* payroll could therefore configure
    salary components and run payroll, which is the whole reason the two
    capabilities are separate.

    Approving somebody's leave and paying them are different authorities.
    """
    from accounts.models import PermissionGrant
    from accounts.policy import Perm

    hr_user.role = hr_user.Role.HR_OFFICER
    hr_user.save(update_fields=["role"])
    PermissionGrant.objects.filter(user=hr_user).delete()
    PermissionGrant.objects.create(user=hr_user, permission=Perm.PEOPLE_MANAGE)

    client = _as(company, hr_user)

    for url in (
        "/api/v1/payroll/components/",
        "/api/v1/payroll/tax-slabs/",
        "/api/v1/payroll/runs/",
        "/api/v1/payroll/statutory-rates/",
    ):
        assert client.get(url).status_code == 403, url


@pytest.mark.django_db
def test_the_payroll_capability_does_reach_it(company, hr_user, api_client):
    """The other direction, so the guard is a guard rather than a wall."""
    from accounts.models import PermissionGrant
    from accounts.policy import Perm

    hr_user.role = hr_user.Role.HR_OFFICER
    hr_user.save(update_fields=["role"])
    PermissionGrant.objects.filter(user=hr_user).delete()
    PermissionGrant.objects.create(user=hr_user, permission=Perm.PAYROLL_RUN)

    client = _as(company, hr_user)

    assert client.get("/api/v1/payroll/components/").status_code == 200
    assert client.get("/api/v1/payroll/statutory-rates/").status_code == 200
