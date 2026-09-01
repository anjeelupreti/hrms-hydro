"""§5.5 — turning a finalised run into payment instructions.

Two things carry the weight here, and neither is the happy path.

**Nobody is silently omitted.** A file that quietly leaves three people out is
how somebody goes unpaid for a month and nobody notices until they say so. Every
payslip that cannot be paid comes out *by name and reason*, returned alongside
the batches rather than behind a second request.

**Sent and acknowledged are different states.** Until the bank confirms, the
money has not moved, and a payslip claiming to be paid on the strength of an
unanswered email is worse than one saying "processing".
"""

from decimal import Decimal

import pytest
from django.utils import timezone

from payroll.bank_formats import UnknownBankFormat, render_batch
from payroll.disbursement import DisbursementError, build_payment_batches
from payroll.models import PaymentBatch, Payslip
from payroll.services import compute_payslip

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_pdf(monkeypatch):
    """WeasyPrint needs native GTK libraries absent on Windows; finalise
    regenerates PDFs inline under Celery-eager. The figures are the payroll
    result, the PDF is a rendering of them."""
    monkeypatch.setattr("payroll.tasks.generate_payslip_pdf", lambda *a, **k: None)


def _bank(employee, name="NIC Asia", *, account="1234567890", acc_type="salary"):
    employee.bank_name = name
    employee.bank_branch = "Kathmandu"
    employee.bank_account_name = "Test Account"
    employee.bank_account_number = account
    employee.bank_account_type = acc_type
    employee.save()
    return employee


def _ready_run(company, payroll_setup, *, finalise=True):
    """A completed, locked run with one payable payslip."""
    emp, run = payroll_setup["emp"], payroll_setup["run"]
    _bank(emp)
    payslip = compute_payslip(run, emp)
    payslip.status = Payslip.Status.FINALIZED
    payslip.save(update_fields=["status"])
    run.status = run.Status.COMPLETED
    if finalise:
        run.locked_at = timezone.now()
    run.save(update_fields=["status", "locked_at"])
    return run, emp, payslip


# ── Grouping ─────────────────────────────────────────────────────────────


def test_one_batch_per_bank(company, payroll_setup, admin_user):
    """The shape of the whole feature.

    A company where everyone banks in one place gets a batch count of one — the
    same code path, not a special case.
    """
    from employees.models import Employee
    from payroll.models import SalaryComponent
    from payroll.services import _upsert_structure_version

    # Payslips first, lock afterwards: `_ready_run` finalises the run, and
    # the period lock correctly refuses to compute anything after that.
    run, emp, _ = _ready_run(company, payroll_setup, finalise=False)
    basic = SalaryComponent.objects.get(code="basic")

    for index, bank in enumerate(("Nabil", "NIC Asia"), start=1):
        user = type(admin_user).objects.create(
            username=f"p{index}", email=f"p{index}@acme.localhost", role="employee"
        )
        peer = Employee.objects.create(
            user=user, employee_code=f"EMP-B{index}",
            date_joined=emp.date_joined, department=emp.department,
            designation=emp.designation,
        )
        _bank(peer, bank, account=f"999{index}0000")
        _upsert_structure_version(
            peer, emp.date_joined, [(basic, Decimal("30000"))], notes="t"
        )
        slip = compute_payslip(run, peer)
        slip.status = Payslip.Status.FINALIZED
        slip.save(update_fields=["status"])

    run.locked_at = timezone.now()
    run.save(update_fields=["locked_at"])
    batches, excluded = build_payment_batches(run)

    assert {b.bank_name for b in batches} == {"NIC Asia", "Nabil"}
    # Two at NIC Asia (the original employee plus one peer), one at Nabil.
    by_bank = {b.bank_name: b for b in batches}
    assert by_bank["NIC Asia"].payslip_count == 2
    assert by_bank["Nabil"].payslip_count == 1
    assert excluded == []


def test_the_batch_total_is_the_sum_of_its_items(company, payroll_setup):
    run, _, payslip = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)

    assert batches[0].total_amount == payslip.net_pay


# ── Nobody is silently omitted ───────────────────────────────────────────


@pytest.mark.parametrize(
    ("field", "value", "fragment"),
    [
        ("bank_name", "", "No bank name"),
        ("bank_account_number", "", "No bank account number"),
        ("bank_account_type", "", "account type"),
    ],
)
def test_incomplete_bank_details_are_excluded_by_name(
    company, payroll_setup, field, value, fragment
):
    """Held back *with a reason*, not dropped.

    The person building the file has to see who is missing before it is sent,
    not after somebody complains.
    """
    run, emp, _ = _ready_run(company, payroll_setup)
    setattr(emp, field, value)
    emp.save(update_fields=[field])

    batches, excluded = build_payment_batches(run)

    assert batches == []
    assert len(excluded) == 1
    assert fragment in excluded[0].reason
    assert excluded[0].payslip.employee_id == emp.id


