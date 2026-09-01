"""The records a person has, rather than the fields they are.

Emergency contacts, dependants, nominees and qualifications are all lists — a
person has several, and the model had none of them. These tests are mostly
about **who may see them**, because the existence of somebody's next of kin is
itself information they did not agree to publish, and about the two places the
arithmetic or the ordering goes wrong quietly.
"""

from datetime import date

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from employees.models import Dependant, EducationRecord, EmergencyContact, Employee, Nominee

pytestmark = pytest.mark.django_db


def _client(company, user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _rows(response):
    """The list, whether or not the endpoint paginates."""
    if isinstance(response.data, dict):
        return response.data.get("results", [])
    return response.data


@pytest.fixture
def person(company, employee_user):
    yield Employee.objects.create(
        user=employee_user, employee_code="EMP-4001", date_joined=date(2026, 1, 1)
    )


@pytest.fixture
def colleague(company):
    user = User.objects.create_user(
        username="nosy", email="nosy@acme.com", password="x", role=User.Role.EMPLOYEE
    )
    yield Employee.objects.create(
        user=user, employee_code="EMP-4002", date_joined=date(2026, 1, 1)
    )


# ── Emergency contacts ───────────────────────────────────────────────────


def test_somebody_can_list_several_contacts(company, person, employee_user):
    """The first person is often unreachable exactly when they are needed."""
    client = _client(company, employee_user)
    first = client.post(
        "/api/v1/employees/emergency-contacts/",
        {"name": "Sita Rai", "relationship": "Spouse", "phone": "9800000000", "is_primary": True},
        format="json",
    )
    second = client.post(
        "/api/v1/employees/emergency-contacts/",
        {"name": "Ram Rai", "relationship": "Brother", "phone": "9811111111"},
        format="json",
    )

    assert first.status_code == 201, first.data
    assert second.status_code == 201
    assert EmergencyContact.objects.filter(employee=person).count() == 2


def test_only_one_contact_is_primary(company, person, employee_user):
    """🔒 Two people to call first is nobody to call first."""
    client = _client(company, employee_user)
    client.post(
        "/api/v1/employees/emergency-contacts/",
        {"name": "First", "relationship": "Spouse", "phone": "1", "is_primary": True},
        format="json",
    )
    client.post(
        "/api/v1/employees/emergency-contacts/",
        {"name": "Second", "relationship": "Parent", "phone": "2", "is_primary": True},
        format="json",
    )

    primaries = EmergencyContact.objects.filter(employee=person, is_primary=True)
    assert primaries.count() == 1
    assert primaries.first().name == "Second"


def test_the_primary_contact_can_still_be_deleted(company, person, employee_user):
    """Which is why one-primary is a service rule and not a unique constraint —
    a constraint would refuse the delete at exactly the wrong moment."""
    client = _client(company, employee_user)
    created = client.post(
        "/api/v1/employees/emergency-contacts/",
        {"name": "Only", "relationship": "Spouse", "phone": "1", "is_primary": True},
        format="json",
    )

    assert client.delete(f"/api/v1/employees/emergency-contacts/{created.data['id']}/").status_code == 204


# ── Who may look ─────────────────────────────────────────────────────────


def test_a_colleague_cannot_read_somebody_elses_contacts(company, person, employee_user, colleague):
    """🔒 The existence of somebody's next of kin is information they did not
    agree to publish. Empty rather than a refusal — a 403 confirms there is
    something there to be refused."""
    _client(company, employee_user).post(
        "/api/v1/employees/emergency-contacts/",
        {"name": "Private", "relationship": "Spouse", "phone": "1"},
        format="json",
    )

    response = _client(company, colleague.user).get(
        f"/api/v1/employees/emergency-contacts/?employee={person.pk}"
    )

    assert response.status_code == 200
    assert _rows(response) == []


def test_hr_can_read_them(company, person, employee_user, hr_user):
    """Somebody has to be able to make the call."""
    _client(company, employee_user).post(
        "/api/v1/employees/emergency-contacts/",
        {"name": "Sita", "relationship": "Spouse", "phone": "1"},
        format="json",
    )

    response = _client(company, hr_user).get(
        f"/api/v1/employees/emergency-contacts/?employee={person.pk}"
    )

    assert len(_rows(response)) == 1


def test_a_colleague_cannot_add_records_against_somebody_else(company, person, colleague):
    """Passing another employee's id must not plant a record on them."""
    _client(company, colleague.user).post(
        "/api/v1/employees/dependants/",
        {"employee": person.pk, "name": "Invented", "relationship": "Child"},
        format="json",
    )

    assert Dependant.objects.filter(employee=person).count() == 0


# ── Nominees ─────────────────────────────────────────────────────────────


def test_nomination_is_per_scheme(company, person, employee_user):
    """SSF, PF, CIT and gratuity are separate legal instruments. Somebody can
    name their spouse on one and their children on another."""
    client = _client(company, employee_user)
    for scheme in ("ssf", "pf"):
        response = client.post(
            "/api/v1/employees/nominees/",
            {
                "scheme": scheme,
                "name": f"{scheme} nominee",
                "relationship": "Spouse",
                "share_percent": "100",
            },
            format="json",
        )
        assert response.status_code == 201, response.data

    assert Nominee.objects.filter(employee=person).count() == 2


def test_shares_cannot_exceed_one_hundred_within_a_scheme(company, person, employee_user):
    """🔒 A nomination totalling 130% is one no fund will honour."""
    client = _client(company, employee_user)
    client.post(
        "/api/v1/employees/nominees/",
        {"scheme": "ssf", "name": "First", "relationship": "Spouse", "share_percent": "70"},
        format="json",
    )
    over = client.post(
        "/api/v1/employees/nominees/",
        {"scheme": "ssf", "name": "Second", "relationship": "Child", "share_percent": "40"},
        format="json",
    )

    assert over.status_code == 400
    assert "30" in str(over.data)


def test_a_half_finished_nomination_is_allowed(company, person, employee_user):
    """Refusing an incomplete list would mean nobody could enter the first of
    two nominees. Only over-allocation is refused."""
    response = _client(company, employee_user).post(
        "/api/v1/employees/nominees/",
        {"scheme": "ssf", "name": "Only so far", "relationship": "Spouse", "share_percent": "60"},
        format="json",
    )

    assert response.status_code == 201


def test_the_same_share_is_free_again_in_another_scheme(company, person, employee_user):
    """Per scheme means per scheme."""
    client = _client(company, employee_user)
    client.post(
        "/api/v1/employees/nominees/",
        {"scheme": "ssf", "name": "A", "relationship": "Spouse", "share_percent": "100"},
        format="json",
    )
    other = client.post(
        "/api/v1/employees/nominees/",
        {"scheme": "gratuity", "name": "B", "relationship": "Child", "share_percent": "100"},
        format="json",
    )

    assert other.status_code == 201


# ── Education ────────────────────────────────────────────────────────────


def test_a_qualification_starts_unverified(company, person, employee_user):
    """A degree somebody typed in and a degree HR has seen a certificate for
    are different facts."""
    response = _client(company, employee_user).post(
        "/api/v1/employees/education/",
        {"institution": "Tribhuvan University", "qualification": "BSc"},
        format="json",
    )

    assert response.status_code == 201
    assert response.data["is_verified"] is False


def test_only_hr_can_verify(company, person, employee_user):
    """🔒 Otherwise the person being verified sets their own verification."""
    created = _client(company, employee_user).post(
        "/api/v1/employees/education/",
        {"institution": "TU", "qualification": "BSc"},
        format="json",
    )
    refused = _client(company, employee_user).post(
        f"/api/v1/employees/education/{created.data['id']}/verify/"
    )

    assert refused.status_code == 403
    assert EducationRecord.objects.get(pk=created.data["id"]).verified_at is None


def test_hr_verifies_and_can_withdraw_it(company, person, employee_user, hr_user):
    """R2: a verification made in error must not stand forever."""
    created = _client(company, employee_user).post(
        "/api/v1/employees/education/",
        {"institution": "TU", "qualification": "BSc"},
        format="json",
    )
    hr = _client(company, hr_user)

    verified = hr.post(f"/api/v1/employees/education/{created.data['id']}/verify/")
    assert verified.data["is_verified"] is True
    assert verified.data["verified_by_name"]

    withdrawn = hr.post(f"/api/v1/employees/education/{created.data['id']}/unverify/")
    assert withdrawn.data["is_verified"] is False


def test_a_qualification_cannot_finish_before_it_starts(company, person, employee_user):
    response = _client(company, employee_user).post(
        "/api/v1/employees/education/",
        {"institution": "TU", "qualification": "BSc", "start_year": 2020, "end_year": 2018},
        format="json",
    )

    assert response.status_code == 400


# ── Dependants ───────────────────────────────────────────────────────────


def test_dependants_do_not_pretend_to_affect_tax(company, person, employee_user):
    """Nepal's income tax is not banded by dependants. A field that looks like
    it changes the payslip and does not is worse than no field — so this is
    recorded for insurance and next-of-kin, and nothing reads it for pay."""
    response = _client(company, employee_user).post(
        "/api/v1/employees/dependants/",
        {"name": "Child", "relationship": "Daughter", "is_covered_by_insurance": True},
        format="json",
    )

    assert response.status_code == 201
    assert Dependant.objects.get(employee=person).is_covered_by_insurance is True
