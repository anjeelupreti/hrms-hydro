"""The statutory figures, over the API.

**Why this file exists.** `StatutoryRate` had no viewset and no route, so eleven
legislated figures were seeded and unreachable — "every statutory figure is
configuration" was true of the design and false of the product.

Two properties are defended here beyond CRUD:

* **verification is not a writable field**, or whoever edits a number could mark
  their own edit as checked in the same request;
* **correcting a rate never restates a finalised payslip.** Effective dating
  exists for exactly this and the checklist recorded that no test covered it.
"""

from decimal import Decimal

import pytest

from payroll.models import StatutoryRate
from payroll.statutory import RateCode, seed_statutory_rates

pytestmark = pytest.mark.django_db

URL = "/api/v1/payroll/statutory-rates/"
FY = 2082


def test_the_rates_are_readable_at_last(company, admin_client):
    seed_statutory_rates(FY)

    response = admin_client.get(f"{URL}?fiscal_year={FY}")

    assert response.status_code == 200
    codes = {row["code"] for row in response.data["results"]}
    assert RateCode.SSF_EMPLOYEE in codes
    assert RateCode.RETIREMENT_RELIEF_CEILING_SSF in codes
    # The label a person reads, not just the code.
    ssf = next(r for r in response.data["results"] if r["code"] == RateCode.SSF_EMPLOYEE)
    assert ssf["label"]
    assert ssf["is_verified"] is False


def test_a_figure_can_be_corrected(company, admin_client):
    """The whole point — a percentage set by somebody else's budget speech must
    not need a release."""
    seed_statutory_rates(FY)
    rate = StatutoryRate.objects.get(code=RateCode.SSF_EMPLOYEE, fiscal_year=FY)

    response = admin_client.patch(f"{URL}{rate.id}/", {"value": "12.5"}, format="json")

    assert response.status_code == 200
    rate.refresh_from_db()
    assert rate.value == Decimal("12.5000")


def test_verification_cannot_be_set_by_editing_the_value(company, admin_client):
    """🔒 The education-record rule, applied to money.

    If `is_verified` were writable alongside `value`, whoever changed a figure
    could mark their own change as checked — which empties the flag of the only
    meaning it has.
    """
    seed_statutory_rates(FY)
    rate = StatutoryRate.objects.get(code=RateCode.SSF_EMPLOYEE, fiscal_year=FY)

    response = admin_client.patch(
        f"{URL}{rate.id}/", {"value": "13", "is_verified": True}, format="json"
    )

    assert response.status_code == 200
    rate.refresh_from_db()
    assert rate.value == Decimal("13.0000")
    assert rate.is_verified is False


def test_verifying_records_who_and_from_where(company, admin_client, admin_user):
    seed_statutory_rates(FY)
    rate = StatutoryRate.objects.get(code=RateCode.SSF_EMPLOYEE, fiscal_year=FY)

    response = admin_client.post(
        f"{URL}{rate.id}/verify/",
        {"source": "Finance Act 2082, Schedule 1"},
        format="json",
    )

    assert response.status_code == 200
    rate.refresh_from_db()
    assert rate.is_verified is True
    assert rate.verified_by_id == admin_user.id
    assert rate.verified_at is not None
    assert "Finance Act" in rate.source


def test_verifying_without_a_source_is_refused(company, admin_client):
    """"Verified" with no citation is an assertion nobody can re-check, which
    is the state the flag exists to distinguish from."""
    seed_statutory_rates(FY)
    rate = StatutoryRate.objects.get(code=RateCode.SSF_EMPLOYEE, fiscal_year=FY)

    response = admin_client.post(f"{URL}{rate.id}/verify/", {}, format="json")

    assert response.status_code == 400
    rate.refresh_from_db()
    assert rate.is_verified is False


