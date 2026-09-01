"""First-run readiness — what a new workspace still has to configure.

Two properties are being defended here, and neither is "the list is right".

**Nothing is a stored flag.** A check that still reads Done after somebody
deleted the salary structure is worse than no check, because it is believed.
Every assertion below therefore changes the *world* and re-reads, rather than
setting a field on a progress record.

**A must-have cannot be waved through.** The tier is the entire promise of this
screen, and a promise enforced by hiding a button is not enforced — so the skip
is attempted through the API, which is where somebody would actually get round
it.
"""

from datetime import date

import pytest

from organization.models import CompanyProfile, SetupSkip
from organization.setup import CHECKS, Tier, readiness

pytestmark = pytest.mark.django_db

URL = "/api/v1/organization/setup/"


def test_a_brand_new_workspace_is_honest_about_being_empty(company):
    """The screen this whole feature exists for.

    A fresh company has a placeholder company name and nothing else, and must
    not be told it is ready.
    """
    CompanyProfile.get_solo()  # materialise the placeholder, as provisioning does

    state = readiness()

    assert state["is_ready"] is False
    assert state["percent"] < 100
    assert state["must_done"] < state["must_total"]
    assert any(c["key"] == "company_named" for c in state["blocking"])


def test_the_placeholder_company_name_does_not_count_as_named(company):
    """`get_solo()` seeds "My Company", so a non-blank test would pass for
    exactly the company that has never opened the settings screen."""
    profile = CompanyProfile.get_solo()
    assert profile.name == "My Company"

    def named():
        return next(
            c for c in readiness()["tiers"]["must"] if c["key"] == "company_named"
        )["done"]

    assert named() is False

    profile.name = "Acme Pvt Ltd"
    profile.save(update_fields=["name"])
    assert named() is True


def test_a_check_goes_back_to_pending_when_the_thing_is_deleted(company):
    """🔒 The property that makes this trustworthy rather than decorative.

    A stored boolean would still say Done here, and the company would discover
    at payroll time that the thing it promised was gone.
    """
    from employees.models import Department


    def departments_done():
        return next(
            c for c in readiness()["tiers"]["must"] if c["key"] == "departments"
        )["done"]

    Department.objects.all().delete()
    assert departments_done() is False

    dept = Department.objects.create(name="Engineering")
    assert departments_done() is True

    dept.delete()
    assert departments_done() is False


def test_the_score_counts_must_haves_only(company):
    """A company who has done everything that stops them paying people correctly
    is ready. Reporting 71% because they have not uploaded a logo turns the one
    number that matters into decoration."""
    state = readiness()

    assert state["must_total"] == sum(1 for c in CHECKS if c.tier is Tier.MUST)
    # The optional tiers are reported, just not folded into the headline.
    assert state["optional_total"] > 0


def test_a_must_have_cannot_be_skipped_through_the_api(company, admin_client):
    """🔒 Guarded in the service, not by hiding the button.

    A tier whose entries can be waved through by a hand-written request is a
    recommendation wearing a badge.
    """
    response = admin_client.post(
        URL, {"key": "tax_slabs", "reason": "later"}, format="json"
    )

    assert response.status_code == 400
    assert "cannot be skipped" in str(response.data).lower()
    assert not SetupSkip.objects.filter(check_key="tax_slabs").exists()


def test_a_recommended_check_can_be_skipped_with_a_reason_and_undone(company, admin_client):
    """Skipping is a decision, not a failure — so it must not sit as a
    permanent red mark, and it must be reversible."""
    skipped = admin_client.post(
        URL, {"key": "logo", "reason": "no logo designed yet"}, format="json"
    )
    assert skipped.status_code == 200

    row = next(c for c in skipped.data["tiers"]["recommended"] if c["key"] == "logo")
    assert row["skipped"] is True
    assert row["skip_reason"] == "no logo designed yet"
    # Skipping is not doing. The distinction has to survive the round trip.
    assert row["done"] is False

    undone = admin_client.post(URL, {"key": "logo", "skip": False}, format="json")
    assert undone.status_code == 200
    row = next(c for c in undone.data["tiers"]["recommended"] if c["key"] == "logo")
    assert row["skipped"] is False
    assert not SetupSkip.objects.filter(check_key="logo").exists()