def test_a_held_payslip_is_excluded_and_says_so(company, payroll_setup):
    """Reported as *held* even though it would also be payable, because the
    hold is the decision somebody made and is what they will look for."""
    run, _, payslip = _ready_run(company, payroll_setup)
    payslip.is_held = True
    payslip.save(update_fields=["is_held"])

    batches, excluded = build_payment_batches(run)

    assert batches == []
    assert excluded[0].reason == "Payslip is held"


def test_a_zero_net_payslip_is_excluded_without_being_an_error(company, payroll_setup):
    """An unpaid-leave month can legitimately net zero. It must not enter a bank
    file, and it must be visible rather than absent."""
    run, _, payslip = _ready_run(company, payroll_setup)
    payslip.net_pay = Decimal("0")
    payslip.save(update_fields=["net_pay"])

    batches, excluded = build_payment_batches(run)

    assert batches == []
    assert "zero" in excluded[0].reason.lower()


# ── A run must be approved before it can be paid ─────────────────────────


def test_an_unfinalised_run_cannot_be_disbursed(company, payroll_setup):
    """Finalising is what turns computed figures into approved ones.

    Paying from an unlocked run would disburse numbers nobody signed off — and
    the run could still be recomputed underneath the file.
    """
    run, _, _ = _ready_run(company, payroll_setup, finalise=False)
    with pytest.raises(DisbursementError, match="not been finalised"):
        build_payment_batches(run)


def test_a_draft_run_cannot_be_disbursed(company, payroll_setup):
    run = payroll_setup["run"]
    with pytest.raises(DisbursementError, match="completed"):
        build_payment_batches(run)


# ── Rebuilding ───────────────────────────────────────────────────────────


def test_rebuilding_replaces_draft_batches(company, payroll_setup):
    """Fixing bank details and rebuilding is the normal correction workflow, so
    it must not stack a second set of instructions beside the first."""
    run, emp, _ = _ready_run(company, payroll_setup)
    emp.bank_account_number = ""
    emp.save(update_fields=["bank_account_number"])
    batches, excluded = build_payment_batches(run)
    assert batches == [] and len(excluded) == 1

    emp.bank_account_number = "5555000011"
    emp.save(update_fields=["bank_account_number"])
    batches, excluded = build_payment_batches(run)

    batch_count = run.payment_batches.count()

    assert len(batches) == 1
    assert excluded == []
    assert batch_count == 1


def test_rebuilding_never_touches_a_sent_batch(company, payroll_setup):
    """The bank has it. Rewriting our copy would make the record disagree with
    the file they hold, and could double-pay."""
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    sent = batches[0]
    sent.status = PaymentBatch.Status.SENT
    sent.save(update_fields=["status"])

    new_batches, excluded = build_payment_batches(run)
    sent_count = run.payment_batches.filter(status=PaymentBatch.Status.SENT).count()

    assert new_batches == []
    assert "already sent" in excluded[0].reason
    assert sent_count == 1


# ── The file ─────────────────────────────────────────────────────────────


def test_the_rendered_file_carries_the_full_account_number(company, payroll_setup):
    """Masked in the API, complete in the file. The bank cannot pay ****7890."""
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    content = render_batch(batches[0], "nic_asia")

    assert "1234567890" in content
    assert "AccountNumber" in content.splitlines()[0]


def test_each_bank_format_produces_its_own_layout(company, payroll_setup):
    """Layouts are data. If every format rendered identically the whole
    structure would be pointless."""
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    batch = batches[0]
    nic = render_batch(batch, "nic_asia")
    nabil = render_batch(batch, "nabil")
    nbl = render_batch(batch, "nbl")

    assert nic.splitlines()[0] != nabil.splitlines()[0]
    # NBL takes no header row at all.
    assert "Beneficiary" not in nbl
    assert nbl.splitlines()[0].startswith("1234567890")


def test_an_unknown_format_raises_rather_than_falling_back(company, payroll_setup):
    """A file in the wrong layout is rejected by the bank at best, and misread
    at worst. Silently defaulting to `generic` would produce one."""
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    with pytest.raises(UnknownBankFormat):
        render_batch(batches[0], "not_a_bank")


# ── Sent vs acknowledged ─────────────────────────────────────────────────


