"""Retirement and savings schemes — SSF, PF, CIT, gratuity.

**What these defend.** Before this module, none of the four were concepts the
system knew: `StatutoryRate` held the percentages and was read by nothing, and
the deduction that actually left somebody's pay was whatever a company had named
a `SalaryComponent`. So the tests that matter are:

* **additive** — a company that configures nothing computes exactly what it
  computed before, because anything else silently restates live payslips;
* **SSF xor PF** — the two deduct from the same base, so running both takes 21%
  of basic off somebody who owes 11% and the payslip looks entirely ordinary;
* **the year-to-date figure is trustworthy** — it survives a recompute, and it
  survives a company renaming their component, which is what a `PayslipLineItem`
  sum could never do.
"""

from decimal import Decimal

import pytest

from organization.models import CompanyProfile
from payroll.models import ContributionRecord, EmployeeSchemeEnrolment
from payroll.schemes import Scheme, company_schemes, contributions_for, totals_to_date

pytestmark = pytest.mark.django_db

#: The fiscal year `contributions_for` is *asked* about in the unit tests
#: below. The integration tests derive theirs from the run instead — see
#: `_run_fiscal_year`, and the reason is worth stating: the fixture's run is an
#: AD period on a Bikram Sambat company, so the fiscal year the engine records is
#: **not** the one a reader would guess from `period_year`.
FY = 2082


def _run_fiscal_year(run):
    """The fiscal year the engine will stamp, derived the way it derives it.

    Hardcoding a number here is how a test passes against a calendar it does
    not share with the code under test — which is the exact shape of D‑06.
    """
    from core.calendars import company_calendar
    from payroll.periods import period_window

    _, period_end, _ = period_window(run)
    return company_calendar().fiscal_year_of(period_end)


def _rates(fy=FY):
    from payroll.models import StatutoryRate

    for code, value in [
        ("ssf_employee", 11),
        ("ssf_employer", 20),
        ("pf_employee", 10),
        ("pf_employer", 10),
        ("gratuity", Decimal("8.33")),
    ]:
        StatutoryRate.objects.update_or_create(
            code=code, fiscal_year=fy, defaults={"value": Decimal(value)}
        )


def test_a_company_that_configures_nothing_contributes_nothing(company, payroll_setup):
    """🔒 The additive promise, and the reason nobody's payslip moves.

    Every existing company is in this state. If this returns rows, live payslips
    silently gain deductions nobody agreed to.
    """
    _rates()
    profile = CompanyProfile.get_solo()
    assert profile.retirement_scheme == ""

    assert contributions_for(payroll_setup["emp"], Decimal("50000"), FY) == []


def test_ssf_deducts_both_sides_off_basic(company, payroll_setup):
    """Basic, not gross — the single easiest figure to get wrong here, and
    every row of the rate registry says so."""
    _rates()
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    rows = contributions_for(payroll_setup["emp"], Decimal("50000"), FY)

    assert len(rows) == 1
    assert rows[0]["scheme"] == Scheme.SSF
    assert rows[0]["employee_amount"] == Decimal("5500.00")  # 11%
    assert rows[0]["employer_amount"] == Decimal("10000.00")  # 20%


def test_ssf_and_pf_cannot_both_run(company, payroll_setup):
    """🔒 The invalid state is unrepresentable rather than merely discouraged.

    One `CharField` choice, not two booleans — so "both" is a state the model
    cannot hold, and the note in the rate registry stops being a comment.
    """
    _rates()
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.PROVIDENT_FUND
    profile.save()

    rows = contributions_for(payroll_setup["emp"], Decimal("50000"), FY)

    schemes = {row["scheme"] for row in rows}
    assert schemes == {Scheme.PF}
    assert Scheme.SSF not in schemes