def test_a_skip_needs_a_reason(company, admin_client):
    """A skip with no reason is indistinguishable from an oversight three
    months later, to somebody who was not there."""
    response = admin_client.post(URL, {"key": "logo"}, format="json")

    assert response.status_code == 400
    assert "why" in str(response.data).lower()


def test_skipping_something_that_does_not_exist_is_refused(company, admin_client):
    response = admin_client.post(URL, {"key": "not_a_check", "reason": "x"}, format="json")

    assert response.status_code == 400


def test_an_employee_may_read_readiness_but_not_change_it(company, employee_client):
    """Reading is not a disclosure — they will notice when their payslip does
    not arrive — and hiding it means the one person who might mention it to HR
    cannot. Changing it is a settings act."""
    assert employee_client.get(URL).status_code == 200

    refused = employee_client.post(URL, {"key": "logo", "reason": "x"}, format="json")
    assert refused.status_code == 403


def test_advanced_checks_stay_quiet_for_companies_they_do_not_apply_to(company):
    """An Advanced check for a module nobody uses is a permanent red mark that
    teaches people to ignore the screen."""
    from attendance.policy import AttendancePolicy

    # No policy row at all: nobody has configured attendance, so asking
    # about biometric readers is noise.
    AttendancePolicy.objects.all().delete()
    assert "devices" not in [c["key"] for c in readiness()["tiers"]["advanced"]]

    policy = AttendancePolicy.get_solo()
    policy.allow_biometric = True
    policy.save(update_fields=["allow_biometric"])
    assert "devices" in [c["key"] for c in readiness()["tiers"]["advanced"]]


def test_becoming_ready_is_reachable(company):
    """The screen has to be finishable, and the test that says so is the one
    that stops a check being added that nothing can ever satisfy."""
    from core.calendars import fiscal_year_for
    from employees.models import Department, Designation
    from organization.models import CompanyEmailSettings
    from payroll.models import SalaryComponent, StatutoryRate, TaxSlab

    profile = CompanyProfile.get_solo()
    profile.name = "Acme Pvt Ltd"
    profile.working_days = [1, 2, 3, 4, 5]
    profile.save()

    mail = CompanyEmailSettings.get_solo()
    mail.host = "smtp.example.com"
    mail.from_email = "hr@example.com"
    mail.is_active = True
    mail.save()

    Department.objects.get_or_create(name="Engineering")
    Designation.objects.get_or_create(title="Engineer")
    SalaryComponent.objects.get_or_create(
        code="basic",
        defaults={
            "name": "Basic",
            "component_type": SalaryComponent.ComponentType.EARNING,
            "calc_type": SalaryComponent.CalcType.FLAT,
            "order": 1,
        },
    )

    fy = fiscal_year_for(date.today())
    if not TaxSlab.objects.filter(fiscal_year=fy).exists():
        TaxSlab.objects.create(
            fiscal_year=fy, order=1, min_amount=0, max_amount=500000, rate=1
        )
    if not StatutoryRate.objects.filter(fiscal_year=fy).exists():
        StatutoryRate.objects.create(
            fiscal_year=fy, code="ssf_employee", value=11
        )

    state = readiness()

    assert state["blocking"] == []
    assert state["is_ready"] is True
    assert state["percent"] == 100


def test_every_check_points_at_a_page_that_exists(company):
    """🔒 Every checklist destination is a page that exists.

    A setup checklist that sends somebody to a 404 is worse than one with no
    links at all: it turns "you still have to do this" into "this product is
    broken", on the screen a new workspace opens first.

    The destinations are verified against the Next.js router itself, so a route
    added or renamed on one side and not the other fails here rather than in
    front of a customer.
    """
    from pathlib import Path

    from organization.setup import CHECKS

    app_dir = Path(__file__).resolve().parents[2] / "frontend" / "app"
    if not app_dir.is_dir():
        pytest.skip("frontend not present next to the backend")

    missing = [
        check.href
        for check in CHECKS
        if not (app_dir / check.href.lstrip("/") / "page.tsx").is_file()
    ]

    assert missing == [], f"setup links with no page: {missing}"
