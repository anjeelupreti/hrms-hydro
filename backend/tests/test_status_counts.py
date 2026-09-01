"""The contract every list screen's filter chips depend on.

Counting in the browser is what these replace, and it was wrong in a way
nobody could see: a page is capped at 100 rows, so a tally of `results`
undercounts on exactly the companys where the number matters. Three separate
bugs traced to that shape before the count moved into SQL.
"""

from datetime import date
from decimal import Decimal

import pytest
from rest_framework import status

from accounts.models import User
from assets.models import Asset
from crm.models import Client, Invoice, InvoiceLineItem
from employees.models import Department, Designation, Employee
from helpdesk.models import Ticket
from leave.models import LeaveRequest, LeaveType
from projects.models import Project, ProjectTask

pytestmark = pytest.mark.django_db


@pytest.fixture
def employee(company):
    user = User.objects.create_user(
        username="counter",
        email="counter@t.test",
        password="pw",
        role=User.Role.EMPLOYEE,
        first_name="Count",
        last_name="Er",
    )
    return Employee.objects.create(
        user=user,
        employee_code="EMP-CNT",
        date_joined=date(2026, 1, 1),
        department=Department.objects.create(name="Counting", code="CNT"),
        designation=Designation.objects.create(title="Counter"),
    )


def test_every_bucket_is_reported_including_the_empty_ones(hr_client, company):
    """"Rejected: 0" is a fact. A missing key reads as "unknown"."""
    Asset.objects.create(name="Laptop A", asset_tag="A-1", status=Asset.Status.AVAILABLE)

    response = hr_client.get("/api/v1/assets/assets/status-counts/")

    assert response.status_code == status.HTTP_200_OK
    for choice, _ in Asset.Status.choices:
        assert choice in response.data, f"{choice} missing — an absent bucket is not a zero"
    assert response.data["available"] == 1


def test_counts_cover_the_whole_table_not_one_page(hr_client, company):
    """A page holds 100; the truth is usually more."""
    for i in range(105):
        Asset.objects.create(
            name=f"Asset {i}", asset_tag=f"TAG-{i:04d}", status=Asset.Status.AVAILABLE
        )

    listed = hr_client.get("/api/v1/assets/assets/?page_size=200")
    counted = hr_client.get("/api/v1/assets/assets/status-counts/")

    # The list is capped...
    assert len(listed.data["results"]) == 100
    # ...but the count is not, which is the entire point.
    assert counted.data["available"] >= 105
    assert counted.data["total"] >= 105


def test_totals_match_the_sum_of_buckets(hr_client, company):
    Asset.objects.create(name="B", asset_tag="B-1", status=Asset.Status.AVAILABLE)
    Asset.objects.create(name="C", asset_tag="C-1", status=Asset.Status.MAINTENANCE)

    data = hr_client.get("/api/v1/assets/assets/status-counts/").data
    buckets = sum(v for k, v in data.items() if k != "total")

    assert data["total"] == buckets


def test_helpdesk_and_leave_expose_the_same_shape(hr_client, company, employee):
    """One mixin, so the contract cannot drift between screens."""
    Ticket.objects.create(subject="Printer", status=Ticket.Status.OPEN, requester=employee)
    leave_type = LeaveType.objects.create(name="Casual C", code="CLC", annual_quota_days=5)
    LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 6, 1),
        days_requested=Decimal("1"),
    )

    for url in ("/api/v1/helpdesk/tickets/status-counts/", "/api/v1/leave/requests/status-counts/"):
        response = hr_client.get(url)
        assert response.status_code == status.HTTP_200_OK, url
        assert "total" in response.data, url
        assert response.data["total"] >= 1, url


def test_an_annotated_list_still_counts_its_own_rows(hr_client, company):
    """The chips must count projects, not the rows an annotation joins in.

    `ProjectViewSet.get_queryset()` annotates each row with `Count("tasks")` so
    a project can show its progress without a query apiece, and an annotation
    over a reverse relation is a JOIN. Grouping that by status counts the joined
    rows — six projects with thirty-seven tasks between them reported as
    thirty-seven.

    One project with several tasks is the entire reproduction. A fixture with
    one task each would pass while broken, which is why the numbers here are
    lopsided on purpose.
    """
    project = Project.objects.create(name="Powerhouse", status=Project.Status.ACTIVE)
    for i in range(5):
        ProjectTask.objects.create(project=project, title=f"Task {i}")
    Project.objects.create(name="Intake gate", status=Project.Status.PLANNING)

    data = hr_client.get("/api/v1/projects/projects/status-counts/").data

    assert data["total"] == 2, "counted joined rows, not projects"
    assert data["active"] == 1
    assert data["planning"] == 1