def test_gratuity_does_not_apply_on_top_of_ssf(company, payroll_setup):
    """SSF absorbs gratuity, so charging both is the SSF-plus-PF double-count
    one layer up — and the flag alone would let it happen."""
    _rates()
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.provides_gratuity = True
    profile.save()

    assert company_schemes(profile)["gratuity"] is False
    rows = contributions_for(payroll_setup["emp"], Decimal("50000"), FY)

    assert Scheme.GRATUITY not in {row["scheme"] for row in rows}


def test_gratuity_applies_to_a_non_ssf_employer(company, payroll_setup):
    _rates()
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.PROVIDENT_FUND
    profile.provides_gratuity = True
    profile.save()

    rows = {r["scheme"]: r for r in contributions_for(payroll_setup["emp"], Decimal("50000"), FY)}

    assert Scheme.GRATUITY in rows
    # Employer-only: the employee contributes nothing to gratuity.
    assert rows[Scheme.GRATUITY]["employee_amount"] == Decimal("0")
    assert rows[Scheme.GRATUITY]["employer_amount"] == Decimal("4165.00")


def test_cit_is_voluntary_and_per_person(company, payroll_setup):
    """SSF and PF are percentages set by law; how much somebody saves into CIT
    is their decision, made in rupees. So it comes only from an enrolment."""
    _rates()
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.offers_cit = True
    profile.save()

    emp = payroll_setup["emp"]
    # Offered, but this person has not chosen to contribute.
    assert Scheme.CIT not in {r["scheme"] for r in contributions_for(emp, Decimal("50000"), FY)}

    EmployeeSchemeEnrolment.objects.create(
        employee=emp, scheme=Scheme.CIT, monthly_amount=Decimal("3000")
    )
    rows = {r["scheme"]: r for r in contributions_for(emp, Decimal("50000"), FY)}

    assert rows[Scheme.CIT]["employee_amount"] == Decimal("3000")
    assert rows[Scheme.CIT]["employer_amount"] == Decimal("0")


def test_an_employee_can_sit_outside_the_company_scheme(company, payroll_setup):
    """A contract predating the scheme, or a foreign national outside the fund.

    Absence of a row means "follow the company" — requiring one per employee
    would make enabling a scheme a data-entry project whose half-done state
    silently under-deducts.
    """
    _rates()
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    emp = payroll_setup["emp"]
    assert len(contributions_for(emp, Decimal("50000"), FY)) == 1

    EmployeeSchemeEnrolment.objects.create(
        employee=emp, scheme=Scheme.SSF, is_active=False
    )
    assert contributions_for(emp, Decimal("50000"), FY) == []


def test_a_person_can_carry_a_grandfathered_rate(company, payroll_setup):
    """For the inherited arrangement, not as the normal path — which is why
    null means "use the statutory rate" rather than zero."""
    _rates()
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    emp = payroll_setup["emp"]
    EmployeeSchemeEnrolment.objects.create(
        employee=emp, scheme=Scheme.SSF, employee_rate=Decimal("5")
    )
    rows = contributions_for(emp, Decimal("50000"), FY)

    assert rows[0]["employee_amount"] == Decimal("2500.00")  # 5%, not 11%
    # The employer side still follows the statute — an employee's private
    # arrangement does not reduce what the company owes the fund.
    assert rows[0]["employer_amount"] == Decimal("10000.00")


# ── The figure this whole module exists for ──────────────────────────────────


def test_the_year_to_date_total_survives_a_recompute(company, payroll_setup):
    """🔒 `compute_payslip` is idempotent and reruns are ordinary.

    Appending instead of replacing would double somebody's year-to-date every
    time payroll was re-run — which is precisely the number this exists to make
    trustworthy.
    """
    from payroll.schemes import record_contributions
    from payroll.services import compute_payslip

    run = payroll_setup["run"]
    emp = payroll_setup["emp"]
    _rates(_run_fiscal_year(run))
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    payslip = compute_payslip(run, emp)
    first = ContributionRecord.objects.filter(payslip=payslip).count()

    compute_payslip(run, emp)
    again = ContributionRecord.objects.filter(payslip=payslip).count()

    assert first == again
    _ = record_contributions  # imported to document where the guarantee lives


