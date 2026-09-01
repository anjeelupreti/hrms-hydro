"""The one-line reading above a list, and what it is allowed to claim.

These endpoints exist because filter chips answer "how many are open" and
nothing answers the question a desk is actually judged on — *is anything
rotting, and does everything have an owner*. A number printed in large type at
the top of a page is believed without checking, so each one here is pinned to a
scenario where the right answer is known and a plausible mistake gives a
different one.

The recurring failure they guard against is counting the wrong population:
resolved tickets left in an "unresolved" figure, a late ticket that was
answered still counted as breaching, archived projects dragging a portfolio's
completion down forever.
"""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from accounts.models import User
from assets.models import Asset, AssetPhoto
from crm.models import Client, ClientTicket
from employees.models import Department, Designation, Employee
from helpdesk.models import Ticket
from projects.models import Project, ProjectTask

pytestmark = pytest.mark.django_db


@pytest.fixture
def employee(company):
    """A requester, so tickets have somebody to have been raised by."""
    user = User.objects.create_user(
        username="reader",
        email="reader@t.test",
        password="pw",
        role=User.Role.EMPLOYEE,
        first_name="Read",
        last_name="Er",
    )
    return Employee.objects.create(
        user=user,
        employee_code="EMP-RDR",
        date_joined=date(2026, 1, 1),
        department=Department.objects.create(name="Reading", code="RDG"),
        designation=Designation.objects.create(title="Reader"),
    )


# ── The internal queue ────────────────────────────────────────────────────


def test_the_queue_reading_ignores_what_is_already_finished(hr_client, company, employee):
    """Resolved and closed are not "waiting". Counting them would make a desk
    that answers everything look worse the harder it works."""
    Ticket.objects.create(subject="Printer", status=Ticket.Status.OPEN, requester=employee)
    Ticket.objects.create(subject="VPN", status=Ticket.Status.IN_PROGRESS, requester=employee)
    Ticket.objects.create(subject="Chair", status=Ticket.Status.RESOLVED, requester=employee)
    Ticket.objects.create(subject="Badge", status=Ticket.Status.CLOSED, requester=employee)

    data = hr_client.get("/api/v1/helpdesk/tickets/queue-summary/").data

    assert data["unresolved"] == 2


def test_the_oldest_wait_is_measured_from_the_oldest_unresolved(hr_client, company, employee):
    """A resolved ticket from last month must not be reported as a month's wait."""
    stale = Ticket.objects.create(
        subject="Old and done", status=Ticket.Status.RESOLVED, requester=employee
    )
    Ticket.objects.filter(pk=stale.pk).update(created_at=timezone.now() - timedelta(days=30))

    fresh = Ticket.objects.create(
        subject="Still open", status=Ticket.Status.OPEN, requester=employee
    )
    Ticket.objects.filter(pk=fresh.pk).update(created_at=timezone.now() - timedelta(days=3))

    data = hr_client.get("/api/v1/helpdesk/tickets/queue-summary/").data

    assert data["oldest_open_days"] == 3, "measured the resolved one"


def test_an_empty_queue_reports_no_wait_rather_than_zero(hr_client, company):
    """`None`, not `0`. "0 days waiting" reads as *something is waiting, briefly*,
    which is a different fact from *nothing is waiting*."""
    data = hr_client.get("/api/v1/helpdesk/tickets/queue-summary/").data

    assert data["unresolved"] == 0
    assert data["oldest_open_days"] is None


# ── The client desk ───────────────────────────────────────────────────────


@pytest.fixture
def client_record(company):
    yield Client.objects.create(name="Butwal Municipality")


def _ticket(client_record, reference, **kwargs):
    return ClientTicket.objects.create(
        client=client_record, reference=reference, subject="Outage", **kwargs
    )


def test_a_breach_needs_both_no_reply_and_a_passed_deadline(hr_client, company, client_record):
    """Two tickets are late-looking and only one is a breach: the other was
    answered before its deadline and merely still open."""
    now = timezone.now()
    _ticket(
        client_record,
        "CT-1",
        status="open",
        response_due_at=now - timedelta(hours=2),
        first_response_at=None,
    )
    _ticket(
        client_record,
        "CT-2",
        status="open",
        response_due_at=now - timedelta(hours=2),
        first_response_at=now - timedelta(hours=3),
    )

    data = hr_client.get("/api/v1/crm/tickets/desk-summary/").data

    assert data["live"] == 2
    assert data["response_breaches"] == 1, "counted a ticket that was answered in time"
    assert data["awaiting_first_reply"] == 1


