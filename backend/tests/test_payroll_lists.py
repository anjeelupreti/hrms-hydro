"""What a payroll list screen needs from the API.

Payroll's viewsets had `filterset_fields` and nothing else: no text search, no
ordering, no bucket counts. On a hundred-person company that makes the payslip
list unnavigable — a payslip is looked up by *the person*, and the only way to
reach one was to know its run and scroll.

The counts matter for the same reason `StatusCountsMixin` was written: a list
that tallies its own `results` is tallying one page of at most 100, which
undercounts on exactly the companys where the number matters.
"""

from datetime import date
from decimal import Decimal

import pytest
from rest_framework import status

from accounts.models import User
from employees.models import Employee
from payroll.models import PayrollRun, Payslip

pytestmark = pytest.mark.django_db

PAYSLIP_URL = "/api/v1/payroll/payslips/"


@pytest.fixture
def run_with_payslips(company):
    """A run with enough payslips to page, and names worth searching for."""
    run = PayrollRun.objects.create(
        period_calendar="AD", period_year=2026, period_month=8,
        status=PayrollRun.Status.PROCESSING,
    )
    made = []
    for i in range(12):
        user = User.objects.create_user(
            username=f"pay{i:03d}", email=f"pay{i:03d}@t.test", password="pw",
            role=User.Role.EMPLOYEE,
            first_name=("Findable" if i == 7 else f"Person{i:03d}"),
            last_name="Payee",
        )
        employee = Employee.objects.create(
            user=user, employee_code=f"PAY-{i:03d}", date_joined=date(2026, 1, 1)
        )
        made.append(Payslip.objects.create(
            payroll_run=run, employee=employee,
            gross_earnings=Decimal("50000") + i,
            total_deductions=Decimal("5000"),
            net_pay=Decimal("45000") + i,
            status=Payslip.Status.FINALIZED if i % 2 else Payslip.Status.DRAFT,
        ))
    return {"run": run, "payslips": made}


def test_a_payslip_can_be_found_by_the_person(hr_client, run_with_payslips):
    """The whole point. Before this the list could only be narrowed by run,
    employee *id*, status or held — none of which a person types."""
    response = hr_client.get(f"{PAYSLIP_URL}?search=Findable")
    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    assert response.data["results"][0]["employee_name"].startswith("Findable")


def test_a_payslip_can_be_found_by_employee_code(hr_client, run_with_payslips):
    response = hr_client.get(f"{PAYSLIP_URL}?search=PAY-003")
    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1


def test_search_composes_with_the_run_filter_rather_than_replacing_it(hr_client, company, run_with_payslips):
    """A search that ignored the run filter would show August's Findable while
    the screen says July, which is worse than finding nothing."""
    other = PayrollRun.objects.create(
        period_calendar="AD", period_year=2026, period_month=7
    )
    response = hr_client.get(f"{PAYSLIP_URL}?search=Findable&payroll_run={other.id}")
    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 0


def test_payslips_can_be_ordered_by_what_they_are_worth(hr_client, run_with_payslips):
    response = hr_client.get(f"{PAYSLIP_URL}?ordering=-net_pay")
    assert response.status_code == status.HTTP_200_OK
    nets = [Decimal(r["net_pay"]) for r in response.data["results"]]
    assert nets == sorted(nets, reverse=True)


def test_status_counts_cover_every_bucket_including_the_empty_ones(hr_client, run_with_payslips):
    """"Paid: 0" is a fact worth stating; a missing key reads as unknown."""
    response = hr_client.get(f"{PAYSLIP_URL}status-counts/")
    assert response.status_code == status.HTTP_200_OK

    body = response.data
    assert body["total"] == 12
    for bucket in ("draft", "finalized", "paid"):
        assert bucket in body, f"{bucket} missing from {sorted(body)}"
    assert body["paid"]["count"] == 0


def test_status_counts_carry_the_money_not_just_the_rows(hr_client, run_with_payslips):
    """A payroll list is judged by amount as much as by volume — six draft
    payslips means nothing without knowing they are worth 270,015."""
    response = hr_client.get(f"{PAYSLIP_URL}status-counts/")
    assert response.status_code == status.HTTP_200_OK

    draft = response.data["draft"]
    assert draft["count"] == 6
    assert Decimal(draft["amount"]) > 0


def test_status_counts_are_not_capped_by_the_page_size(hr_client, company, run_with_payslips):
    """The bug the mixin exists for: a screen counting its own `results` stops
    at 100 and quietly undercounts the companys big enough to care."""
    run = run_with_payslips["run"]
    for i in range(100, 205):
        user = User.objects.create_user(
            username=f"bulk{i}", email=f"bulk{i}@t.test", password="pw",
            role=User.Role.EMPLOYEE, first_name=f"Bulk{i}", last_name="Payee",
        )
        employee = Employee.objects.create(
            user=user, employee_code=f"BULK-{i}", date_joined=date(2026, 1, 1)
        )
        Payslip.objects.create(
            payroll_run=run, employee=employee,
            gross_earnings=Decimal("1000"), total_deductions=Decimal("0"),
            net_pay=Decimal("1000"), status=Payslip.Status.PAID,
        )

    listing = hr_client.get(PAYSLIP_URL)
    page = len(listing.data["results"])
    # Deliberately not asserting the page size itself — it is 25 today and the
    # claim under test survives it changing. What matters is that one page is
    # provably smaller than the truth.
    assert page < 117, f"fixture no longer exceeds a page (got {page})"

    counts = hr_client.get(f"{PAYSLIP_URL}status-counts/")
    assert counts.data["total"] == 117
    assert counts.data["paid"]["count"] == 105
