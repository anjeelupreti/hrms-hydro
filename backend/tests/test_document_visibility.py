"""Who can read a personal document.

The design has one deliberate asymmetry worth stating up front: an employee
chooses who sees their documents, **except** that HR keeps access to statutory
ones. A citizenship scan and a bank letter are what filing and paying somebody
require, so hiding them from HR would either break payroll or make the setting a
lie — and a privacy control that silently does not apply is worse than not
offering one. The trade is that HR's access is *logged and shown to the owner*.

These tests pin both halves: the employee's choice is honoured where it can be,
and the exception is exactly as narrow as claimed.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import User
from documents.models import DocumentAccessLog, RepositoryDocument
from employees.models import Employee

pytestmark = pytest.mark.django_db


# Local fixtures: conftest's `employee_user` is a bare User with no Employee,
# and these tests need a reporting line — an owner, their manager, and an
# unrelated peer — to tell "shared upward" from "shared with everyone".


def _employee(company, username, *, manager=None, code=None):
    user = User.objects.create(
        username=username, email=f"{username}@acme.localhost", role=User.Role.EMPLOYEE
    )
    user.set_password("x")
    user.save()
    return Employee.objects.create(
        user=user,
        employee_code=code or f"EMP-{username[:6].upper()}",
        date_joined="2024-01-01",
        manager=manager,
    )


def _client_for(company, employee):
    client = APIClient()
    client.force_authenticate(user=employee.user)
    return client


@pytest.fixture
def manager(company):
    return _employee(company, "boss", code="EMP-BOSS")


@pytest.fixture
def owner(company, manager):
    """The employee whose documents these tests are about."""
    return _employee(company, "owner", manager=manager, code="EMP-OWNER")


@pytest.fixture
def peer(company):
    """An unrelated colleague — not the owner, not their manager."""
    return _employee(company, "peer", code="EMP-PEER")


@pytest.fixture
def owner_client(company, owner):
    return _client_for(company, owner)


@pytest.fixture
def manager_client(company, manager):
    return _client_for(company, manager)


@pytest.fixture
def peer_client(company, peer):
    return _client_for(company, peer)


def _doc(employee, visibility, *, statutory=False, title="Doc"):
    return RepositoryDocument.objects.create(
        title=title,
        category=RepositoryDocument.Category.PERSONAL,
        visibility=visibility,
        employee=employee,
        is_statutory=statutory,
        file=SimpleUploadedFile(f"{title}.txt", b"contents"),
        original_filename=f"{title}.txt",
    )


def _visible_ids(client):
    response = client.get("/api/v1/documents/repository/")
    rows = response.data["results"] if isinstance(response.data, dict) else response.data
    return {row["id"] for row in rows}


# ── The employee's choice is honoured ────────────────────────────────────


def test_a_private_document_is_hidden_from_hr(company, owner, hr_client):
    """The whole point of offering the setting.

    If HR saw everything regardless, "only me" would be a label rather than a
    rule, and offering it would be worse than not.
    """
    doc = _doc(owner, RepositoryDocument.Visibility.PRIVATE)
    assert doc.id not in _visible_ids(hr_client)


def test_the_owner_always_sees_their_own_document(company, owner, owner_client):
    doc = _doc(owner, RepositoryDocument.Visibility.PRIVATE)
    assert doc.id in _visible_ids(owner_client)


def test_hr_only_is_visible_to_hr_and_not_to_a_colleague(
    company, owner, hr_client, peer_client
):
    doc = _doc(owner, RepositoryDocument.Visibility.HR_ONLY)
    assert doc.id in _visible_ids(hr_client)
    assert doc.id not in _visible_ids(peer_client)


def test_manager_visibility_reaches_the_manager_and_stops_there(
    company, owner, manager_client, peer_client
):
    """Shared *up the line*, not sideways. A peer is not a manager."""
    doc = _doc(owner, RepositoryDocument.Visibility.MANAGER)
    assert doc.id in _visible_ids(manager_client)
    assert doc.id not in _visible_ids(peer_client)


def test_a_manager_does_not_see_a_private_document_of_a_report(
    company, owner, manager_client
):
    """Being someone's manager is not a general entitlement to their files."""
    doc = _doc(owner, RepositoryDocument.Visibility.PRIVATE)
    assert doc.id not in _visible_ids(manager_client)


# ── The exception, and its exact width ───────────────────────────────────


def test_hr_sees_a_statutory_document_even_when_marked_private(
    company, owner, hr_client
):
    """The honest limit. A citizenship scan is what filing requires, so the
    employee cannot withhold it from HR — but see the access-log test."""
    doc = _doc(
        owner, RepositoryDocument.Visibility.PRIVATE, statutory=True
    )
    assert doc.id in _visible_ids(hr_client)


def test_statutory_does_not_open_the_document_to_colleagues(
    company, owner, peer_client
):
    """The exception is for HR, not a general override.

    A guard that widens to everybody is not an exception, it is a hole.
    """
    doc = _doc(
        owner, RepositoryDocument.Visibility.PRIVATE, statutory=True
    )
    assert doc.id not in _visible_ids(peer_client)


def test_an_employee_cannot_mark_their_own_upload_statutory(
    company, owner, owner_client
):
    """`is_statutory` is what makes HR access non-revocable, so it must not be
    self-assignable — in either direction."""
    response = owner_client.post(
        "/api/v1/documents/repository/",
        {
            "title": "Mine",
            "category": "personal",
            "visibility": "private",
            "employee": owner.id,
            "is_statutory": True,
            "file": SimpleUploadedFile("mine.txt", b"x"),
        },
        format="multipart",
    )
    assert response.status_code == 201
    assert RepositoryDocument.objects.get(pk=response.data["id"]).is_statutory is False


