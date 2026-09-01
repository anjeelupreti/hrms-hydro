"""The attendance policy, reachable.

The model and the enforcement shipped without any way to set them, which is the
same as not shipping them: the company who bought readers so people cannot clock
each other in still had web check-in on and no screen to turn it off.

These tests are mostly about **who may change it** and **what a change actually
does**, because a settings screen that saves nothing looks identical to one that
works until somebody checks the punch record.
"""

import pytest
from rest_framework.test import APIClient

from attendance.models import AttendanceLog
from attendance.policy import AttendancePolicy, allows

pytestmark = pytest.mark.django_db

POLICY_URL = "/api/v1/attendance/policy/"


def _client(company, user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_the_policy_exists_on_first_visit(company, hr_user):
    """"Not configured" and "everything permitted" are the same state, so the
    row is materialised rather than 404'd at somebody who came to change it."""
    response = _client(company, hr_user).get(POLICY_URL)

    assert response.status_code == 200
    assert response.data["allow_web"] is True
    assert response.data["allow_biometric"] is True


def test_turning_web_off_actually_refuses_a_web_punch(company, hr_user, employee_user):
    """The whole point. A screen that saves a value nothing reads looks
    identical to one that works."""
    from datetime import date

    from employees.models import Employee

    person = Employee.objects.create(
        user=employee_user, employee_code="EMP-6001", date_joined=date(2026, 1, 1)
    )

    response = _client(company, hr_user).patch(POLICY_URL, {"allow_web": False}, format="json")
    assert response.status_code == 200

    assert allows(AttendanceLog.Source.WEB, employee=person) is False

    punch = _client(company, employee_user).post("/api/v1/attendance/logs/check-in/")
    assert punch.status_code == 403


def test_the_response_says_what_is_permitted(company, hr_user):
    """So the screen can show the effect of the toggles without knowing the
    source names itself."""
    client = _client(company, hr_user)
    client.patch(POLICY_URL, {"allow_web": False}, format="json")
    response = client.get(POLICY_URL)

    assert response.data["permitted_sources"] == [AttendanceLog.Source.BIOMETRIC]


def test_an_employee_cannot_change_how_the_company_clocks_in(company, employee_user):
    """🔒 Otherwise anybody refused a web punch can simply permit themselves."""
    response = _client(company, employee_user).patch(
        POLICY_URL, {"allow_web": True}, format="json"
    )

    assert response.status_code == 403


def test_an_employee_cannot_even_read_the_policy(company, employee_user):
    """Gated in both directions — it is a configuration surface, not a fact
    about their own record."""
    assert _client(company, employee_user).get(POLICY_URL).status_code == 403


# ── Exceptions ───────────────────────────────────────────────────────────


def test_an_exception_can_be_added_and_takes_effect(company, hr_user, employee_user):
    """The factory floor and the field team — one company rule cannot serve
    both, which is why the override exists at all."""
    from datetime import date

    from employees.models import Employee

    person = Employee.objects.create(
        user=employee_user, employee_code="EMP-6002", date_joined=date(2026, 1, 1)
    )
    AttendancePolicy.objects.create(allow_web=False, allow_biometric=True)

    response = _client(company, hr_user).post(
        "/api/v1/attendance/attendance-methods/",
        {"employee": person.id, "allow_web": True, "note": "Field sales — no reader on site"},
        format="json",
    )
    assert response.status_code == 201

    assert allows(AttendanceLog.Source.WEB, employee=person) is True


def test_an_exception_can_be_taken_back(company, hr_user, employee_user):
    """R2: anything you can add, you must be able to remove."""
    from datetime import date

    from employees.models import Employee

    person = Employee.objects.create(
        user=employee_user, employee_code="EMP-6003", date_joined=date(2026, 1, 1)
    )
    AttendancePolicy.objects.create(allow_web=False)

    client = _client(company, hr_user)
    created = client.post(
        "/api/v1/attendance/attendance-methods/",
        {"employee": person.id, "allow_web": True},
        format="json",
    )
    removed = client.delete(f"/api/v1/attendance/attendance-methods/{created.data['id']}/")

    assert removed.status_code == 204
    assert allows(AttendanceLog.Source.WEB, employee=person) is False


def test_no_opinion_is_stored_as_no_opinion(company, hr_user, employee_user):
    """`null` and `false` are different answers, and the API has to keep them
    apart or the tri-state on the screen is a lie."""
    from datetime import date

    from employees.models import Employee

    person = Employee.objects.create(
        user=employee_user, employee_code="EMP-6004", date_joined=date(2026, 1, 1)
    )

    response = _client(company, hr_user).post(
        "/api/v1/attendance/attendance-methods/",
        {"employee": person.id, "allow_web": None, "allow_biometric": False},
        format="json",
    )

    assert response.status_code == 201
    assert response.data["allow_web"] is None
    assert response.data["allow_biometric"] is False