def test_downloading_does_not_mark_the_batch_sent(company, payroll_setup, hr_client):
    """Generating a file to check it is normal. Treating that as "the money has
    gone" would make the status a lie the first time somebody looks."""
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    response = hr_client.get(f"/api/v1/payroll/payment-batches/{batches[0].id}/download/")
    batches[0].refresh_from_db()

    assert response.status_code == 200
    assert batches[0].status == PaymentBatch.Status.DRAFT


def test_marking_sent_does_not_mark_payslips_paid(company, payroll_setup, hr_client):
    """The reason there are two states. Until the bank confirms, the money has
    not moved."""
    run, _, payslip = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    hr_client.post(f"/api/v1/payroll/payment-batches/{batches[0].id}/mark-sent/", {}, format="json")
    payslip.refresh_from_db()
    batches[0].refresh_from_db()

    assert batches[0].status == PaymentBatch.Status.SENT
    assert payslip.status == Payslip.Status.FINALIZED
    assert payslip.paid_at is None


def test_acknowledging_marks_the_payslips_paid_with_the_reference(
    company, payroll_setup, hr_client
):
    run, _, payslip = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    batch_id = batches[0].id
    hr_client.post(f"/api/v1/payroll/payment-batches/{batch_id}/mark-sent/", {}, format="json")
    response = hr_client.post(
        f"/api/v1/payroll/payment-batches/{batch_id}/acknowledge/",
        {"bank_reference": "TXN-8891"},
        format="json",
    )
    payslip.refresh_from_db()

    assert response.status_code == 200
    assert response.data["payslips_marked_paid"] == 1
    assert payslip.status == Payslip.Status.PAID
    assert payslip.disbursement_reference == "TXN-8891"
    assert payslip.paid_at is not None


def test_acknowledging_requires_a_reference(company, payroll_setup, hr_client):
    """"Paid" without a reference cannot be reconciled against a bank
    statement, which is the entire purpose of recording it."""
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    batch_id = batches[0].id
    hr_client.post(f"/api/v1/payroll/payment-batches/{batch_id}/mark-sent/", {}, format="json")
    response = hr_client.post(
        f"/api/v1/payroll/payment-batches/{batch_id}/acknowledge/", {}, format="json"
    )

    assert response.status_code == 400


def test_a_draft_batch_cannot_be_acknowledged(company, payroll_setup, hr_client):
    """The order matters: acknowledged means the bank confirmed something we
    actually sent them."""
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    response = hr_client.post(
        f"/api/v1/payroll/payment-batches/{batches[0].id}/acknowledge/",
        {"bank_reference": "X"},
        format="json",
    )

    assert response.status_code == 409


def test_an_employee_cannot_reach_payment_batches(company, payroll_setup, employee_client):
    """This is the surface that moves money."""
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    response = employee_client.get(f"/api/v1/payroll/payment-batches/{batches[0].id}/")

    assert response.status_code in (403, 404)


# ── Paying one person, outside the run-wide build ────────────────────────


def test_a_single_payslip_can_be_paid_without_rebuilding_the_run(
    company, payroll_setup, hr_client
):
    """A correction or a late joiner is about one person.

    Requiring a run-wide rebuild to pay them would disturb batches that have
    already gone to the bank.
    """
    run, _, payslip = _ready_run(company, payroll_setup)
    response = hr_client.post(
        f"/api/v1/payroll/payslips/{payslip.id}/pay/", {}, format="json"
    )
    batch_count = run.payment_batches.count()

    assert response.status_code == 200
    assert response.data["payslip_count"] == 1
    assert batch_count == 1


def test_a_single_payment_joins_the_existing_draft_batch_for_that_bank(
    company, payroll_setup, hr_client, admin_user
):
    """Two files to one bank for one period is how a duplicate payment happens."""
    from employees.models import Employee
    from payroll.models import SalaryComponent
    from payroll.services import _upsert_structure_version

    run, emp, _ = _ready_run(company, payroll_setup, finalise=False)
    basic = SalaryComponent.objects.get(code="basic")

    user = type(admin_user).objects.create(
        username="late", email="late@acme.localhost", role="employee"
    )
    late = Employee.objects.create(
        user=user, employee_code="EMP-LATE", date_joined=emp.date_joined,
        department=emp.department, designation=emp.designation,
    )
    # Same bank as the first employee.
    _bank(late, "NIC Asia", account="7777000011")
    _upsert_structure_version(late, emp.date_joined, [(basic, Decimal("25000"))], notes="t")
    late_slip = compute_payslip(run, late)
    late_slip.status = Payslip.Status.FINALIZED
    late_slip.save(update_fields=["status"])

    run.locked_at = timezone.now()
    run.save(update_fields=["locked_at"])

    # Build for everyone except the late joiner, by excluding them first.
    late.bank_account_number = ""
    late.save(update_fields=["bank_account_number"])
    build_payment_batches(run)

    # Fix the details and pay just that person.
    late.bank_account_number = "7777000011"
    late.save(update_fields=["bank_account_number"])
    hr_client.post(f"/api/v1/payroll/payslips/{late_slip.id}/pay/", {}, format="json")

    batches = list(run.payment_batches.all())
    nic = run.payment_batches.get(bank_name="NIC Asia")
    exclusions = run.payment_exclusions.count()

    assert len(batches) == 1  # joined, not a second instruction to the same bank
    assert nic.payslip_count == 2
    assert exclusions == 0  # no longer held back


