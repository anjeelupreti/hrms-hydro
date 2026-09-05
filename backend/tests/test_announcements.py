"""Announcements: who they reach, and who has actually read them.

**Two things changed here and both are about reach.** Anybody may post one now
— the lift being out is not HR's to know about — but addressing the whole
company stays with whoever manages the workplace. And a notice can ask to be
acknowledged, which is a different fact from having been opened.
"""

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import Department, Employee
from notifications.models import Announcement, AnnouncementReceipt

pytestmark = pytest.mark.django_db

LIST = "/api/v1/notifications/announcements/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _person(username, code, company, department=None):
    User = get_user_model()
    user = User.objects.create_user(username=username, email=f"{username}@x.test", password="x")
    return Employee.objects.create(
        user=user,
        employee_code=code,
        date_joined=timezone.now().date(),
        primary_company=company,
        department=department,
    )


@pytest.fixture
def works(db, company):
    return Department.objects.create(name="Works")


@pytest.fixture
def cast(db, company, works):
    return {
        "author": _person("a_author", "ANN-1", company, works),
        "colleague": _person("a_colleague", "ANN-2", company, works),
        "elsewhere": _person("a_elsewhere", "ANN-3", company),
    }


# ── Who may post, and to whom ────────────────────────────────────────────


def test_anybody_can_tell_their_own_department_something(cast, works):
    """It was HR-only, which made the one way to tell a hundred people
    something a request to HR — and the lift being out is not HR's to know
    about."""
    response = _client(cast["author"].user).post(
        LIST,
        {"title": "Lift out of service", "body": "Use the stairs.", "department": works.pk},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["department"] == works.pk


def test_anybody_can_tell_a_named_list_of_people(cast):
    """A department is the wrong shape for the four people running a shutdown,
    who are in four different departments."""
    response = _client(cast["author"].user).post(
        LIST,
        {
            "title": "Shutdown briefing moved",
            "body": "Now 7am.",
            "recipients": [cast["colleague"].pk, cast["elsewhere"].pk],
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert set(response.data["recipients"]) == {cast["colleague"].pk, cast["elsewhere"].pk}


def test_addressing_the_whole_company_is_not_everybodys_to_send(cast):
    """A different act, and one that cannot be taken back once a hundred
    notifications have gone out."""
    response = _client(cast["author"].user).post(
        LIST, {"title": "Everybody read this", "body": "..."}, format="json"
    )

    assert response.status_code == 400, response.data
    assert "whole company" in str(response.data)


def test_somebody_who_manages_the_workplace_still_can(cast, hr_user):
    response = _client(hr_user).post(
        LIST, {"title": "Office closed Friday", "body": "Public holiday."}, format="json"
    )

    assert response.status_code == 201, response.data


# ── Reading it, and saying so ────────────────────────────────────────────


@pytest.fixture
def notice(db, cast, works):
    return Announcement.objects.create(
        title="Hot work permits",
        body="New procedure from Monday.",
        department=works,
        require_acknowledgement=True,
        created_by=cast["author"].user,
        updated_by=cast["author"].user,
    )


def test_opening_and_acknowledging_are_different_facts(notice, cast):
    """A rendered page is not somebody having taken a safety instruction in."""
    client = _client(cast["colleague"].user)

    client.post(f"{LIST}{notice.pk}/seen/", {}, format="json")
    row = AnnouncementReceipt.objects.get(announcement=notice, employee=cast["colleague"])
    assert row.seen_at is not None
    assert row.acknowledged_at is None

    client.post(f"{LIST}{notice.pk}/acknowledge/", {}, format="json")
    row.refresh_from_db()
    assert row.acknowledged_at is not None


def test_acknowledging_without_opening_still_records_both(notice, cast):
    """Acknowledging something you never opened is not a state worth
    representing."""
    _client(cast["colleague"].user).post(f"{LIST}{notice.pk}/acknowledge/", {}, format="json")

    row = AnnouncementReceipt.objects.get(announcement=notice, employee=cast["colleague"])
    assert row.seen_at is not None and row.acknowledged_at is not None


def test_the_first_read_is_the_one_that_is_kept(notice, cast):
    """Re-recording it on every page load would turn the timestamp into "when
    they last looked", which answers nothing."""
    client = _client(cast["colleague"].user)
    client.post(f"{LIST}{notice.pk}/seen/", {}, format="json")
    first = AnnouncementReceipt.objects.get(announcement=notice, employee=cast["colleague"]).seen_at

    client.post(f"{LIST}{notice.pk}/seen/", {}, format="json")

    again = AnnouncementReceipt.objects.get(
        announcement=notice, employee=cast["colleague"]
    ).seen_at
    assert again == first


# ── What the author can see ──────────────────────────────────────────────


def test_the_metrics_count_against_everybody_it_was_addressed_to(notice, cast):
    """Counting only the people who happened to open it would make every
    announcement look fully read."""
    _client(cast["colleague"].user).post(f"{LIST}{notice.pk}/acknowledge/", {}, format="json")

    data = _client(cast["author"].user).get(f"{LIST}{notice.pk}/").data

    # The Works department: the author and the colleague.
    assert data["metrics"]["audience"] == 2
    assert data["metrics"]["seen"] == 1
    assert data["metrics"]["acknowledged"] == 1


def test_the_author_can_see_who_has_not_read_it(notice, cast):
    _client(cast["colleague"].user).post(f"{LIST}{notice.pk}/seen/", {}, format="json")

    rows = _client(cast["author"].user).get(f"{LIST}{notice.pk}/receipts/").data

    by_person = {r["employee"]: r for r in rows}
    assert by_person[cast["colleague"].pk]["seen_at"] is not None
    assert by_person[cast["author"].pk]["seen_at"] is None
    # Unread first — the list exists to be acted on.
    assert rows[0]["seen_at"] is None


def test_the_names_are_the_authors_alone(notice, cast):
    """The counts are a fact about the notice; a list of who has not read it
    is a fact about people."""
    response = _client(cast["colleague"].user).get(f"{LIST}{notice.pk}/receipts/")

    assert response.status_code == 403, response.data


def test_an_announcement_is_edited_by_whoever_wrote_it(notice, cast):
    edited = _client(cast["author"].user).patch(
        f"{LIST}{notice.pk}/", {"title": "Hot work permits — revised"}, format="json"
    )
    assert edited.status_code == 200, edited.data

    refused = _client(cast["colleague"].user).patch(
        f"{LIST}{notice.pk}/", {"title": "Mine now"}, format="json"
    )
    assert refused.status_code == 403, refused.data