def test_totals_are_keyed_on_the_scheme_not_a_component_name(company, payroll_setup):
    """The reason a `PayslipLineItem` sum could never answer this.

    A line item points at a company-named component, so renaming "Provident
    Fund" would lose the history. Renaming every component here changes
    nothing about the totals.
    """
    from payroll.models import SalaryComponent
    from payroll.services import compute_payslip

    fy = _run_fiscal_year(payroll_setup["run"])
    _rates(fy)
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    payslip = compute_payslip(payroll_setup["run"], payroll_setup["emp"])
    payslip.status = payslip.Status.FINALIZED
    payslip.save(update_fields=["status"])

    before = totals_to_date(payroll_setup["emp"], fy)

    SalaryComponent.objects.all().update(name="Renamed entirely")
    after = totals_to_date(payroll_setup["emp"], fy)

    assert before == after
    assert any(row["scheme"] == Scheme.SSF for row in after)


def test_draft_payslips_are_left_out_of_the_running_total(company, payroll_setup):
    """A draft is a calculation somebody may still throw away, and a
    year-to-date figure that moves when a draft is deleted is one nobody can
    reconcile against a fund deposit."""
    from payroll.services import compute_payslip

    fy = _run_fiscal_year(payroll_setup["run"])
    _rates(fy)
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    payslip = compute_payslip(payroll_setup["run"], payroll_setup["emp"])
    assert payslip.status == payslip.Status.DRAFT

    assert totals_to_date(payroll_setup["emp"], fy) == []

    payslip.status = payslip.Status.FINALIZED
    payslip.save(update_fields=["status"])
    assert totals_to_date(payroll_setup["emp"], fy) != []


def test_the_total_carries_both_sides(company, payroll_setup):
    """The employer contribution had nowhere to live at all — it is not a
    payslip deduction, so no line item could ever have held it."""
    from payroll.services import compute_payslip

    fy = _run_fiscal_year(payroll_setup["run"])
    _rates(fy)
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    payslip = compute_payslip(payroll_setup["run"], payroll_setup["emp"])
    payslip.status = payslip.Status.FINALIZED
    payslip.save(update_fields=["status"])

    rows = totals_to_date(payroll_setup["emp"], fy)

    ssf = next(r for r in rows if r["scheme"] == Scheme.SSF)
    assert ssf["employee_total"] > 0
    assert ssf["employer_total"] > 0
    assert ssf["total"] == ssf["employee_total"] + ssf["employer_total"]


# ── The double-count guard ───────────────────────────────────────────────────
#
# Turning the company scheme on while a hand-built component still deducts the
# same obligation charges it **twice**, off the same basic, and the payslip
# looks entirely ordinary. That hazard did not exist before the scheme config
# did — it is created by this feature, so it is guarded by it.


def _tagged_component(scheme, name="Provident Fund", code="pf_legacy"):
    from payroll.models import SalaryComponent

    return SalaryComponent.objects.create(
        code=code, name=name,
        component_type=SalaryComponent.ComponentType.DEDUCTION,
        calc_type=SalaryComponent.CalcType.FLAT,
        amount=Decimal("5000"), is_active=True, order=20, scheme=scheme,
    )


def test_enabling_a_scheme_is_refused_while_a_component_deducts_it(
    company, admin_client, payroll_setup
):
    """🔒 Caught at settings time, so it is an error somebody can act on rather
    than one discovered on run day."""
    _tagged_component(Scheme.PF)

    response = admin_client.patch(
        "/api/v1/organization/company-profile/",
        {"retirement_scheme": "pf"},
        format="json",
    )

    assert response.status_code == 400
    assert "twice" in str(response.data).lower()
    assert CompanyProfile.get_solo().retirement_scheme == ""


