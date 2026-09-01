"""D23 — re-hiring a former employee.

**Settled 25 August: reactivate the same record and the same email.** A person
is not a new person. Requiring a second address would fork their history in two
— the old record holding their service, documents and past payslips, the new one
holding everything from now on — and neither would answer "how long have they
been here?".
"""

from datetime import date

import pytest

from employees.models import Employee, EmployeeLog
from employees.services import RehireError, rehire

pytestmark = pytest.mark.django_db

URL = "/api/v1/employees/employees/"


@pytest.fixture
def leaver(company, employee_user):
    yield Employee.objects.create(
        user=employee_user,
        employee_code="EMP-900",
        date_joined=date(2024, 1, 1),
        employment_status=Employee.EmploymentStatus.RESIGNED,
    )


def test_rehiring_reuses_the_record_and_the_login(company, leaver, admin_user):
    """🔒 The whole decision. Same record, same email, history intact."""
    from accounts.provisioning import revoke_access

    revoke_access(leaver.user)
    leaver.user.refresh_from_db()
    assert leaver.user.is_active is False

    rehire(leaver, actor=admin_user)

    leaver.refresh_from_db()
    leaver.user.refresh_from_db()
    assert leaver.employment_status == Employee.EmploymentStatus.ACTIVE
    # Active on paper and unable to sign in is the half-done state that
    # makes a rejoiner ring IT on their first morning.
    assert leaver.user.is_active is True
    # One person, one record.
    assert Employee.objects.filter(user=leaver.user).count() == 1


def test_the_return_is_written_to_the_history(company, leaver, admin_user):
    """A status change nobody can trace is one nobody can explain later."""
    rehire(leaver, actor=admin_user)

    log = EmployeeLog.objects.filter(
        employee=leaver, field=EmployeeLog.Field.EMPLOYMENT_STATUS
    ).latest("created_at")

    assert log.from_value == Employee.EmploymentStatus.RESIGNED
    assert log.to_value == Employee.EmploymentStatus.ACTIVE
    assert log.actor_id == admin_user.id


def test_the_join_date_can_be_reset_but_need_not_be(company, leaver, admin_user):
    """Leave accrual and probation both count from it, and a two-year gap is
    not service — but a resignation rescinded a week later keeps its original
    date, so this is optional rather than forced."""
    rehire(leaver, actor=admin_user)
    leaver.refresh_from_db()
    assert leaver.date_joined == date(2024, 1, 1)

    leaver.employment_status = Employee.EmploymentStatus.RESIGNED
    leaver.save(update_fields=["employment_status"])

    rehire(leaver, actor=admin_user, date_joined=date(2026, 8, 25))
    leaver.refresh_from_db()
    assert leaver.date_joined == date(2026, 8, 25)


def test_rehiring_somebody_who_never_left_is_refused(company, payroll_setup, admin_user):
    """Otherwise it is a silent no-op that reads as though it did something."""
    with pytest.raises(RehireError, match="already active"):
        rehire(payroll_setup["emp"], actor=admin_user)


def test_it_is_available_over_the_api_to_hr_only(company, leaver, admin_client, employee_client):
    refused = employee_client.post(f"{URL}{leaver.id}/rehire/", {}, format="json")
    assert refused.status_code == 403

    ok = admin_client.post(
        f"{URL}{leaver.id}/rehire/", {"date_joined": "2026-08-25"}, format="json"
    )
    assert ok.status_code == 200

    leaver.refresh_from_db()
    assert leaver.employment_status == Employee.EmploymentStatus.ACTIVE
    assert leaver.date_joined == date(2026, 8, 25)


def test_a_bad_date_is_refused_rather_than_ignored(company, leaver, admin_client):
    response = admin_client.post(
        f"{URL}{leaver.id}/rehire/", {"date_joined": "last-tuesday"}, format="json"
    )

    assert response.status_code == 400
