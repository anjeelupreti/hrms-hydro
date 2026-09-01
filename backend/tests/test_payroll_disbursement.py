"""Paying a run: grouping, exclusions, and the states in between.

`PaymentBatch` is the surface that moves money, and until now it had no test
and no UI. Building the UI turned up two preconditions that reading the code had
not: `build_payment_batches` refuses a run that is not **completed**, and then
refuses a completed run that is not **locked**. Both were found by calling the
endpoint and getting a 409, one after the other — so they are pinned here, in
the order a caller meets them.

The rest is the distinction the whole module exists for. A payslip becomes
**paid** on *acknowledgement*, never on send: sent means the instruction was
handed over, acknowledged means the bank confirmed it, and a payslip claiming
paid on the strength of an unanswered email is worse than one saying nothing.
"""

from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework import status

from accounts.models import User
from employees.models import Employee
from payroll.models import PaymentBatch, PayrollRun, Payslip

pytestmark = pytest.mark.django_db

RUNS = "/api/v1/payroll/runs"
BATCHES = "/api/v1/payroll/payment-batches"


def _make_run(company, *, locked: bool, completed: bool = True):
    """A run with three payable people at two banks, and one with no account.

    The unbanked one is the point of the fixture, not a garnish: an exclusion is
    the only thing on the disbursement screen that a flat bank-file export
    cannot show, and a fixture where everybody is payable would never produce
    one.
    """
    run = PayrollRun.objects.create(
        period_calendar="AD",
        period_year=2026,
        period_month=8,
        status=PayrollRun.Status.COMPLETED if completed else PayrollRun.Status.DRAFT,
        locked_at=timezone.now() if locked else None,
    )
    # Three fields are required to pay somebody, not two: bank, account
    # number *and* account type. Without the type every employee is
    # excluded ("banks reject on this"), no batch is built, and every test
    # below cascades on a `None` batch.
    people = [
        ("Nabil Bank", "NB-0001"),
        ("Nabil Bank", "NB-0002"),
        ("NIC Asia Bank", "NIC-0001"),
        ("", ""),  # nobody can pay this one
    ]
    for index, (bank, account) in enumerate(people):
        user = User.objects.create_user(
            username=f"disb{index}",
            email=f"disb{index}@t.test",
            password="pw",
            role=User.Role.EMPLOYEE,
            first_name=f"Payee{index}",
            last_name="Test",
        )
        employee = Employee.objects.create(
            user=user,
            employee_code=f"DSB-{index:03d}",
            date_joined=date(2026, 1, 1),
            bank_name=bank,
            bank_account_number=account,
            bank_branch="Branch" if bank else "",
            bank_account_type=(
                Employee.BankAccountType.SALARY if bank else ""
            ),
        )
        Payslip.objects.create(
            payroll_run=run,
            employee=employee,
            gross_earnings=Decimal("50000"),
            total_deductions=Decimal("5000"),
            net_pay=Decimal("45000"),
            status=Payslip.Status.FINALIZED,
        )
    return run


@pytest.fixture
def payable_run(company):
    return _make_run(company, locked=True)


class TestPreconditions:
    """Both guards, in the order a caller trips over them."""

    def test_a_draft_run_cannot_be_disbursed(self, company, hr_client):
        run = _make_run(company, locked=False, completed=False)
        response = hr_client.post(f"{RUNS}/{run.pk}/build-payments/")
        assert response.status_code == status.HTTP_409_CONFLICT
        assert "completed" in response.data["detail"].lower()

    def test_a_completed_but_unlocked_run_cannot_be_disbursed(self, company, hr_client):
        """Finalising is what turns computed figures into approved ones, so a
        completed-but-unlocked run looks payable and is not."""
        run = _make_run(company, locked=False)
        response = hr_client.post(f"{RUNS}/{run.pk}/build-payments/")
        assert response.status_code == status.HTTP_409_CONFLICT
        assert "finalised" in response.data["detail"].lower()