def test_a_component_for_a_different_scheme_does_not_block(
    company, admin_client, payroll_setup
):
    """A PF component is no reason to refuse SSF — they are different
    obligations, and over-blocking would make the guard the thing people
    work around."""
    _tagged_component(Scheme.PF)

    response = admin_client.patch(
        "/api/v1/organization/company-profile/",
        {"retirement_scheme": "ssf"},
        format="json",
    )

    assert response.status_code == 200


def test_an_untagged_component_never_blocks_on_its_name_alone(
    company, admin_client, payroll_setup
):
    """🔒 The heuristic suggests; it never acts.

    "PF Loan Repayment" contains "PF" and is not a contribution. Refusing
    payroll over a substring would be a worse bug than the one being
    prevented.
    """
    from payroll.models import SalaryComponent

    SalaryComponent.objects.create(
        code="pf_loan", name="PF Loan Repayment",
        component_type=SalaryComponent.ComponentType.DEDUCTION,
        calc_type=SalaryComponent.CalcType.FLAT,
        amount=Decimal("1000"), is_active=True, order=21,
    )

    response = admin_client.patch(
        "/api/v1/organization/company-profile/",
        {"retirement_scheme": "pf"},
        format="json",
    )

    assert response.status_code == 200


def test_the_suggestion_names_what_to_look_at(company, payroll_setup):
    """A company with fifty components should not have to find it themselves."""
    from payroll.models import SalaryComponent
    from payroll.schemes import describe_overlap

    _tagged_component(Scheme.PF)
    SalaryComponent.objects.create(
        code="old_pf", name="Old Provident Deduction",
        component_type=SalaryComponent.ComponentType.DEDUCTION,
        calc_type=SalaryComponent.CalcType.FLAT,
        amount=Decimal("1"), is_active=True, order=22,
    )

    message = describe_overlap(Scheme.PF)

    assert "Provident Fund" in message
    # The untagged one is offered as worth checking, not acted on.
    assert "Old Provident Deduction" in message


def test_payroll_refuses_rather_than_deducting_twice(company, payroll_setup):
    """🔒 The safety net, for a component created *after* the config was saved.

    Raised as a `PayrollConfigurationError` so it lands in the run's error list
    and blocks finalize — the D‑12 lesson. An unrecognised refusal would escape
    the task and leave the run stuck at PROCESSING with the reason only in
    Sentry.
    """
    import pytest as _pytest

    from payroll.services import PayrollConfigurationError, compute_payslip

    fy = _run_fiscal_year(payroll_setup["run"])
    _rates(fy)
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    # Created after the fact, so the settings-time guard never saw it.
    _tagged_component(Scheme.SSF, name="Legacy SSF", code="ssf_legacy")

    with _pytest.raises(PayrollConfigurationError, match="twice"):
        compute_payslip(payroll_setup["run"], payroll_setup["emp"])


# ── The choice is the owner's, and it can be paused ──────────────────────────


def test_a_fresh_company_has_no_scheme_chosen(company):
    """🔒 Which fund a company is on is the owner's decision, not a default.

    Seeding one would put the company on a programme nobody selected, and the
    contributions would start leaving people's pay on that basis.
    """
    profile = CompanyProfile.get_solo()

    assert profile.retirement_scheme == ""
    assert profile.offers_cit is False
    assert profile.provides_gratuity is False
    assert profile.retirement_paused is False


def test_the_demo_seed_does_not_choose_a_scheme_either(company):
    """The demo has to show the choice being made, not arriving pre-made — and
    a hand-built "Provident Fund" component would collide with the real
    mechanism the moment somebody switched a scheme on."""
    from payroll.models import SalaryComponent

    assert not SalaryComponent.objects.filter(code="provident_fund").exists()


def test_pausing_stops_contributions_without_forgetting_the_programme(
    company, payroll_setup
):
    """🔒 Paused and unenrolled are different facts.

    Clearing the scheme would lose which fund this company is on, and the
    year-to-date figures would have no programme to sit under when contributions
    resume.
    """
    _rates()
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()
    assert contributions_for(payroll_setup["emp"], Decimal("50000"), FY) != []

    profile.retirement_paused = True
    profile.save()

    config = company_schemes(profile)
    # Still an SSF company; simply not deducting this period.
    assert config["chosen"] == Scheme.SSF
    assert config["paused"] is True
    assert config["retirement"] is None
    assert contributions_for(payroll_setup["emp"], Decimal("50000"), FY) == []


