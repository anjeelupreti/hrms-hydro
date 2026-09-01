"""P1.1.5 — the golden month.

A frozen, hand-derived payroll run. Every expected figure below was worked
out independently of the engine and the arithmetic is shown, so a human — an
accountant at P3.1, or you in six months — can check it without reading
`services.py`.

This is the regression net the whole engine sits on. The other payroll tests
each pin one rule; this pins all of them interacting at once, which is where
real payroll bugs live. If a refactor changes any number here, it changed
somebody's pay.

**Determinism matters.** Nothing here may depend on today's date. That rules
out `activate_loan`, which stamps a structure version with `date.today()` and
would silently re-prorate the month depending on when the suite runs — the
loan below is assigned as an ordinary dated component instead.

Scenario: August 2026 (31 days), proration ON.

Components, in evaluation order:
    1 BASIC      flat, earning, per employee
    2 HRA        40% of BASIC, earning
    3 TRANSPORT  flat 3,100, earning
    4 PF         10% of BASIC, deduction
    5 TAX        slab-based on gross, deduction
    6 LOAN       flat 2,500, deduction (only E7)

Tax slabs (FY 2026). **Stored annual, as published figures are** — the engine
annualises the period's taxable pay, applies the bands, and divides back down
(`payroll/tax.py`). The bands below are therefore twelve times the monthly
figures this file used to carry, which leaves every hand-worked expectation
below **numerically identical**: a person on 73,100 a month is on 877,200 a
year, and 877,200 against the annual bands divided by twelve is the same 2,310
that 73,100 against the monthly bands used to give.

That equivalence is the point of scaling the fixture rather than re-deriving
the table: the arithmetic these cases were written to pin is unchanged, and
only the semantics they run under have been corrected.

        0 –   600,000   0%
  600,000 – 1,200,000  10%
1,200,000 –       ∞    20%
"""

from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from core.calendars import company_calendar
from employees.models import Department, Designation, Employee
from organization.models import CompanyProfile
from payroll.models import PayrollRun, SalaryComponent, TaxSlab
from payroll.services import _upsert_structure_version, compute_payslip

pytestmark = pytest.mark.django_db

User = get_user_model()

D = Decimal

# ── The frozen expectations ──────────────────────────────────────────────
#
# key: (basic, joined_day, has_loan) -> expected figures
#
# Worked by hand. HRA = 0.40 x BASIC. TRANSPORT = 3,100. PF = 0.10 x BASIC.
# Gross = BASIC + HRA + TRANSPORT. Tax is progressive over the *annualised*
# taxable earnings, then divided back to the period.
# Proration multiplies the two FLAT *earnings* (BASIC, TRANSPORT) only —
# percentage components follow automatically, flat deductions do not.