class TestBuilding:
    def test_payslips_group_into_one_batch_per_bank(self, hr_client, payable_run):
        response = hr_client.post(f"{RUNS}/{payable_run.pk}/build-payments/")
        assert response.status_code == status.HTTP_200_OK

        batches = {b["bank_name"]: b for b in response.data["batches"]}
        assert set(batches) == {"Nabil Bank", "NIC Asia Bank"}
        assert batches["Nabil Bank"]["payslip_count"] == 2
        assert batches["NIC Asia Bank"]["payslip_count"] == 1
        assert all(b["status"] == "draft" for b in batches.values())

    def test_somebody_with_no_bank_is_excluded_and_named(self, hr_client, payable_run):
        """The finding the flat bank-file export could not surface.

        That export emitted a row with a blank bank and let the bank drop it,
        so the person found out by checking their account.
        """
        response = hr_client.post(f"{RUNS}/{payable_run.pk}/build-payments/")
        excluded = response.data["excluded"]
        assert len(excluded) == 1
        assert excluded[0]["employee_code"] == "DSB-003"
        assert excluded[0]["reason"]

    def test_exclusions_come_back_with_the_batches(self, hr_client, payable_run):
        """Not behind a second request — whoever builds the file has to see who
        is *not* in it before sending, which means on the same response."""
        hr_client.post(f"{RUNS}/{payable_run.pk}/build-payments/")
        response = hr_client.get(f"{RUNS}/{payable_run.pk}/payments/")
        assert set(response.data) == {"batches", "excluded", "formats"}
        assert response.data["excluded"]
        assert {f["key"] for f in response.data["formats"]} >= {"generic", "nabil"}

    def test_rebuilding_is_idempotent(self, hr_client, payable_run):
        """Fixing somebody's bank details and rebuilding is the normal
        correction workflow, so it must not duplicate the batches."""
        first = hr_client.post(f"{RUNS}/{payable_run.pk}/build-payments/")
        second = hr_client.post(f"{RUNS}/{payable_run.pk}/build-payments/")
        assert len(second.data["batches"]) == len(first.data["batches"])
        assert PaymentBatch.objects.filter(payroll_run=payable_run).count() == 2


class TestLifecycle:
    @pytest.fixture
    def batch(self, hr_client, payable_run, company):
        hr_client.post(f"{RUNS}/{payable_run.pk}/build-payments/")
        return PaymentBatch.objects.filter(bank_name="Nabil Bank").first()

    def test_downloading_does_not_mark_it_sent(self, hr_client, batch, company):
        """Generating a file to check it is a normal thing to do, and treating
        that as "the money has gone" would make the status a lie."""
        response = hr_client.get(f"{BATCHES}/{batch.pk}/download/?layout=generic")
        assert response.status_code == status.HTTP_200_OK
        batch.refresh_from_db()
        assert batch.status == PaymentBatch.Status.DRAFT

    def test_an_unknown_bank_layout_is_refused(self, hr_client, batch):
        """The parameter is `layout`, because `format` is DRF's own.

        With `?format=` content negotiation looks for a renderer by that name
        and 404s before the view runs, making every bank layout unreachable.
        """
        response = hr_client.get(f"{BATCHES}/{batch.pk}/download/?layout=not-a-bank")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_a_draft_cannot_be_acknowledged(self, hr_client, batch):
        """Acknowledgement means the bank confirmed. It cannot confirm something
        it was never sent."""
        response = hr_client.post(
            f"{BATCHES}/{batch.pk}/acknowledge/", {"bank_reference": "REF"}, format="json"
        )
        assert response.status_code == status.HTTP_409_CONFLICT

    def test_marking_sent_twice_is_refused(self, hr_client, batch):
        assert hr_client.post(f"{BATCHES}/{batch.pk}/mark-sent/").status_code == 200
        assert hr_client.post(f"{BATCHES}/{batch.pk}/mark-sent/").status_code == 409

    def test_acknowledging_without_a_reference_is_refused(self, hr_client, batch):
        """"Paid" with no reference cannot be reconciled against a statement,
        which is the only reason to record it at all."""
        hr_client.post(f"{BATCHES}/{batch.pk}/mark-sent/")
        response = hr_client.post(
            f"{BATCHES}/{batch.pk}/acknowledge/", {"bank_reference": "   "}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_sending_does_not_make_a_payslip_paid(self, hr_client, batch, company):
        """Sent is not paid: an instruction reaching the bank is not money
        leaving it."""
        hr_client.post(f"{BATCHES}/{batch.pk}/mark-sent/")
        assert not Payslip.objects.filter(
            payment_items__batch=batch, status=Payslip.Status.PAID
        ).exists()

    def test_acknowledging_is_what_makes_a_payslip_paid(self, hr_client, batch, company):
        hr_client.post(f"{BATCHES}/{batch.pk}/mark-sent/")
        response = hr_client.post(
            f"{BATCHES}/{batch.pk}/acknowledge/", {"bank_reference": "TXN-9"}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["status"] == "acknowledged"
        assert response.data["bank_reference"] == "TXN-9"
        paid = Payslip.objects.filter(
            payment_items__batch=batch, status=Payslip.Status.PAID
        ).count()
        assert paid == batch.payslip_count


class TestAccess:
    def test_an_employee_cannot_see_payment_batches(self, employee_client, payable_run):
        """This is the surface that moves money — HR only, throughout."""
        response = employee_client.get(f"{BATCHES}/")
        assert response.status_code in (403, 404)

    def test_an_employee_cannot_build_payments(self, employee_client, payable_run):
        response = employee_client.post(f"{RUNS}/{payable_run.pk}/build-payments/")
        assert response.status_code in (403, 404)