def test_resuming_picks_the_same_programme_back_up(company, payroll_setup):
    _rates()
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.retirement_paused = True
    profile.save()
    assert contributions_for(payroll_setup["emp"], Decimal("50000"), FY) == []

    profile.retirement_paused = False
    profile.save()
    rows = contributions_for(payroll_setup["emp"], Decimal("50000"), FY)

    assert [r["scheme"] for r in rows] == [Scheme.SSF]


def test_pausing_does_not_turn_an_ssf_employer_into_a_gratuity_one(
    company, payroll_setup
):
    """Gratuity is judged on the *chosen* scheme. Otherwise pausing SSF for a
    month would start charging gratuity, which SSF exists to absorb."""
    _rates()
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.provides_gratuity = True
    profile.retirement_paused = True
    profile.save()

    assert company_schemes(profile)["gratuity"] is False
    assert contributions_for(payroll_setup["emp"], Decimal("50000"), FY) == []


def test_a_company_can_switch_programmes_and_keeps_both_histories(
    company, payroll_setup
):
    """A company migrating from PF to SSF has history in both, and each stays
    under the scheme it was actually paid into — which is the whole reason
    contributions are keyed on the scheme rather than on a component."""
    from payroll.models import ContributionRecord
    from payroll.services import compute_payslip

    fy = _run_fiscal_year(payroll_setup["run"])
    _rates(fy)
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.PROVIDENT_FUND
    profile.save()

    payslip = compute_payslip(payroll_setup["run"], payroll_setup["emp"])
    assert ContributionRecord.objects.filter(payslip=payslip, scheme=Scheme.PF).exists()

    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()
    payslip = compute_payslip(payroll_setup["run"], payroll_setup["emp"])

    # Recomputing this period replaces this period — the PF row for it goes,
    # because that period is now an SSF period. What is preserved across a
    # switch is other periods' history, not a duplicate of this one.
    assert ContributionRecord.objects.filter(payslip=payslip, scheme=Scheme.SSF).exists()
    assert not ContributionRecord.objects.filter(payslip=payslip, scheme=Scheme.PF).exists()


