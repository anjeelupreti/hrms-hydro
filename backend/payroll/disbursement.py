"""Turning a finalised payroll run into payment instructions.

The shape here is plan §4.0a: **one instruction per bank, not one per company**,
so a company where everyone banks in the same place simply gets a batch count of
one rather than a different code path. Employees who cannot be paid come out of
the file **by name and reason**, because a file that silently omits three people
is how somebody goes unpaid for a month.
"""

from decimal import Decimal

from django.db import transaction

from payroll.models import (
    PaymentBatch,
    PaymentBatchItem,
    PaymentExclusion,
    Payslip,
)


class DisbursementError(Exception):
    """A run that is not in a state to be paid from."""


#: Why a payslip cannot go into a bank file. Phrased as what is missing, so the
#: message is directly actionable by whoever has to fix it.
MISSING_BANK_NAME = "No bank name on the employee record"
MISSING_ACCOUNT = "No bank account number on the employee record"
MISSING_ACCOUNT_TYPE = "No bank account type (salary/current/savings) — banks reject on this"
HELD = "Payslip is held"
ALREADY_PAID = "Already paid"
ZERO_NET = "Net pay is zero or negative"


def _exclusion_reason(payslip):
    """The first reason this payslip cannot be paid, or None.

    Ordered deliberately: a *held* payslip is reported as held even if the bank
    details are also incomplete, because the hold is the decision somebody made
    and is what they will be looking for.
    """
    if payslip.is_held:
        return HELD
    if payslip.status == Payslip.Status.PAID:
        return ALREADY_PAID
    if payslip.net_pay <= 0:
        # Not an error — an unpaid-leave month can legitimately net zero. But it
        # must not go into a bank file, and it must be visible rather than
        # silently absent.
        return ZERO_NET

    employee = payslip.employee
    if not employee.bank_name.strip():
        return MISSING_BANK_NAME
    if not employee.bank_account_number.strip():
        return MISSING_ACCOUNT
    if not employee.bank_account_type.strip():
        return MISSING_ACCOUNT_TYPE
    return None


@transaction.atomic
def build_payment_batches(payroll_run, actor=None):
    """Group a run's payable payslips into one batch per bank.

    Idempotent: rebuilding replaces the run's DRAFT batches, so fixing an
    employee's bank details and rebuilding is the normal correction workflow. A
    batch that has already been **sent** is never touched — the bank has it, and
    rewriting our copy would make the record disagree with what they received.
    """
    if payroll_run.status != payroll_run.Status.COMPLETED:
        raise DisbursementError(
            "Only a completed payroll run can be disbursed — "
            f"this one is {payroll_run.get_status_display().lower()}."
        )
    if not payroll_run.is_locked:
        # Finalising is what turns computed figures into approved ones. Paying
        # from an unapproved run would disburse numbers nobody signed off, and
        # the run could still be recomputed underneath the file.
        raise DisbursementError(
            "This run has not been finalised, so its figures are not approved for payment."
        )

    sent_banks = set(
        payroll_run.payment_batches.exclude(status=PaymentBatch.Status.DRAFT).values_list(
            "bank_name", flat=True
        )
    )
    payroll_run.payment_batches.filter(status=PaymentBatch.Status.DRAFT).delete()
    payroll_run.payment_exclusions.all().delete()

    payslips = payroll_run.payslips.select_related("employee__user")
    grouped = {}
    exclusions = []

    for payslip in payslips:
        reason = _exclusion_reason(payslip)
        if reason is not None:
            exclusions.append(PaymentExclusion(
                payroll_run=payroll_run, payslip=payslip, reason=reason
            ))
            continue

        bank = payslip.employee.bank_name.strip()
        if bank in sent_banks:
            # Its instruction is already with the bank; rebuilding would either
            # duplicate the payment or contradict the file they hold.
            exclusions.append(PaymentExclusion(
                payroll_run=payroll_run,
                payslip=payslip,
                reason=f"{bank} batch already sent — release it before rebuilding",
            ))
            continue
        grouped.setdefault(bank, []).append(payslip)

    PaymentExclusion.objects.bulk_create(exclusions)

    batches = []
    for bank_name, bank_payslips in sorted(grouped.items()):
        batch = PaymentBatch.objects.create(
            payroll_run=payroll_run,
            bank_name=bank_name,
            total_amount=sum((p.net_pay for p in bank_payslips), Decimal("0")),
            payslip_count=len(bank_payslips),
            created_by=actor,
            updated_by=actor,
        )
        PaymentBatchItem.objects.bulk_create([
            PaymentBatchItem(
                batch=batch,
                payslip=p,
                # Copied, not referenced — see the model docstring.
                account_name=p.employee.bank_account_name or (
                    p.employee.user.get_full_name() or p.employee.user.get_username()
                ),
                account_number=p.employee.bank_account_number,
                account_type=p.employee.bank_account_type,
                branch=p.employee.bank_branch,
                amount=p.net_pay,
            )
            for p in bank_payslips
        ])
        batches.append(batch)

    return batches, exclusions