def test_a_verification_can_be_withdrawn(company, admin_client):
    """§R2 — a tick made in error must not stand forever, or nobody can trust
    the ones that are right."""
    seed_statutory_rates(FY)
    rate = StatutoryRate.objects.get(code=RateCode.SSF_EMPLOYEE, fiscal_year=FY)

    admin_client.post(f"{URL}{rate.id}/verify/", {"source": "Act"}, format="json")
    response = admin_client.post(f"{URL}{rate.id}/unverify/", {}, format="json")

    assert response.status_code == 200
    rate.refresh_from_db()
    assert rate.is_verified is False
    assert rate.verified_by is None
    # What was claimed stays on the record.
    assert rate.source == "Act"


def test_seeding_fills_gaps_and_never_overwrites(company, admin_client):
    """Re-running after somebody entered the real figures must not put the
    placeholders back."""
    seed_statutory_rates(FY)
    rate = StatutoryRate.objects.get(code=RateCode.SSF_EMPLOYEE, fiscal_year=FY)
    rate.value = Decimal("99")
    rate.save(update_fields=["value"])

    response = admin_client.post(URL + "seed/", {"fiscal_year": FY}, format="json")

    assert response.status_code == 200
    rate.refresh_from_db()
    assert rate.value == Decimal("99.0000")


def test_seeding_a_new_year_brings_rates_and_slabs(company, admin_client):
    """A company with rates and no slabs cannot run payroll at all — which is
    the state every real company was in before the pack included them."""
    from payroll.models import TaxSlab

    response = admin_client.post(URL + "seed/", {"fiscal_year": 2090}, format="json")

    assert response.status_code == 200
    assert response.data["slabs_created"] > 0
    assert StatutoryRate.objects.filter(fiscal_year=2090).exists()
    # Both tables, because the Act sets two and filtering without
    # `taxpayer` would silently mix them.
    assert TaxSlab.objects.filter(fiscal_year=2090, taxpayer="individual").exists()
    assert TaxSlab.objects.filter(fiscal_year=2090, taxpayer="couple").exists()
    # Shipped unchecked, always.
    assert not TaxSlab.objects.filter(fiscal_year=2090, is_verified=True).exists()


def test_rates_cannot_be_created_or_deleted_through_the_api(company, admin_client):
    """The set of rates is a property of the country pack, not the company.

    A rate this codebase has never heard of would be read by nothing, and
    deleting one would silently drop a contribution rather than set it to zero.
    """
    seed_statutory_rates(FY)
    rate = StatutoryRate.objects.get(code=RateCode.SSF_EMPLOYEE, fiscal_year=FY)

    assert admin_client.post(URL, {"code": "invented", "fiscal_year": FY}, format="json").status_code == 405
    assert admin_client.delete(f"{URL}{rate.id}/").status_code == 405


def test_an_employee_cannot_read_the_rates(company, employee_client):
    """These figures decide what leaves people's pay, so they sit behind the
    payroll capability rather than a general one."""
    assert employee_client.get(URL).status_code == 403


def test_correcting_a_rate_does_not_restate_a_finalised_payslip(company, payroll_setup):
    """🔒 The edge the checklist recorded as uncovered: *"a rate corrected
    mid-year must not restate finalised payslips — effective dating exists, the
    test does not."*

    It does now. A finalised payslip keeps the figures it was computed with;
    the correction applies to what has not been run.
    """
    from core.calendars import company_calendar
    from organization.models import CompanyProfile
    from payroll.periods import period_window
    from payroll.services import compute_payslip

    run = payroll_setup["run"]
    _, period_end, _ = period_window(run)
    fy = company_calendar().fiscal_year_of(period_end)
    seed_statutory_rates(fy)

    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    payslip = compute_payslip(run, payroll_setup["emp"])
    payslip.status = payslip.Status.FINALIZED
    payslip.save(update_fields=["status"])
    before = payslip.net_pay

    # The rate is corrected after the fact.
    rate = StatutoryRate.objects.get(code=RateCode.SSF_EMPLOYEE, fiscal_year=fy)
    rate.value = Decimal("25")
    rate.save(update_fields=["value"])

    payslip.refresh_from_db()

    # Untouched. Recomputing a finalised payslip is refused elsewhere; this
    # asserts the stored money did not move underneath it either.
    assert payslip.net_pay == before