GOLDEN = {
    # ── full month, standard case ────────────────────────────────────────
    # BASIC 50,000 | HRA 20,000 | TRANS 3,100      -> gross 73,100
    # PF 5,000 | TAX (73,100-50,000)*0.10 = 2,310  -> ded 7,310
    "standard": {
        "basic": D("50000"), "joined": date(2026, 1, 1), "loan": False,
        "payable_days": 31,
        "gross": D("73100.00"), "deductions": D("7310.00"), "net": D("65790.00"),
        "lines": {"GBASIC": D("50000.00"), "GHRA": D("20000.00"), "GTRANS": D("3100.00"),
                  "GPF": D("5000.00"), "GTAX": D("2310.00")},
    },
    # ── under the tax threshold entirely ─────────────────────────────────
    # BASIC 30,000 | HRA 12,000 | TRANS 3,100      -> gross 45,100 (< 50,000)
    # PF 3,000 | TAX 0                             -> ded 3,000
    "below_threshold": {
        "basic": D("30000"), "joined": date(2026, 1, 1), "loan": False,
        "payable_days": 31,
        "gross": D("45100.00"), "deductions": D("3000.00"), "net": D("42100.00"),
        "lines": {"GBASIC": D("30000.00"), "GHRA": D("12000.00"), "GTRANS": D("3100.00"),
                  "GPF": D("3000.00"), "GTAX": D("0.00")},
    },
    # ── reaches the top band ─────────────────────────────────────────────
    # BASIC 100,000 | HRA 40,000 | TRANS 3,100     -> gross 143,100
    # TAX = 0 (first 50k) + 50,000*0.10 = 5,000 + 43,100*0.20 = 8,620 = 13,620
    # PF 10,000                                    -> ded 23,620
    "top_band": {
        "basic": D("100000"), "joined": date(2026, 1, 1), "loan": False,
        "payable_days": 31,
        "gross": D("143100.00"), "deductions": D("23620.00"), "net": D("119480.00"),
        "lines": {"GBASIC": D("100000.00"), "GHRA": D("40000.00"), "GTRANS": D("3100.00"),
                  "GPF": D("10000.00"), "GTAX": D("13620.00")},
    },
    # ── mid-month joiner: 16 Aug, so 16 of 31 days ───────────────────────
    # Chosen so proration lands exactly: 62,000 * 16/31 = 32,000
    #                                     3,100 * 16/31 =  1,600
    # HRA = 0.40 * 32,000 = 12,800                 -> gross 46,400 (< 50,000)
    # PF = 0.10 * 32,000 = 3,200 | TAX 0           -> ded 3,200
    "mid_month_joiner": {
        "basic": D("62000"), "joined": date(2026, 8, 16), "loan": False,
        "payable_days": 16,
        "gross": D("46400.00"), "deductions": D("3200.00"), "net": D("43200.00"),
        "lines": {"GBASIC": D("32000.00"), "GHRA": D("12800.00"), "GTRANS": D("1600.00"),
                  "GPF": D("3200.00"), "GTAX": D("0.00")},
    },
    # ── gross lands exactly on the 50,000 boundary ───────────────────────
    # 33,500 + 13,400 + 3,100 = 50,000 exactly.
    # The boundary belongs to the LOWER band, so tax is 0, not 0.01.
    "exact_boundary": {
        "basic": D("33500"), "joined": date(2026, 1, 1), "loan": False,
        "payable_days": 31,
        "gross": D("50000.00"), "deductions": D("3350.00"), "net": D("46650.00"),
        "lines": {"GBASIC": D("33500.00"), "GHRA": D("13400.00"), "GTRANS": D("3100.00"),
                  "GPF": D("3350.00"), "GTAX": D("0.00")},
    },
    # ── 14 rupees over the boundary ──────────────────────────────────────
    # 33,510 + 13,404 + 3,100 = 50,014 -> only the 14 is taxed: 14*0.10 = 1.40
    # PF 3,351                                     -> ded 3,352.40
    "just_over_boundary": {
        "basic": D("33510"), "joined": date(2026, 1, 1), "loan": False,
        "payable_days": 31,
        "gross": D("50014.00"), "deductions": D("3352.40"), "net": D("46661.60"),
        "lines": {"GBASIC": D("33510.00"), "GHRA": D("13404.00"), "GTRANS": D("3100.00"),
                  "GPF": D("3351.00"), "GTAX": D("1.40")},
    },
    # ── carrying a loan repayment ────────────────────────────────────────
    # BASIC 40,000 | HRA 16,000 | TRANS 3,100      -> gross 59,100
    # PF 4,000 | TAX (59,100-50,000)*0.10 = 910 | LOAN 2,500 -> ded 7,410
    "with_loan": {
        "basic": D("40000"), "joined": date(2026, 1, 1), "loan": True,
        "payable_days": 31,
        "gross": D("59100.00"), "deductions": D("7410.00"), "net": D("51690.00"),
        "lines": {"GBASIC": D("40000.00"), "GHRA": D("16000.00"), "GTRANS": D("3100.00"),
                  "GPF": D("4000.00"), "GTAX": D("910.00"), "GLOAN": D("2500.00")},
    },
}


@pytest.fixture
def golden_month(company, admin_user):
    profile = CompanyProfile.get_solo()
    profile.payroll_prorate = True
    profile.save()

    # Keyed on the fiscal year the *company* is in, derived the way the
    # service derives it. This said `fiscal_year=2026` and passed only
    # because `compute_payslip` was handing the slab lookup the period's
    # year instead of the fiscal year (D-06). The company here keeps Bikram
    # Sambat books, so its slabs live under 2083, and a test that seeds
    # 2026 is asserting a table no real company would have.
    slab_year = company_calendar().fiscal_year_of(date(2026, 8, 31))
    for order, (lo, hi, rate) in enumerate(
        # Annual bands: the monthly figures this file used to carry, x12.
        [("0", "600000", "0"), ("600000", "1200000", "10"), ("1200000", None, "20")],
        start=1,
    ):
        TaxSlab.objects.create(
            fiscal_year=slab_year, order=order,
            min_amount=D(lo), max_amount=D(hi) if hi else None, rate=D(rate),
        )

    dept = Department.objects.create(name="Golden", code="GOLD")
    desig = Designation.objects.create(title="Staff", department=dept)

    basic = SalaryComponent.objects.create(
        code="GBASIC", name="Basic", component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.FLAT, amount=D("0"), is_active=True, order=1,
    )
    hra = SalaryComponent.objects.create(
        code="GHRA", name="House rent", component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.PERCENTAGE_OF, percentage_of=basic,
        amount=D("40"), is_active=True, order=2,
    )
    transport = SalaryComponent.objects.create(
        code="GTRANS", name="Transport", component_type=SalaryComponent.ComponentType.EARNING,
        calc_type=SalaryComponent.CalcType.FLAT, amount=D("3100"), is_active=True, order=3,
    )
    pf = SalaryComponent.objects.create(
        code="GPF", name="Provident fund", component_type=SalaryComponent.ComponentType.DEDUCTION,
        calc_type=SalaryComponent.CalcType.PERCENTAGE_OF, percentage_of=basic,
        amount=D("10"), is_active=True, order=4,
    )
    tax = SalaryComponent.objects.create(
        code="GTAX", name="Income tax", component_type=SalaryComponent.ComponentType.DEDUCTION,
        calc_type=SalaryComponent.CalcType.SLAB_BASED, is_active=True, order=5,
    )
    loan = SalaryComponent.objects.create(
        code="GLOAN", name="Loan repayment", component_type=SalaryComponent.ComponentType.DEDUCTION,
        calc_type=SalaryComponent.CalcType.FLAT, amount=D("2500"), is_active=True, order=6,
    )

    run = PayrollRun.objects.create(
        period_calendar="AD", period_year=2026, period_month=8, status=PayrollRun.Status.DRAFT,
        created_by=admin_user,
    )

    employees = {}
    # Indexed codes: employee_code is varchar(20) and the scenario keys
    # overflow it ("GOLD-MID_MONTH_JOINER" is 21 characters).
    for index, (key, spec) in enumerate(GOLDEN.items(), start=1):
        user = User.objects.create_user(
            username=f"gold_{key}", email=f"gold_{key}@t.test", password="pw",
            role=User.Role.EMPLOYEE,
        )
        employee = Employee.objects.create(
            user=user, employee_code=f"GOLD-{index:02d}",
            date_joined=spec["joined"], department=dept, designation=desig,
        )
        pairs = [
            (basic, spec["basic"]), (hra, D("40")), (transport, D("3100")),
            (pf, D("10")), (tax, None),
        ]
        if spec["loan"]:
            pairs.append((loan, D("2500")))
        # effective_from == date_joined so the proration window is fully
        # determined by the scenario, never by when the test runs.
        _upsert_structure_version(employee, spec["joined"], pairs, notes="golden")
        employees[key] = employee

    # An eighth employee with no structure at all — the run must still
    # complete and produce a zero payslip rather than raising.
    unset_user = User.objects.create_user(
        username="gold_unset", email="gold_unset@t.test", password="pw",
        role=User.Role.EMPLOYEE,
    )
    employees["no_structure"] = Employee.objects.create(
        user=unset_user, employee_code="GOLD-UNSET",
        date_joined=date(2026, 1, 1), department=dept, designation=desig,
    )

    return {"run": run, "employees": employees}


