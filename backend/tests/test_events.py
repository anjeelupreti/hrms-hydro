"""Events: the timeline, the stakeholder list, and the attachments.

The property that matters most is the stakeholder list. Half the people at a
public hearing are not employees — a ward chair, a contractor's foreman, a
ministry official — and a model that can only name staff records four
colleagues and silently drops eleven others, which makes it worse than a sheet
of paper.
"""

from datetime import timedelta
from io import BytesIO

import pytest
from django.utils import timezone

from employees.models import Employee
from events.models import Event, EventStakeholder

pytestmark = pytest.mark.django_db

EVENTS = "/api/v1/events/events/"


@pytest.fixture
def hearing(db):
    return Event.objects.create(
        title="Public hearing, Uttargaya-4",
        kind=Event.Kind.PUBLIC,
        subject_matter="Access road alignment and compensation",
        starts_at=timezone.now() + timedelta(days=7),
    )


@pytest.fixture
def staff(db, employee_user, company):
    return Employee.objects.create(
        user=employee_user, employee_code="EMP-E1",
        date_joined=timezone.now().date(), primary_company=company,
    )


# ── The record ───────────────────────────────────────────────────────────


def test_an_event_is_created_with_its_subject_matter(admin_client):
    """A title is "Q3 Board Meeting"; the subject matter is what somebody
    searches for six months later."""
    response = admin_client.post(
        EVENTS,
        {
            "title": "Q3 Board Meeting",
            "kind": "board",
            "subject_matter": "Sanjen tailrace variation; FY83 capital plan",
            "starts_at": (timezone.now() + timedelta(days=3)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["kind_display"] == "Board meeting"


def test_an_event_cannot_end_before_it_starts(admin_client):
    start = timezone.now() + timedelta(days=3)
    response = admin_client.post(
        EVENTS,
        {
            "title": "Backwards",
            "starts_at": start.isoformat(),
            "ends_at": (start - timedelta(hours=2)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == 400
    assert "ends_at" in response.data


def test_search_reaches_the_subject_matter(admin_client, hearing):
    response = admin_client.get(f"{EVENTS}?search=compensation")

    assert [row["id"] for row in response.data["results"]] == [hearing.pk]


# ── The timeline ─────────────────────────────────────────────────────────


def test_the_timeline_reads_outward_from_now(admin_client, hearing):
    """Two lists rather than one sorted run: the next thing is at the top of
    one column and the most recent at the top of the other."""
    Event.objects.create(
        title="Last year's audit", kind=Event.Kind.INSPECTION,
        starts_at=timezone.now() - timedelta(days=200),
    )
    Event.objects.create(
        title="Yesterday's drill", kind=Event.Kind.DRILL,
        starts_at=timezone.now() - timedelta(days=1),
    )
    Event.objects.create(
        title="Next month", kind=Event.Kind.MEETING,
        starts_at=timezone.now() + timedelta(days=30),
    )

    response = admin_client.get(f"{EVENTS}timeline/")

    assert response.status_code == 200, response.data
    assert [e["title"] for e in response.data["upcoming"]] == [
        hearing.title, "Next month",
    ]
    assert [e["title"] for e in response.data["past"]] == [
        "Yesterday's drill", "Last year's audit",
    ]
    assert response.data["upcoming_total"] == 2
    assert response.data["past_total"] == 2


def test_past_and_upcoming_are_available_as_a_filter(admin_client, hearing):
    Event.objects.create(title="Done", starts_at=timezone.now() - timedelta(days=2))

    upcoming = admin_client.get(f"{EVENTS}?when=upcoming")
    past = admin_client.get(f"{EVENTS}?when=past")

    assert [e["title"] for e in upcoming.data["results"]] == [hearing.title]
    assert [e["title"] for e in past.data["results"]] == ["Done"]


def test_a_multi_day_event_is_not_past_on_its_first_evening(db):
    """Read from `ends_at` where there is one, so a two-day inspection does not
    move to "past" overnight."""
    event = Event.objects.create(
        title="Two-day inspection",
        starts_at=timezone.now() - timedelta(hours=6),
        ends_at=timezone.now() + timedelta(days=1),
    )

    assert event.is_past is False


# ── Stakeholders ─────────────────────────────────────────────────────────


def test_a_stakeholder_who_is_not_an_employee_is_recorded_in_full(admin_client, hearing):
    """The reason this is not a many-to-many to `Employee`."""
    response = admin_client.post(
        f"{EVENTS}{hearing.pk}/stakeholders/",
        {
            "name": "Kumar Tamang",
            "organisation": "Ward Chair, Uttargaya-4",
            "role": "chair",
            "phone": "9841000000",
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["employee"] is None
    assert response.data["employee_code"] == ""
    assert response.data["role_display"] == "Chair"


def test_picking_an_employee_fills_in_the_name_and_code(admin_client, hearing, staff):
    response = admin_client.post(
        f"{EVENTS}{hearing.pk}/stakeholders/",
        {"employee": staff.pk, "role": "speaker"},
        format="json",
    )

    assert response.status_code == 201, response.data
    row = EventStakeholder.objects.get(pk=response.data["id"])
    assert row.name == (staff.user.get_full_name() or staff.user.get_username())
    assert row.employee_code == "EMP-E1"


def test_a_typed_name_is_not_overwritten_by_the_employee_record(admin_client, hearing, staff):
    """Somebody who corrected a spelling, or recorded a professional name,
    meant it."""
    response = admin_client.post(
        f"{EVENTS}{hearing.pk}/stakeholders/",
        {"employee": staff.pk, "name": "Dr S. Rai"},
        format="json",
    )

    row = EventStakeholder.objects.get(pk=response.data["id"])
    assert row.name == "Dr S. Rai"


def test_a_stakeholder_row_needs_somebody_in_it(admin_client, hearing):
    """An empty line in an attendance record is worse than no line."""
    response = admin_client.post(
        f"{EVENTS}{hearing.pk}/stakeholders/", {"role": "guest"}, format="json"
    )

    assert response.status_code == 400
    assert "name" in response.data


def test_the_name_survives_the_employee_link_being_cleared(admin_client, hearing, staff):
    """A stakeholder list is a historical document."""
    created = admin_client.post(
        f"{EVENTS}{hearing.pk}/stakeholders/", {"employee": staff.pk}, format="json"
    )
    stakeholder_id = created.data["id"]

    admin_client.patch(
        f"{EVENTS}{hearing.pk}/stakeholders/{stakeholder_id}/",
        {"employee": None},
        format="json",
    )

    row = EventStakeholder.objects.get(pk=stakeholder_id)
    assert row.employee is None
    assert row.name != ""


def test_a_stakeholder_can_be_removed(admin_client, hearing):
    created = admin_client.post(
        f"{EVENTS}{hearing.pk}/stakeholders/", {"name": "Wrong person"}, format="json"
    )

    response = admin_client.delete(
        f"{EVENTS}{hearing.pk}/stakeholders/{created.data['id']}/"
    )

    assert response.status_code == 204
    assert hearing.stakeholders.count() == 0


def test_the_list_carries_a_stakeholder_count(admin_client, hearing):
    EventStakeholder.objects.create(event=hearing, name="One")
    EventStakeholder.objects.create(event=hearing, name="Two")

    response = admin_client.get(EVENTS)

    row = next(r for r in response.data["results"] if r["id"] == hearing.pk)
    assert row["stakeholder_count"] == 2


# ── Attachments ──────────────────────────────────────────────────────────


def _file(name="minutes.txt", body=b"Resolved unanimously."):
    handle = BytesIO(body)
    handle.name = name
    return handle


def test_an_event_takes_several_attachments(admin_client, hearing):
    """Minutes, an attendance sheet and a dozen photographs are all the same
    event and none of them is "the" document."""
    first = admin_client.post(
        f"{EVENTS}{hearing.pk}/attachments/",
        {"file": _file("minutes.txt"), "caption": "Minutes"},
        format="multipart",
    )
    second = admin_client.post(
        f"{EVENTS}{hearing.pk}/attachments/",
        {"file": _file("sheet.txt"), "caption": "Attendance sheet"},
        format="multipart",
    )

    assert first.status_code == 201, first.data
    assert second.status_code == 201, second.data
    assert hearing.attachments.count() == 2

    listing = admin_client.get(f"{EVENTS}{hearing.pk}/attachments/")
    assert [a["caption"] for a in listing.data] == ["Minutes", "Attendance sheet"]


def test_an_attachment_can_be_removed(admin_client, hearing):
    created = admin_client.post(
        f"{EVENTS}{hearing.pk}/attachments/",
        {"file": _file(), "caption": "Wrong file"},
        format="multipart",
    )

    response = admin_client.delete(
        f"{EVENTS}{hearing.pk}/attachments/{created.data['id']}/"
    )

    assert response.status_code == 204
    assert hearing.attachments.count() == 0


# ── Who may do what ──────────────────────────────────────────────────────


def test_anybody_signed_in_can_read_events(employee_client, hearing):
    """An event is a thing the company did, and the people who were at it are
    entitled to find it again."""
    response = employee_client.get(EVENTS)

    assert response.status_code == 200
    assert [e["id"] for e in response.data["results"]] == [hearing.pk]


def test_an_employee_cannot_create_one(employee_client):
    response = employee_client.post(
        EVENTS,
        {"title": "Mine", "starts_at": timezone.now().isoformat()},
        format="json",
    )

    assert response.status_code == 403


def test_an_officer_may_edit_an_event_but_not_open_or_delete_one(
    officer_client, officer_user, hearing
):
    from accounts.models import PermissionGrant
    from accounts.policy import Perm

    PermissionGrant.objects.get_or_create(user=officer_user, permission=Perm.WORKPLACE_MANAGE)

    edited = officer_client.patch(
        f"{EVENTS}{hearing.pk}/",
        {"outcome": "Alignment agreed; compensation deferred."},
        format="json",
    )
    assert edited.status_code == 200, edited.data

    created = officer_client.post(
        EVENTS, {"title": "New", "starts_at": timezone.now().isoformat()}, format="json"
    )
    assert created.status_code == 403

    removed = officer_client.delete(f"{EVENTS}{hearing.pk}/")
    assert removed.status_code == 403