def test_pause_is_settable_over_the_api(company, admin_client):
    response = admin_client.patch(
        "/api/v1/organization/company-profile/",
        {"retirement_scheme": "ssf", "retirement_paused": True},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["retirement_scheme"] == "ssf"
    assert response.data["retirement_paused"] is True


# ── Enrolment and the year-to-date figure, over the API ──────────────────────

ENROL_URL = "/api/v1/payroll/scheme-enrolments/"
TOTALS_URL = "/api/v1/payroll/contributions/"


def test_an_enrolment_can_be_created_for_someone_who_differs(
    company, admin_client, payroll_setup
):
    response = admin_client.post(
        ENROL_URL,
        {"employee": payroll_setup["emp"].id, "scheme": "ssf", "is_active": False},
        format="json",
    )

    assert response.status_code == 201
    assert response.data["scheme_label"] == "Social Security Fund"


def test_cit_needs_an_amount_and_the_others_must_not_have_one(
    company, admin_client, payroll_setup
):
    """A setting that looks like it does something and does not is worse than
    no setting — an amount on an SSF row would be silently ignored."""
    emp = payroll_setup["emp"].id

    no_amount = admin_client.post(
        ENROL_URL, {"employee": emp, "scheme": "cit"}, format="json"
    )
    assert no_amount.status_code == 400
    assert "how much" in str(no_amount.data).lower()

    wrong_place = admin_client.post(
        ENROL_URL,
        {"employee": emp, "scheme": "ssf", "monthly_amount": "3000"},
        format="json",
    )
    assert wrong_place.status_code == 400
    assert "percentage" in str(wrong_place.data).lower()


def test_an_unknown_scheme_is_refused(company, admin_client, payroll_setup):
    """A typo would create a row that silently does nothing while reading as
    "enrolled" on screen."""
    response = admin_client.post(
        ENROL_URL,
        {"employee": payroll_setup["emp"].id, "scheme": "nonsense"},
        format="json",
    )

    assert response.status_code == 400


def test_the_totals_endpoint_answers_for_the_caller(company, employee_client):
    """An account with no employee record gets empty totals, not a crash — a
    portal asking for them should render."""
    response = employee_client.get(TOTALS_URL)

    assert response.status_code == 200
    assert response.data["schemes"] == []


def test_one_employee_cannot_read_anothers_contributions(
    company, employee_client, payroll_setup
):
    """🔒 What a colleague saves into CIT is a fact about their money, and the
    directory is not where anybody should learn it."""
    response = employee_client.get(f"{TOTALS_URL}?employee={payroll_setup['emp'].id}")

    assert response.status_code == 403


def test_the_totals_come_back_per_scheme_with_both_sides(
    company, admin_client, payroll_setup
):
    from payroll.services import compute_payslip

    fy = _run_fiscal_year(payroll_setup["run"])
    _rates(fy)
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    payslip = compute_payslip(payroll_setup["run"], payroll_setup["emp"])
    payslip.status = payslip.Status.FINALIZED
    payslip.save(update_fields=["status"])

    response = admin_client.get(
        f"{TOTALS_URL}?employee={payroll_setup['emp'].id}&fiscal_year={fy}"
    )

    assert response.status_code == 200
    ssf = next(r for r in response.data["schemes"] if r["scheme"] == "ssf")
    assert Decimal(ssf["employee_total"]) > 0
    # The employer side, which had nowhere to live before.
    assert Decimal(ssf["employer_total"]) > 0


REPORT_URL = "/api/v1/payroll/contribution-report/"


def test_the_company_report_totals_every_scheme(company, admin_client, payroll_setup):
    """What gets reconciled against the fund deposit — so it carries both sides
    added together, which is the figure that actually leaves the company."""
    from payroll.services import compute_payslip

    fy = _run_fiscal_year(payroll_setup["run"])
    _rates(fy)
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()

    payslip = compute_payslip(payroll_setup["run"], payroll_setup["emp"])
    payslip.status = payslip.Status.FINALIZED
    payslip.save(update_fields=["status"])

    response = admin_client.get(f"{REPORT_URL}?fiscal_year={fy}")

    assert response.status_code == 200
    ssf = next(r for r in response.data["totals"] if r["scheme"] == "ssf")
    assert Decimal(ssf["total"]) == Decimal(ssf["employee_total"]) + Decimal(
        ssf["employer_total"]
    )
    # And the per-person breakdown behind it, for the filing.
    assert response.data["people"][0]["employee_code"]


def test_draft_payslips_stay_out_of_the_company_report(
    company, admin_client, payroll_setup
):
    """A figure that moves when somebody deletes a draft cannot be reconciled
    against a payment that has already left the bank."""
    from payroll.services import compute_payslip

    fy = _run_fiscal_year(payroll_setup["run"])
    _rates(fy)
    profile = CompanyProfile.get_solo()
    profile.retirement_scheme = CompanyProfile.RetirementScheme.SSF
    profile.save()
    compute_payslip(payroll_setup["run"], payroll_setup["emp"])  # left DRAFT

    response = admin_client.get(f"{REPORT_URL}?fiscal_year={fy}")

    assert response.data["totals"] == []


def test_an_employee_cannot_read_the_company_report(company, employee_client):
    """🔒 A per-employee contribution list is a picture of what every colleague
    earns and saves — there is deliberately no "your own" fallback here."""
    assert employee_client.get(REPORT_URL).status_code == 403