def test_an_annotated_list_does_not_multiply_its_money(hr_client, company):
    """The same JOIN silently multiplies `sum_field`, which is the worse half.

    A count that reads high is visibly odd; an amount that reads high is
    believed. Dropping the viewset's annotations is what protects the sum here
    — `distinct=True` on the count alone would have left it inflated. Both are
    needed, for two different joins: see the invoice test below for the one
    `distinct` exists to catch.
    """
    project = Project.objects.create(name="Canal", status=Project.Status.ACTIVE)
    ProjectTask.objects.create(project=project, title="One")
    ProjectTask.objects.create(project=project, title="Two")

    data = hr_client.get("/api/v1/projects/projects/status-counts/").data
    buckets = sum(v for k, v in data.items() if k != "total")

    assert data["total"] == buckets == 1


def test_the_chips_obey_the_list_filters(hr_client, company, employee):
    """The chips must respect the list's filters.

    DRF applies its filter backends in `filter_queryset()`, which a custom
    `@action` does not get for free — so counting straight off `get_queryset()`
    reports the whole company above a table showing a filtered subset.

    Asserted on the *filter* rather than on payroll specifically, because the
    fault was in the shared mixin and every list screen in the product inherited
    it. Two categories, one of which is filtered out: if the filter is ignored,
    the total is 2.
    """
    Asset.objects.create(
        name="Laptop", asset_tag="F-1", category=Asset.Category.LAPTOP,
        status=Asset.Status.AVAILABLE,
    )
    Asset.objects.create(
        name="Chair", asset_tag="F-2", category=Asset.Category.FURNITURE,
        status=Asset.Status.AVAILABLE,
    )

    counted = hr_client.get("/api/v1/assets/assets/status-counts/?category=laptop")

    assert counted.status_code == status.HTTP_200_OK
    assert counted.data["total"] == 1, "the chips counted rows the list would not show"
    assert counted.data["available"] == 1


def test_selecting_a_chip_does_not_blank_the_others(hr_client, company):
    """The one filter the chips must ignore is the one they represent.

    Otherwise choosing "Available" leaves "In maintenance" reading zero, and the
    chips stop being a way to see what is there.
    """
    Asset.objects.create(name="D", asset_tag="D-1", status=Asset.Status.AVAILABLE)
    Asset.objects.create(name="E", asset_tag="E-1", status=Asset.Status.MAINTENANCE)

    counted = hr_client.get("/api/v1/assets/assets/status-counts/?status=available")

    assert counted.data["available"] == 1
    assert counted.data["maintenance"] == 1, "selecting a chip hid the other buckets"


def test_a_sum_over_a_relation_does_not_inflate_the_count(hr_client, company):
    """The chip counts invoices, not the line items its own money sum joins in.

    `InvoiceViewSet.sum_field` is `line_items__quantity * line_items__unit_price`
    — an expression over a reverse relation, so annotating it is a JOIN. That
    join is added by the mixin *after* the rebuild has dropped the viewset's own
    annotations, so the rebuild cannot protect against it: `Count("id")` over it
    counts line items. One invoice with three of them reported as three.

    The sum is right either way; it is *meant* to traverse that join. Only the
    count needed `distinct=True`, which is why this asserts both.
    """
    client = Client.objects.create(name="ABC Traders")
    invoice = Invoice.objects.create(
        client=client,
        number="INV-COUNT-1",
        issue_date=date(2026, 1, 1),
        status=Invoice.Status.DRAFT,
    )
    for i in range(3):
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f"Line {i}",
            quantity=Decimal("1"),
            unit_price=Decimal("100"),
        )

    data = hr_client.get("/api/v1/crm/invoices/status-counts/").data

    assert data["total"] == 1, "counted line items, not invoices"
    assert data["draft"]["count"] == 1
    # Three lines at 100 each — the money still traverses the join, as it must.
    assert Decimal(data["draft"]["amount"]) == Decimal("300")