def test_a_ticket_with_no_deadline_can_never_breach(hr_client, company, client_record):
    """Targets are snapshotted at creation, and older rows have none. A null
    due time means no promise was made, not a promise broken."""
    _ticket(client_record, "CT-3", status="open", response_due_at=None)

    data = hr_client.get("/api/v1/crm/tickets/desk-summary/").data

    assert data["response_breaches"] == 0
    assert data["resolution_breaches"] == 0


def test_closed_tickets_leave_the_reading(hr_client, company, client_record):
    """A desk that fixed a late ticket has no live breach — otherwise the figure
    only ever rises and nobody can clear it."""
    now = timezone.now()
    _ticket(
        client_record,
        "CT-4",
        status="resolved",
        response_due_at=now - timedelta(days=1),
        resolution_due_at=now - timedelta(days=1),
    )

    data = hr_client.get("/api/v1/crm/tickets/desk-summary/").data

    assert data["live"] == 0
    assert data["response_breaches"] == 0
    assert data["resolution_breaches"] == 0


def test_the_desk_counts_every_state_the_flow_defines(hr_client, company, client_record):
    """The buckets come from `TICKET_FLOW`, not from field choices.

    `StatusCountsMixin` normally reads them off the column's `choices`, and this
    model has none on purpose — the legal states and the moves between them live
    in the flow. Without the override every bucket is missing and the desk
    cannot say how many tickets are open.
    """
    _ticket(client_record, "CT-5", status="open")
    _ticket(client_record, "CT-6", status="waiting")

    data = hr_client.get("/api/v1/crm/tickets/status-counts/").data

    assert data["open"] == 1
    assert data["waiting"] == 1
    assert data["resolved"] == 0, "an absent bucket reads as unknown, not as zero"


# ── The portfolio ─────────────────────────────────────────────────────────


def test_the_portfolio_counts_tasks_not_projects(hr_client, company):
    """"Active" is a label somebody set once; completion lives at task level."""
    project = Project.objects.create(name="Penstock", status=Project.Status.ACTIVE)
    ProjectTask.objects.create(project=project, title="A", status=ProjectTask.Status.DONE)
    ProjectTask.objects.create(project=project, title="B", status=ProjectTask.Status.BLOCKED)
    ProjectTask.objects.create(project=project, title="C")

    data = hr_client.get("/api/v1/projects/projects/portfolio-summary/").data

    assert data["projects_total"] == 1
    assert data["tasks_total"] == 3
    assert data["tasks_done"] == 1
    assert data["tasks_blocked"] == 1


def test_an_archived_project_leaves_the_portfolio(hr_client, company):
    """The archive exists so finished work stops distorting today's picture. A
    reading that counted last year's projects would report a health nobody is
    responsible for any more."""
    live = Project.objects.create(name="Live", status=Project.Status.ACTIVE)
    ProjectTask.objects.create(project=live, title="Open work")

    old = Project.objects.create(name="Old", status=Project.Status.ACTIVE)
    ProjectTask.objects.create(project=old, title="Ancient", status=ProjectTask.Status.BLOCKED)
    Project.objects.filter(pk=old.pk).update(archived_at=timezone.now())

    data = hr_client.get("/api/v1/projects/projects/portfolio-summary/").data

    assert data["projects_total"] == 1
    assert data["tasks_total"] == 1
    assert data["tasks_blocked"] == 0, "an archived project's blockage is nobody's problem"


def test_a_late_task_that_got_finished_is_not_overdue(hr_client, company):
    """Overdue means unfinished *and* past its date. Delivered late is done."""
    yesterday = date.today() - timedelta(days=1)
    project = Project.objects.create(name="Spillway", status=Project.Status.ACTIVE)
    ProjectTask.objects.create(
        project=project, title="Late but done", due_date=yesterday,
        status=ProjectTask.Status.DONE,
    )
    ProjectTask.objects.create(project=project, title="Late and open", due_date=yesterday)

    data = hr_client.get("/api/v1/projects/projects/portfolio-summary/").data

    assert data["tasks_overdue"] == 1


# ── Asset photographs ─────────────────────────────────────────────────────


@pytest.fixture
def laptop(company):
    yield Asset.objects.create(name="ThinkPad", asset_tag="VLU-LT-001")


def _image():
    """A one-pixel PNG. Django's `ImageField` verifies the bytes with Pillow, so
    a file of the word "test" is rejected before any of this is reached."""
    import base64

    from django.core.files.uploadedfile import SimpleUploadedFile

    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    return SimpleUploadedFile("lid.png", png, content_type="image/png")


