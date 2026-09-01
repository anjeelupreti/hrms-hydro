"""Where a ticket goes, as opposed to who ends up working it.

With only an assignee, a new ticket has to be routed by whoever happens to look
at the unassigned queue — so it either sits there, or lands on one person who
becomes the routing table. The desk is chosen by the person raising it, who
knows what their problem is about and not who is on shift.
"""

from datetime import date

import pytest

from employees.models import Department, Employee
from helpdesk.models import Ticket

pytestmark = pytest.mark.django_db

TICKETS = "/api/v1/helpdesk/tickets/"


@pytest.fixture
def it_desk(db):
    return Department.objects.create(name="IT", code="IT")


@pytest.fixture
def requester(db, employee_user, company):
    return Employee.objects.create(
        user=employee_user, employee_code="EMP-H1",
        date_joined=date(2024, 1, 1), primary_company=company,
    )


@pytest.fixture
def colleague(db, hr_user, company):
    return Employee.objects.create(
        user=hr_user, employee_code="EMP-H2",
        date_joined=date(2024, 1, 1), primary_company=company,
    )


def test_a_ticket_is_raised_at_a_desk(employee_client, requester, it_desk):
    response = employee_client.post(
        TICKETS,
        {
            "subject": "Laptop will not join the site VPN",
            "description": "Since the firmware update on Sunday.",
            "category": "it",
            "target_department": it_desk.pk,
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["target_department_name"] == "IT"
    assert response.data["assignee"] is None, "routing is not the same as assigning"


def test_the_queue_can_be_filtered_by_desk(admin_client, requester, it_desk):
    finance = Department.objects.create(name="Finance", code="FIN")
    Ticket.objects.create(subject="Mine", requester=requester, target_department=it_desk)
    Ticket.objects.create(subject="Theirs", requester=requester, target_department=finance)

    response = admin_client.get(f"{TICKETS}?target_department={it_desk.pk}")

    assert [t["subject"] for t in response.data["results"]] == ["Mine"]


def test_a_watcher_can_open_the_ticket_they_were_added_to(
    admin_client, employee_client, requester, colleague
):
    """Otherwise the field is decoration: somebody named on a ticket, unable to
    read it."""
    ticket = Ticket.objects.create(subject="Site power trip", requester=colleague)

    hidden = employee_client.get(f"{TICKETS}{ticket.pk}/")
    assert hidden.status_code == 404, "not a party to it yet"

    ticket.watchers.add(requester)

    visible = employee_client.get(f"{TICKETS}{ticket.pk}/")
    assert visible.status_code == 200, visible.data
    assert visible.data["watcher_names"] != []


def test_a_watcher_is_not_a_second_assignee(admin_client, requester, colleague):
    ticket = Ticket.objects.create(subject="Anything", requester=requester)
    ticket.watchers.add(colleague)

    response = admin_client.get(f"{TICKETS}{ticket.pk}/")

    assert response.data["assignee"] is None
    assert len(response.data["watchers"]) == 1


def test_hr_routes_and_assigns_separately(admin_client, requester, colleague, it_desk):
    """The desk is chosen when the ticket is raised; the assignee afterwards,
    and again when it is handed on."""
    ticket = Ticket.objects.create(
        subject="Printer", requester=requester, target_department=it_desk
    )

    response = admin_client.patch(
        f"{TICKETS}{ticket.pk}/", {"assignee": colleague.pk}, format="json"
    )

    assert response.status_code == 200, response.data
    ticket.refresh_from_db()
    assert ticket.assignee == colleague
    assert ticket.target_department == it_desk, "assigning must not clear the desk"
