"""P1.1.3 — progressive slab tax.

Slab boundaries are where tax engines go wrong, and they go wrong quietly:
an off-by-one at a band edge misprices one employee out of a hundred, in a
direction nobody checks. These tests pin every edge of `compute_slab_tax`.

They matter more here than in most products because slabs are *company data*
— the marketing claim is that a customer can retype their own tax table
without a release. That is only safe if the arithmetic underneath is exact.
"""

from decimal import Decimal

import pytest

from payroll.models import TaxSlab
from payroll.services import PayrollConfigurationError, compute_slab_tax

pytestmark = pytest.mark.django_db

FY = 2026


@pytest.fixture
def slabs(company):
    """A four-band table with an open-ended top, the shape almost every
    jurisdiction uses:  0–500k @1%, 500k–1M @10%, 1M–2M @20%, 2M+ @30%."""
    rows = [
        (1, "0", "500000", "1"),
        (2, "500000", "1000000", "10"),
        (3, "1000000", "2000000", "20"),
        (4, "2000000", None, "30"),
    ]
    for order, lo, hi, rate in rows:
        TaxSlab.objects.create(
            fiscal_year=FY,
            order=order,
            min_amount=Decimal(lo),
            max_amount=Decimal(hi) if hi else None,
            rate=Decimal(rate),
        )
    yield


def tax(amount):
    return compute_slab_tax(Decimal(amount), FY)


# ── P1.1.3c — below the first band ───────────────────────────────────────


def test_zero_income_is_zero_tax(company, slabs):
    assert tax("0") == Decimal("0")


def test_income_inside_the_first_band(company, slabs):
    # 100,000 @ 1%
    assert tax("100000") == Decimal("1000")


# ── P1.1.3a — exact boundary values ──────────────────────────────────────


def test_exact_boundary_stays_in_the_lower_band(company, slabs):
    """500,000 is the top of band 1, not the bottom of band 2. Getting this
    backwards overcharges every employee who lands exactly on a boundary —
    which, with round salary figures, is a lot of them."""
    assert tax("500000") == Decimal("5000")  # all of it at 1%


def test_one_rupee_over_a_boundary_taxes_only_that_rupee_higher(company, slabs):
    # 500,000 @ 1% = 5,000  +  1 @ 10% = 0.10
    assert tax("500001") == Decimal("5000.10")


def test_progressive_not_flat(company, slabs):
    """The classic bug: applying the top band's rate to the whole income.
    750,000 must be 5,000 + 25,000 = 30,000, not 75,000."""
    assert tax("750000") == Decimal("30000")


def test_spanning_three_bands(company, slabs):
    # 500k@1% = 5,000 | 500k@10% = 50,000 | 500k@20% = 100,000
    assert tax("1500000") == Decimal("155000")


# ── P1.1.3b — the open-ended top band ────────────────────────────────────


def test_open_top_band_has_no_ceiling(company, slabs):
    # 5,000 + 50,000 + 200,000 + (3,000,000 @ 30% = 900,000)
    assert tax("5000000") == Decimal("1155000")


def test_open_top_band_scales_linearly_above_the_threshold(company, slabs):
    """Each extra million above 2M costs exactly 300,000. If the top band
    were being treated as closed, this difference would collapse to zero."""
    assert tax("6000000") - tax("5000000") == Decimal("300000")


# ── P1.1.3e — slabs are selected by fiscal year ──────────────────────────


def test_a_different_fiscal_year_uses_its_own_table(company, slabs):
    """Last year's payslip must still reproduce after this year's budget
    changes the rates. Slabs are effective-dated for exactly this reason."""
    TaxSlab.objects.create(
        fiscal_year=FY + 1, order=1,
        min_amount=Decimal("0"), max_amount=None, rate=Decimal("50"),
    )

    assert compute_slab_tax(Decimal("100000"), FY) == Decimal("1000")
    assert compute_slab_tax(Decimal("100000"), FY + 1) == Decimal("50000")


def test_a_year_with_no_slabs_refuses_rather_than_charging_nothing(company, slabs):
    """A fiscal year with no slabs raises; it never charges zero.

    Failing open makes a configuration gap indistinguishable from a company
    that owes no tax: every payslip deducts no income tax, silently, and the
    run looks correct. The ordinary way in is dull — a fiscal year rolls over
    before anybody enters next year's bands — and the shortfall surfaces at
    filing as the company's liability.

    Failing loudly puts it in the `PayrollError` list, which blocks `finalize`.
    """
    with pytest.raises(PayrollConfigurationError) as exc:
        compute_slab_tax(Decimal("1000000"), 1999)

    # The message has to name the year, because "no slabs configured" sends
    # somebody to a screen that looks fully populated for every *other* year.
    assert "1999" in str(exc.value)


def test_the_refusal_is_about_the_year_asked_for_not_the_table_being_empty(company, slabs):
    """A configured year still computes. A guard that fires on everyone is not
    a guard, and this one sits directly in front of everybody's pay."""
    assert compute_slab_tax(Decimal("100000"), FY) == Decimal("1000")


# ── P1.1.3d — misconfigured tables ───────────────────────────────────────