@pytest.mark.parametrize("key", list(GOLDEN))
def test_golden_month_totals(company, golden_month, key):
    """Headline figures per employee, against hand-derived constants."""
    spec = GOLDEN[key]
    payslip = compute_payslip(golden_month["run"], golden_month["employees"][key])

    assert payslip.period_days == 31
    assert payslip.payable_days == spec["payable_days"]
    assert payslip.gross_earnings == spec["gross"]
    assert payslip.total_deductions == spec["deductions"]
    assert payslip.net_pay == spec["net"]


@pytest.mark.parametrize("key", list(GOLDEN))
def test_golden_month_line_items(company, golden_month, key):
    """Every individual component, not just the totals — a compensating pair
    of errors would pass the totals check and fail this one."""
    spec = GOLDEN[key]
    payslip = compute_payslip(golden_month["run"], golden_month["employees"][key])

    actual = {li.component_code: li.amount for li in payslip.line_items.all()}

    assert actual == spec["lines"]


@pytest.mark.parametrize("key", list(GOLDEN))
def test_golden_month_reconciles(company, golden_month, key):
    payslip = compute_payslip(golden_month["run"], golden_month["employees"][key])

    earnings = sum(
        li.amount for li in payslip.line_items.filter(component_type="earning")
    )
    deductions = sum(
        li.amount for li in payslip.line_items.filter(component_type="deduction")
    )

    assert earnings == payslip.gross_earnings
    assert deductions == payslip.total_deductions
    assert payslip.gross_earnings - payslip.total_deductions == payslip.net_pay


def test_the_whole_run_completes_including_the_unconfigured_employee(
    company, golden_month
):
    """One employee with no salary structure must not stop the other seven
    from being paid."""
    payslips = {
        key: compute_payslip(golden_month["run"], employee)
        for key, employee in golden_month["employees"].items()
    }

    assert len(payslips) == len(GOLDEN) + 1
    assert payslips["no_structure"].net_pay == D("0")
    assert payslips["no_structure"].line_items.count() == 0
    # And the rest are unaffected by their unconfigured colleague.
    assert payslips["standard"].net_pay == GOLDEN["standard"]["net"]


def test_the_run_total_is_the_sum_of_its_payslips(company, golden_month):
    """What finance actually cares about: the payroll cost of the month."""
    total = sum(
        compute_payslip(golden_month["run"], employee).net_pay
        for employee in golden_month["employees"].values()
    )

    expected = sum(spec["net"] for spec in GOLDEN.values())
    assert total == expected
    # Stated absolutely as well, so a change to any single scenario has
    # to be acknowledged here too rather than cancelling out.
    assert total == D("415571.60")


def test_recomputing_the_whole_month_is_stable(company, golden_month):
    """Idempotency across the full run — HR reruns after fixing one person's
    structure and everyone else's figures must not move."""
    first = {
        key: compute_payslip(golden_month["run"], employee).net_pay
        for key, employee in golden_month["employees"].items()
    }
    second = {
        key: compute_payslip(golden_month["run"], employee).net_pay
        for key, employee in golden_month["employees"].items()
    }

    assert first == second