@transaction.atomic
def build_single_payment(payslip, actor=None):
    """A batch for one payslip, outside the run-wide build.

    **Why this exists as its own path.** A correction, a late joiner, or one
    person whose bank details were fixed after the main file went out should not
    require re-running the month. Re-running would rebuild every other batch too,
    and the ones already sent must not be touched — so "pay this one person" has
    to be able to happen without disturbing anything else.

    It joins the existing draft batch for that bank if there is one, rather than
    creating a second instruction to the same bank. Two files to one bank for one
    period is how a duplicate payment happens.
    """
    reason = _exclusion_reason(payslip)
    if reason is not None:
        raise DisbursementError(f"This payslip cannot be paid: {reason.lower()}.")

    payroll_run = payslip.payroll_run
    if not payroll_run.is_locked:
        raise DisbursementError(
            "This run has not been finalised, so its figures are not approved for payment."
        )

    employee = payslip.employee
    bank_name = employee.bank_name.strip()

    existing = payroll_run.payment_batches.filter(bank_name=bank_name).first()
    if existing is not None and existing.status != PaymentBatch.Status.DRAFT:
        raise DisbursementError(
            f"The {bank_name} instruction has already been sent. "
            "Acknowledge or fail it before paying anyone else through that bank."
        )

    batch = existing or PaymentBatch.objects.create(
        payroll_run=payroll_run,
        bank_name=bank_name,
        created_by=actor,
        updated_by=actor,
    )

    _, created = PaymentBatchItem.objects.get_or_create(
        batch=batch,
        payslip=payslip,
        defaults={
            "account_name": employee.bank_account_name or (
                employee.user.get_full_name() or employee.user.get_username()
            ),
            "account_number": employee.bank_account_number,
            "account_type": employee.bank_account_type,
            "branch": employee.bank_branch,
            "amount": payslip.net_pay,
        },
    )
    if not created:
        raise DisbursementError("This payslip is already in a payment batch for that bank.")

    # Recomputed from the items rather than incremented, so the total cannot
    # drift from the rows the bank will actually receive.
    _refresh_batch_totals(batch)
    # No longer excluded, if it was.
    PaymentExclusion.objects.filter(payroll_run=payroll_run, payslip=payslip).delete()
    return batch


def _refresh_batch_totals(batch):
    from django.db.models import Count, Sum

    totals = batch.items.aggregate(total=Sum("amount"), count=Count("id"))
    batch.total_amount = totals["total"] or Decimal("0")
    batch.payslip_count = totals["count"] or 0
    batch.save(update_fields=["total_amount", "payslip_count", "updated_at"])
    return batch


class BankDeliveryError(Exception):
    """The instruction could not be delivered.

    Raised rather than swallowed, which is the opposite of how notification
    email is handled here (`core.email.safe_send_mail` never raises, because a
    bounced leave-approval notice must not break the approval).

    A payment instruction is the other case entirely: if the send fails
    silently, HR marks the batch sent, the payslips eventually get marked paid,
    and nobody has actually been paid. The failure has to stop the state change.
    """


def email_batch_to_bank(batch, recipients, *, format_key="generic", actor=None, message=""):
    """Send one instruction to the bank, with the file attached.

    Marks the batch **sent only if the send succeeded**. That ordering is the
    whole point: a batch that says "sent" when the email bounced is worse than
    one still sitting in draft, because the first is acted on and the second is
    noticed.
    """
    from django.core.mail import EmailMessage

    from payroll.bank_formats import render_batch
    from payroll.models import PaymentBatch

    if batch.status != PaymentBatch.Status.DRAFT:
        raise DisbursementError(
            f"This batch is already {batch.get_status_display().lower()}."
        )
    if not recipients:
        raise DisbursementError("No recipient address for the bank.")
    if batch.payslip_count == 0:
        # An empty file is not a payment instruction, and sending one invites
        # the bank to ask what we meant.
        raise DisbursementError("This batch has no payslips in it.")

    content = render_batch(batch, format_key)
    run = batch.payroll_run
    period = f"{run.period_calendar}-{run.period_year}-{run.period_month:02d}"
    filename = f"payment-{batch.bank_name.lower().replace(' ', '-')}-{period}.csv"

    email = EmailMessage(
        subject=f"Salary payment instruction — {period} — {batch.payslip_count} account(s)",
        body=(
            message
            or (
                f"Please process the attached salary payment instruction for {period}.\n\n"
                f"Accounts: {batch.payslip_count}\n"
                f"Total: {batch.total_amount}\n"
            )
        ),
        to=list(recipients),
    )
    email.attach(filename, content, "text/csv")

    try:
        sent = email.send(fail_silently=False)
    except Exception as exc:  # noqa: BLE001 — re-raised as a domain error below
        raise BankDeliveryError(f"Could not send the instruction: {exc}") from exc
    if not sent:
        raise BankDeliveryError("The mail server accepted no recipients.")

    from django.utils import timezone

    batch.status = PaymentBatch.Status.SENT
    batch.sent_at = timezone.now()
    batch.sent_by = actor
    batch.updated_by = actor
    batch.save(update_fields=["status", "sent_at", "sent_by", "updated_by", "updated_at"])
    return batch