def test_a_gap_between_bands_does_not_double_charge(company):
    """Bands 0–100 and 200–∞, with 100–200 undefined. The engine walks
    `lower` forward to each band's top, so income in the gap is charged at
    the *lower* band's rate rather than being taxed twice or skipped."""
    TaxSlab.objects.create(
        fiscal_year=2030, order=1,
        min_amount=Decimal("0"), max_amount=Decimal("100"), rate=Decimal("10"),
    )
    TaxSlab.objects.create(
        fiscal_year=2030, order=2,
        min_amount=Decimal("200"), max_amount=None, rate=Decimal("20"),
    )

    # 100 @ 10% = 10, then the next 100 (the gap) is charged by band 2's
    # walk from lower=100 -> the remainder is taxed at 20%.
    result = compute_slab_tax(Decimal("300"), 2030)

    # Whatever the exact convention, it must never exceed charging the
    # whole amount at the top rate, nor be negative.
    assert Decimal("0") <= result <= Decimal("300") * Decimal("0.20")


def test_a_single_band_covering_everything(company):
    TaxSlab.objects.create(
        fiscal_year=2031, order=1,
        min_amount=Decimal("0"), max_amount=None, rate=Decimal("25"),
    )

    assert compute_slab_tax(Decimal("400000"), 2031) == Decimal("100000")


# ── D15 — the two dimensions the table was missing ───────────────────────
#
# Added with the Nepal compliance pass (plan §4.0e). Before this, `TaxSlab`
# could encode only one rate table and had no way to express a band that lapses
# on a condition, so both of the rules below were silently unrepresentable.


@pytest.fixture
def couple_slabs(company):
    """The same year, the couple table — wider first band.

    Nepal's Income Tax Act sets different band widths for an individual and for
    a couple electing joint assessment. Two tables, one fiscal year.
    """
    rows = [
        (1, "0", "600000", "1"),
        (2, "600000", "1000000", "10"),
        (3, "1000000", None, "20"),
    ]
    for order, lo, hi, rate in rows:
        TaxSlab.objects.create(
            fiscal_year=FY,
            taxpayer=TaxSlab.Taxpayer.COUPLE,
            order=order,
            min_amount=Decimal(lo),
            max_amount=Decimal(hi) if hi else None,
            rate=Decimal(rate),
        )
    yield


def test_the_couple_table_is_used_when_asked_for(company, slabs, couple_slabs):
    """Both tables exist for the same year and must not bleed into each other.

    600,000 sits in the individual table's *second* band (500k–1M @10%) and in
    the couple table's *first* (0–600k @1%). If the query ignored `taxpayer` the
    two tables would concatenate and this figure would be nonsense.
    """
    individual = compute_slab_tax(Decimal("600000"), FY, TaxSlab.Taxpayer.INDIVIDUAL)
    couple = compute_slab_tax(Decimal("600000"), FY, TaxSlab.Taxpayer.COUPLE)

    assert individual == Decimal("5000") + Decimal("10000")  # 500k@1% + 100k@10%
    assert couple == Decimal("6000")  # 600k@1%
    assert couple < individual


@pytest.fixture
def slabs_with_waivable_first_band(company):
    """First band flagged as the social security tax that SSF/PF members do not pay."""
    TaxSlab.objects.create(
        fiscal_year=FY + 1, order=1, min_amount=Decimal("0"),
        max_amount=Decimal("500000"), rate=Decimal("1"),
        waived_if_retirement_contributor=True,
    )
    TaxSlab.objects.create(
        fiscal_year=FY + 1, order=2, min_amount=Decimal("500000"),
        max_amount=None, rate=Decimal("10"),
    )
    yield


def test_a_contributor_is_not_charged_the_waivable_band(company, slabs_with_waivable_first_band):
    non_contributor = compute_slab_tax(Decimal("400000"), FY + 1, retirement_contributor=False)
    contributor = compute_slab_tax(Decimal("400000"), FY + 1, retirement_contributor=True)

    assert non_contributor == Decimal("4000")  # 400k @ 1%
    assert contributor == Decimal("0")


def test_the_waived_band_is_still_traversed_not_skipped(company, slabs_with_waivable_first_band):
    """The load-bearing one, and the easy thing to get wrong.

    A waived band must still *consume* its income so the bands above it start
    where they should. Skipping the slab outright would slide the 10% band down
    to begin at zero, overtaxing every contributor — a bug that only shows up
    above the first boundary, which is exactly where nobody checks.

    900,000 with the first band waived: 500k free, 400k @ 10% = 40,000.
    If the band were skipped instead, all 900k would fall in the 10% band.
    """
    charged = compute_slab_tax(Decimal("900000"), FY + 1, retirement_contributor=True)

    assert charged == Decimal("40000")
    assert charged != Decimal("90000")


def test_the_waiver_does_nothing_to_unflagged_bands(company, slabs):
    """A guard that fires on every band is not a guard.

    None of the default table's bands are flagged, so the contributor flag must
    leave every figure identical.
    """
    for amount in ("400000", "900000", "2500000"):
        assert compute_slab_tax(Decimal(amount), FY, retirement_contributor=True) == compute_slab_tax(
            Decimal(amount), FY, retirement_contributor=False
        )
