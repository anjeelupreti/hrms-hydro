"""§5.2 — holding a payslip, and stating the amount in words.

The hold tests are mostly about one thing: a flag that the bulk pay action
ignores is decoration. `mark_paid` updates every finalised payslip in a run at
once, so that is where a hold either works or does not.
"""

from decimal import Decimal

import pytest

from core.numbers import amount_to_words, number_to_words_indic
from payroll.models import Payslip
from payroll.services import compute_payslip

pytestmark = pytest.mark.django_db


# ── Amount in words, Indic grouping ──────────────────────────────────────


@pytest.mark.parametrize(
    ("number", "words"),
    [
        (0, "zero"),
        (7, "seven"),
        (15, "fifteen"),
        (100, "one hundred"),
        (108, "one hundred and eight"),
        (1_000, "one thousand"),
        # The grouping that makes this Indic rather than Western: 150,000 is
        # one lakh fifty thousand, not one hundred fifty thousand.
        (150_000, "one lakh fifty thousand"),
        (1_080_120, "ten lakh eighty thousand one hundred and twenty"),
        (10_000_000, "one crore"),
        (12_345_678, "one crore twenty three lakh forty five thousand six hundred and seventy eight"),
    ],
)
def test_indic_grouping(number, words):
    assert number_to_words_indic(number) == words


def test_paisa_are_written_separately():
    """"and Paisa fifty" is what makes the figure checkable — which is the only
    reason words appear on a payslip at all."""
    assert amount_to_words(Decimal("1500.50")) == "Rupees one thousand five hundred and Paisa fifty only"


def test_a_whole_amount_has_no_paisa_clause():
    assert amount_to_words(Decimal("1500.00")) == "Rupees one thousand five hundred only"


# ── Hold and release ─────────────────────────────────────────────────────


def _finalized_payslip(company, payroll_setup):
    payslip = compute_payslip(payroll_setup["run"], payroll_setup["emp"])
    payslip.status = Payslip.Status.FINALIZED
    payslip.save(update_fields=["status"])
    return payslip


def test_holding_records_who_and_why(company, payroll_setup, hr_client):
    payslip = _finalized_payslip(company, payroll_setup)
    response = hr_client.post(
        f"/api/v1/payroll/payslips/{payslip.id}/hold/",
        {"reason": "Bank details unverified"},
        format="json",
    )
    payslip.refresh_from_db()
    held_by_id, held_at = payslip.held_by_id, payslip.held_at

    assert response.status_code == 200
    assert payslip.is_held is True
    assert payslip.hold_reason == "Bank details unverified"
    assert held_by_id is not None
    assert held_at is not None


def test_a_hold_does_not_change_the_payslip_status(company, payroll_setup, hr_client):
    """The reason hold is a flag rather than a fourth status value.

    Overwriting FINALIZED would destroy the state release has to return to,
    and release would then have to guess between draft and finalised.
    """
    payslip = _finalized_payslip(company, payroll_setup)
    hr_client.post(f"/api/v1/payroll/payslips/{payslip.id}/hold/", {}, format="json")
    payslip.refresh_from_db()

    assert payslip.is_held is True
    assert payslip.status == Payslip.Status.FINALIZED


def test_a_held_payslip_is_not_paid_by_the_bulk_action(company, payroll_setup, hr_client):
    """The test this whole feature exists for.

    `mark_paid` updates every finalised payslip in the run at once. If it did
    not exclude held rows, the flag would be visible on screen and ignored by
    the one operation that moves money.
    """
    payslip = _finalized_payslip(company, payroll_setup)
    run = payroll_setup["run"]
    hr_client.post(f"/api/v1/payroll/payslips/{payslip.id}/hold/", {}, format="json")
    response = hr_client.post(
        f"/api/v1/payroll/runs/{run.id}/mark-all-paid/",
        {"disbursement_method": "bank_transfer", "disbursement_reference": "TXN-1"},
        format="json",
    )
    payslip.refresh_from_db()

    assert response.status_code == 200
    assert response.data["marked_paid"] == 0
    # Reported rather than silently omitted: "0 paid" alone is a mystery.
    assert response.data["skipped_held"] == 1
    assert payslip.status == Payslip.Status.FINALIZED
    assert payslip.paid_at is None


def test_releasing_restores_payability_and_keeps_the_history(company, payroll_setup, hr_client):
    """Why the hold was placed and who placed it survive the release — that is
    exactly what an audit asks for afterwards."""
    payslip = _finalized_payslip(company, payroll_setup)
    run = payroll_setup["run"]
    hr_client.post(
        f"/api/v1/payroll/payslips/{payslip.id}/hold/",
        {"reason": "Bank details unverified"},
        format="json",
    )
    hr_client.post(f"/api/v1/payroll/payslips/{payslip.id}/release/", {}, format="json")
    payslip.refresh_from_db()

    response = hr_client.post(
        f"/api/v1/payroll/runs/{run.id}/mark-all-paid/",
        {"disbursement_method": "bank_transfer", "disbursement_reference": "TXN-2"},
        format="json",
    )
    payslip.refresh_from_db()
    released_by_id, held_by_id = payslip.released_by_id, payslip.held_by_id

    assert payslip.is_held is False
    assert released_by_id is not None
    # Retained deliberately.
    assert payslip.hold_reason == "Bank details unverified"
    assert held_by_id is not None
    assert response.data["marked_paid"] == 1
    assert payslip.status == Payslip.Status.PAID


def test_a_paid_payslip_cannot_be_held(company, payroll_setup, hr_client):
    """Holding after payment would claim to have stopped something that has
    already left. Reversing a payment is a different operation."""
    payslip = _finalized_payslip(company, payroll_setup)
    payslip.status = Payslip.Status.PAID
    payslip.save(update_fields=["status"])
    response = hr_client.post(
        f"/api/v1/payroll/payslips/{payslip.id}/hold/", {}, format="json"
    )

    assert response.status_code == 409


def test_an_employee_cannot_hold_their_own_payslip(company, payroll_setup, employee_client):
    """Withholding pay is not a self-service action, in either direction."""
    payslip = _finalized_payslip(company, payroll_setup)
    response = employee_client.post(
        f"/api/v1/payroll/payslips/{payslip.id}/hold/", {}, format="json"
    )

    assert response.status_code in (403, 404)


def test_held_payslips_can_be_listed(company, payroll_setup, hr_client):
    """The "Held" view — a filter, so it composes with run and employee rather
    than being a third way to list the same rows."""
    payslip = _finalized_payslip(company, payroll_setup)
    hr_client.post(f"/api/v1/payroll/payslips/{payslip.id}/hold/", {}, format="json")
    held = hr_client.get("/api/v1/payroll/payslips/?is_held=true")
    not_held = hr_client.get("/api/v1/payroll/payslips/?is_held=false")

    def ids(response):
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        return [row["id"] for row in rows]

    assert ids(held) == [payslip.id]
    assert payslip.id not in ids(not_held)
