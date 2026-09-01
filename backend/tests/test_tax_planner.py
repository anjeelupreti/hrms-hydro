"""The tax planner — projected tax, and what saving more would do to it.

**Why this could not exist a week ago.** A planner needs tax computed over a
year, contributions that reduce taxable income, and a relief rule that knows it
is the least of three. With per-period tax and no relief, "what would
contributing more save me?" answered "nothing" — which is wrong *and* useless.

The property worth defending most: **the optimum is real**. Relief is capped, so
past a point another rupee into CIT reduces take-home pay and saves no tax, and
nothing else in the product would tell somebody that.
"""

from decimal import Decimal

import pytest

from organization.models import CompanyProfile
from payroll.statutory import seed_statutory_rates, seed_tax_slabs

pytestmark = pytest.mark.django_db

URL = "/api/v1/payroll/tax-planner/"


def _fy(run):
    from core.calendars import company_calendar
    from payroll.periods import period_window

    _, period_end, _ = period_window(run)
    return company_calendar().fiscal_year_of(period_end)


def _prepared(company, payroll_setup, scheme=None):
    """A computed payslip to project from, with the statutory tables in place."""
    from payroll.services import compute_payslip

    fy = _fy(payroll_setup["run"])
    seed_statutory_rates(fy)
    seed_tax_slabs(fy)
    if scheme:
        profile = CompanyProfile.get_solo()
        profile.retirement_scheme = scheme
        profile.offers_cit = True
        profile.save()
    compute_payslip(payroll_setup["run"], payroll_setup["emp"])
    return fy


def test_without_a_payslip_it_says_so_rather_than_guessing(company, employee_client):
    """A confident figure projected from a structure that has never been run is
    exactly what this module exists not to produce."""
    response = employee_client.get(URL)

    assert response.status_code == 200
    assert response.data["available"] is False


def test_it_projects_the_year_from_the_latest_month(company, admin_client, payroll_setup):
    fy = _prepared(company, payroll_setup)

    response = admin_client.get(f"{URL}?fiscal_year={fy}")

    assert response.status_code == 200
    assert response.data["available"] is True
    # Twelve times the month, and it says which month — a projection nobody can
    # sanity-check is one nobody should act on.
    assert Decimal(response.data["annual_taxable"]) == Decimal(
        response.data["monthly_taxable"]
    ) * 12
    assert response.data["based_on"]["period_month"] == payroll_setup["run"].period_month


def test_contributing_more_to_cit_lowers_the_tax(company, admin_client, payroll_setup):
    """The whole question the planner exists to answer."""
    fy = _prepared(company, payroll_setup, CompanyProfile.RetirementScheme.SSF)

    plain = admin_client.get(f"{URL}?fiscal_year={fy}")
    with_extra = admin_client.get(f"{URL}?fiscal_year={fy}&extra_cit=5000")

    assert Decimal(with_extra.data["annual_tax_saved"]) > 0
    assert Decimal(with_extra.data["proposed"]["annual_tax"]) < Decimal(
        plain.data["current"]["annual_tax"]
    )


def test_past_the_cap_another_rupee_saves_nothing(company, admin_client, payroll_setup):
    """🔒 The number that makes this worth building.

    Relief is the least of three, so beyond the binding limit more contribution
    is pure reduction in take-home pay. Nothing else in the product says so.
    """
    fy = _prepared(company, payroll_setup, CompanyProfile.RetirementScheme.SSF)

    absurd = admin_client.get(f"{URL}?fiscal_year={fy}&extra_cit=900000")
    optimum = Decimal(absurd.data["optimum_monthly_cit"])

    at_optimum = admin_client.get(f"{URL}?fiscal_year={fy}&extra_cit={optimum}")
    beyond = admin_client.get(f"{URL}?fiscal_year={fy}&extra_cit={optimum + 20000}")

    # Past the optimum the tax stops moving, however much more goes in.
    assert Decimal(beyond.data["proposed"]["annual_tax"]) == Decimal(
        at_optimum.data["proposed"]["annual_tax"]
    )
    # And the relief itself has stopped growing.
    assert Decimal(beyond.data["proposed"]["relief"]) == Decimal(
        at_optimum.data["proposed"]["relief"]
    )


def test_the_relief_shown_is_the_one_payroll_uses(company, admin_client, payroll_setup):
    """🔒 The planner and the payslip must not come to different answers.

    The cap is found by asking `retirement_relief` itself rather than
    re-deriving the least-of-three here — a second implementation is how the
    two would drift, which is the failure this codebase has had three times.
    """
    from payroll.tax import retirement_relief

    fy = _prepared(company, payroll_setup, CompanyProfile.RetirementScheme.SSF)

    response = admin_client.get(f"{URL}?fiscal_year={fy}&extra_cit=2000")
    proposed = response.data["proposed"]

    expected = retirement_relief(
        Decimal(proposed["annual_contribution"]),
        Decimal(response.data["annual_taxable"]),
        fy,
        "ssf",
    )

    assert Decimal(proposed["relief"]) == expected


def test_a_negative_amount_is_refused(company, admin_client, payroll_setup):
    _prepared(company, payroll_setup)

    assert admin_client.get(f"{URL}?extra_cit=-500").status_code == 400


def test_it_answers_only_for_the_caller(company, employee_client, payroll_setup):
    """🔒 Somebody else's projected take-home is a picture of their salary.

    The endpoint takes no `?employee=` at all — passing one changes nothing,
    so there is no route to a colleague's projection even for HR.
    """
    response = employee_client.get(f"{URL}?employee={payroll_setup['emp'].id}")

    assert response.status_code == 200
    # The caller has no employee record of their own, so there is nothing to
    # project — rather than the requested person's figures.
    assert response.data["available"] is False