def test_a_photo_is_served_through_the_gated_media_path(hr_client, company, laptop):
    """Never `image.url`. Media is gated on the caller's schema and the app
    proxies it so the session travels with the request; a storage URL would
    either 404 or, worse, work without a check."""
    response = hr_client.post(
        "/api/v1/assets/photos/",
        {"asset": laptop.pk, "image": _image(), "caption": "Scratch at handover"},
        format="multipart",
    )

    assert response.status_code == 201, response.data
    assert response.data["image_url"].startswith("/media/assets/")


def test_the_holder_of_an_asset_cannot_edit_its_photographs(employee_client, company, laptop):
    """The pictures are evidence about company property. Letting whoever holds
    the laptop add to or withdraw from its record defeats the reason they are
    taken."""
    response = employee_client.post(
        "/api/v1/assets/photos/", {"asset": laptop.pk, "image": _image()}, format="multipart"
    )

    assert response.status_code == 403


def test_the_list_row_carries_a_cover_without_a_request_each(hr_client, company, laptop):
    """The asset list shows a thumbnail per row, and it has to come from the
    list's own response — a request per asset is what the prefetch exists to
    avoid."""
    AssetPhoto.objects.create(asset=laptop, image="assets/x/photos/1/lid.png")

    row = next(
        r for r in hr_client.get("/api/v1/assets/assets/").data["results"] if r["id"] == laptop.pk
    )

    assert row["photo_count"] == 1
    assert row["cover_url"] == "/media/assets/x/photos/1/lid.png"


def test_deleting_an_asset_takes_its_photographs(company, laptop):
    """CASCADE, unlike the assignment history: a photograph of a machine that no
    longer exists is not a record of anything."""
    AssetPhoto.objects.create(asset=laptop, image="assets/x/photos/1/lid.png")
    laptop.delete()

    assert AssetPhoto.objects.count() == 0


# ── The timesheet week ────────────────────────────────────────────────────


def test_the_week_reports_the_days_with_nothing_on_them(hr_client, company):
    """The whole reason the endpoint exists: seven days come back, not just the
    ones somebody logged against."""
    data = hr_client.get("/api/v1/timesheets/entries/week/?start=2026-08-23").data

    assert len(data["days"]) == 7
    assert data["days"][0]["date"] == "2026-08-23"
    assert data["days"][6]["date"] == "2026-08-29"


def test_the_week_starts_on_sunday(hr_client, company):
    """**Deliberate, and the opposite of the ISO default.**

    Nepal works Sunday to Friday with Saturday off. A Monday anchor would open
    the week on Monday and push Sunday — a working day — past the weekend, so
    the six days somebody actually works would land on two different screens.
    Every day of the week must resolve to the same Sunday.
    """
    from datetime import date

    from timesheets.viewsets import _week_start

    for day in (date(2026, 8, 23), date(2026, 8, 24), date(2026, 8, 27), date(2026, 8, 29)):
        assert _week_start(day) == date(2026, 8, 23), day

    # And through the endpoint, where a request with no `start` falls back to it.
    data = hr_client.get("/api/v1/timesheets/entries/week/").data

    assert date.fromisoformat(data["start"]).isoweekday() == 7, "the fallback week is not a Sunday"


def test_a_saturday_with_nothing_on_it_is_not_a_gap(hr_client, company):
    """Saturday is the weekend here. Marking it missing would put a warning on
    the page every single week, and a warning that is always on is furniture.

    Depends on the company's configured week being ISO — the reason
    `validate_iso_weekdays` exists. See `test_working_week.py`.
    """
    from organization.models import CompanyProfile

    profile = CompanyProfile.get_solo()
    profile.working_days = [7, 1, 2, 3, 4, 5]  # Sunday to Friday
    profile.save()

    data = hr_client.get("/api/v1/timesheets/entries/week/?start=2020-01-05").data
    saturday = next(d for d in data["days"] if d["date"] == "2020-01-11")

    assert saturday["working_day"] is False
    assert saturday["missing"] is False, "the weekend is not a missed day"


def test_a_working_day_still_ahead_is_not_a_gap(hr_client, company):
    """Nobody is late for Friday on Tuesday. Without this every week reports
    four missing days from Monday morning."""
    from django.utils import timezone

    start = timezone.localdate()  # today, so the rest of this week is future
    data = hr_client.get(f"/api/v1/timesheets/entries/week/?start={start}").data

    future = [d for d in data["days"][1:] if d["missing"]]

    assert future == [], "marked days that have not happened yet"