# ── The list and the file must agree ─────────────────────────────────────


def test_a_hidden_document_cannot_be_downloaded_by_url(
    company, owner, peer_client
):
    """A document hidden from the list but fetchable by URL is not hidden.

    The rules are written twice — as a queryset filter and as `readable_by` —
    so this is the test that they say the same thing.
    """
    doc = _doc(owner, RepositoryDocument.Visibility.PRIVATE)
    response = peer_client.get(
        f"/api/v1/documents/repository/{doc.id}/download/"
    )
    assert response.status_code == 404


# ── Access that cannot be withdrawn is at least visible ──────────────────


def test_hr_reading_a_statutory_document_is_logged_for_the_owner(
    company, owner, hr_client, owner_client
):
    """The other half of the bargain.

    HR's access to a statutory document is not the employee's to revoke, so the
    least it owes them is knowing it happened.
    """
    doc = _doc(
        owner, RepositoryDocument.Visibility.PRIVATE, statutory=True
    )
    hr_client.get(f"/api/v1/documents/repository/{doc.id}/download/")

    assert DocumentAccessLog.objects.filter(document=doc).count() == 1
    log = owner_client.get(f"/api/v1/documents/repository/{doc.id}/access-log/")

    assert log.status_code == 200
    assert log.data[0]["reason"] == "statutory"


def test_reading_your_own_document_is_not_logged(company, owner, owner_client):
    """A log full of "you opened your own payslip" buries the entry that
    matters, which is somebody else opening it."""
    doc = _doc(owner, RepositoryDocument.Visibility.PRIVATE)
    owner_client.get(f"/api/v1/documents/repository/{doc.id}/download/")
    assert DocumentAccessLog.objects.filter(document=doc).count() == 0


def test_a_colleague_cannot_read_the_access_log(
    company, owner, peer_client
):
    doc = _doc(owner, RepositoryDocument.Visibility.COMPANY)
    response = peer_client.get(
        f"/api/v1/documents/repository/{doc.id}/access-log/"
    )
    assert response.status_code in (403, 404)


# ── Changing the setting ─────────────────────────────────────────────────


def test_the_owner_can_change_visibility(company, owner, owner_client, hr_client):
    doc = _doc(owner, RepositoryDocument.Visibility.PRIVATE)
    assert doc.id not in _visible_ids(hr_client)

    response = owner_client.post(
        f"/api/v1/documents/repository/{doc.id}/set-visibility/",
        {"visibility": "hr_only"},
        format="json",
    )
    assert response.status_code == 200
    assert doc.id in _visible_ids(hr_client)


def test_an_employee_cannot_publish_company_wide(company, owner, owner_client):
    """Broadcasting to the whole company is not a personal filing decision."""
    doc = _doc(owner, RepositoryDocument.Visibility.PRIVATE)
    response = owner_client.post(
        f"/api/v1/documents/repository/{doc.id}/set-visibility/",
        {"visibility": "company"},
        format="json",
    )
    assert response.status_code == 403


def test_a_colleague_cannot_change_someone_elses_visibility(
    company, owner, peer_client
):
    doc = _doc(owner, RepositoryDocument.Visibility.COMPANY)
    response = peer_client.post(
        f"/api/v1/documents/repository/{doc.id}/set-visibility/",
        {"visibility": "private"},
        format="json",
    )
    assert response.status_code in (403, 404)


# ── The same rule, applied to the employee record itself ─────────────────
#
# Document visibility would be pointless if the directory endpoint published
# everyone's PAN and citizenship number anyway. Same leak, different door.


def _employee_row(client, employee_id):
    response = client.get(f"/api/v1/employees/employees/{employee_id}/")
    return response.data


def test_a_colleague_cannot_read_statutory_identity_fields(company, owner, peer_client):
    """PAN, citizenship and bank details are not directory information."""
    owner.pan_number = "PAN-123456"
    owner.citizenship_number = "CIT-99"
    owner.bank_account_number = "1234567890"
    owner.save(update_fields=["pan_number", "citizenship_number", "bank_account_number"])

    row = _employee_row(peer_client, owner.id)

    assert "pan_number" not in row
    assert "citizenship_number" not in row
    assert "bank_account_number" not in row
    # The directory still works — this is a redaction, not a 403.
    assert row["employee_code"] == owner.employee_code


def test_the_owner_and_hr_can_read_them(company, owner, owner_client, hr_client):
    owner.pan_number = "PAN-123456"
    owner.save(update_fields=["pan_number"])

    own_row = _employee_row(owner_client, owner.id)
    hr_row = _employee_row(hr_client, owner.id)

    assert own_row["pan_number"] == "PAN-123456"
    assert hr_row["pan_number"] == "PAN-123456"


def test_the_account_number_is_masked_even_for_those_allowed_to_see_it(
    company, owner, hr_client
):
    """A full account number is needed to build a payment file — a server-side
    job. Nobody needs it rendered in a browser, and a shoulder-surfed
    screenshot is a real way these leak.
    """
    owner.bank_account_number = "1234567890"
    owner.save(update_fields=["bank_account_number"])
    row = _employee_row(hr_client, owner.id)

    assert row["bank_account_number"] == "****7890"