def test_a_single_payment_is_refused_once_that_bank_batch_is_sent(
    company, payroll_setup, hr_client
):
    """The bank has the file. Adding a row now would either be missed or
    double-paid."""
    run, _, payslip = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    batches[0].status = PaymentBatch.Status.SENT
    batches[0].save(update_fields=["status"])

    response = hr_client.post(
        f"/api/v1/payroll/payslips/{payslip.id}/pay/", {}, format="json"
    )

    assert response.status_code == 409
    assert "already been sent" in response.data["detail"]


def test_a_held_payslip_cannot_be_paid_individually(company, payroll_setup, hr_client):
    """The single-payment path must honour the same guards as the bulk one,
    or it becomes the way around them."""
    run, _, payslip = _ready_run(company, payroll_setup)
    payslip.is_held = True
    payslip.save(update_fields=["is_held"])

    response = hr_client.post(
        f"/api/v1/payroll/payslips/{payslip.id}/pay/", {}, format="json"
    )

    assert response.status_code == 409
    assert "held" in response.data["detail"].lower()


def test_an_employee_cannot_pay_their_own_payslip(company, payroll_setup, employee_client):
    run, _, payslip = _ready_run(company, payroll_setup)
    response = employee_client.post(
        f"/api/v1/payroll/payslips/{payslip.id}/pay/", {}, format="json"
    )

    assert response.status_code in (403, 404)


# ── Emailing the instruction ─────────────────────────────────────────────


def test_emailing_attaches_the_file_and_marks_the_batch_sent(
    company, payroll_setup, hr_client, mailoutbox
):
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    response = hr_client.post(
        f"/api/v1/payroll/payment-batches/{batches[0].id}/send-email/",
        {"recipients": ["ops@nicasia.example"], "format": "nic_asia"},
        format="json",
    )
    batches[0].refresh_from_db()

    assert response.status_code == 200
    assert batches[0].status == PaymentBatch.Status.SENT
    assert len(mailoutbox) == 1
    filename, content, mimetype = mailoutbox[0].attachments[0]
    assert filename.endswith(".csv")
    assert "1234567890" in content  # the full number — the bank cannot pay ****7890


def test_a_failed_send_leaves_the_batch_in_draft(
    company, payroll_setup, hr_client, monkeypatch
):
    """The ordering that matters.

    A batch claiming "sent" after a bounce is worse than one still in draft:
    the first gets acted on, the second gets noticed. Unlike notification email,
    which never raises, a failed payment instruction must stop the state change.
    """
    def _boom(*args, **kwargs):
        raise OSError("smtp unreachable")

    monkeypatch.setattr("django.core.mail.EmailMessage.send", _boom)

    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    response = hr_client.post(
        f"/api/v1/payroll/payment-batches/{batches[0].id}/send-email/",
        {"recipients": ["ops@nicasia.example"]},
        format="json",
    )
    batches[0].refresh_from_db()

    assert response.status_code == 502
    assert response.data["code"] == "bank_delivery_failed"
    assert batches[0].status == PaymentBatch.Status.DRAFT
    assert batches[0].sent_at is None


def test_emailing_without_a_recipient_is_refused(company, payroll_setup, hr_client):
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    response = hr_client.post(
        f"/api/v1/payroll/payment-batches/{batches[0].id}/send-email/", {}, format="json"
    )

    assert response.status_code == 409


def test_an_already_sent_batch_is_not_emailed_twice(company, payroll_setup, hr_client, mailoutbox):
    run, _, _ = _ready_run(company, payroll_setup)
    batches, _ = build_payment_batches(run)
    batch_id = batches[0].id
    hr_client.post(
        f"/api/v1/payroll/payment-batches/{batch_id}/send-email/",
        {"recipients": ["ops@nicasia.example"]}, format="json",
    )
    second = hr_client.post(
        f"/api/v1/payroll/payment-batches/{batch_id}/send-email/",
        {"recipients": ["ops@nicasia.example"]}, format="json",
    )

    assert second.status_code == 409
    assert len(mailoutbox) == 1
