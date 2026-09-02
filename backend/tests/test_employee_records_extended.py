"""Awards, disciplinary actions, post and role, and the two kinds of experience.

Three properties are worth pinning.

**What the company records *about* somebody, they may read.** An award nobody
can see is not recognition, and a disciplinary file the subject cannot open is
not due process. Both are readable by the person and writable only by HR, which
is a different rule from the next-of-kin lists that people maintain themselves.

**Post and role move independently.** That is the entire reason there are two
fields, so a test that only ever sets them together would pass with one.

**Previous employment and a post held here are the same six facts and different
provenance.** One is self-declared, the other is what this company knows.
"""

from datetime import date, timedelta

import pytest

from employees.models import (
    Award,
    CorporatePost,
    CorporateRole,
    DisciplinaryAction,
    Employee,
    EmployeeExperience,
)

pytestmark = pytest.mark.django_db

AWARDS = "/api/v1/employees/awards/"
ACTIONS = "/api/v1/employees/disciplinary-actions/"
POSTS = "/api/v1/employees/corporate-posts/"
ROLES = "/api/v1/employees/corporate-roles/"


@pytest.fixture
def worker(db, employee_user, company):
    return Employee.objects.create(
        user=employee_user,
        employee_code="EMP-X1",
        date_joined=date(2024, 1, 1),
        primary_company=company,
    )


# ── Post and role ────────────────────────────────────────────────────────


def test_post_and_role_are_set_and_read_independently(admin_client, worker):
    """Two Deputy Managers hold different roles, and somebody promoted out of
    Senior Engineer usually keeps running the same site."""
    post = CorporatePost.objects.create(name="Deputy Manager", code="DM", rank=4)
    role = CorporateRole.objects.create(name="Head, Electrical Maintenance", code="HEM")

    response = admin_client.patch(
        f"/api/v1/employees/employees/{worker.pk}/",
        {"corporate_post": post.pk, "corporate_role": role.pk},
        format="json",
    )
    assert response.status_code == 200, response.data

    detail = admin_client.get(f"/api/v1/employees/employees/{worker.pk}/")
    assert detail.data["corporate_post_name"] == "Deputy Manager"
    assert detail.data["corporate_role_name"] == "Head, Electrical Maintenance"

    # Promoted, same job.
    senior = CorporatePost.objects.create(name="Manager", code="MGR", rank=3)
    admin_client.patch(
        f"/api/v1/employees/employees/{worker.pk}/",
        {"corporate_post": senior.pk},
        format="json",
    )
    worker.refresh_from_db()
    assert worker.corporate_post == senior
    assert worker.corporate_role == role, "the role must not follow the post"


def test_posts_sort_by_seniority_not_alphabetically(admin_client):
    """Rank 1 is the top of the company, matching `Designation.rank`. A reader
    comparing the two lists must not have to remember which way each counts."""
    CorporatePost.objects.create(name="Assistant", code="AST", rank=9)
    CorporatePost.objects.create(name="Chief Executive", code="CEO", rank=1)

    response = admin_client.get(POSTS)

    names = [row["name"] for row in response.data["results"]]
    assert names == ["Chief Executive", "Assistant"]


def test_an_officer_cannot_invent_a_post(officer_client, officer_user):
    """Creating a new *kind of thing* is the admin's, everywhere."""
    from accounts.models import PermissionGrant
    from accounts.policy import Perm

    PermissionGrant.objects.get_or_create(user=officer_user, permission=Perm.SETTINGS_MANAGE)

    response = officer_client.post(POSTS, {"name": "Invented", "code": "INV"}, format="json")

    assert response.status_code == 403
    assert not CorporatePost.objects.filter(code="INV").exists()


def test_a_post_carries_its_headcount(admin_client, worker):
    post = CorporatePost.objects.create(name="Site Engineer", code="SE", rank=6)
    worker.corporate_post = post
    worker.save()

    response = admin_client.get(POSTS)

    row = next(r for r in response.data["results"] if r["code"] == "SE")
    assert row["employee_count"] == 1


# ── Awards ───────────────────────────────────────────────────────────────


def test_hr_records_an_award(admin_client, worker):
    response = admin_client.post(
        AWARDS,
        {
            "employee": worker.pk,
            "title": "Zero lost-time injuries, FY 2082",
            "kind": "safety",
            "awarded_on": str(date.today()),
            "awarded_by": "Board of Directors",
            "citation": "For an unbroken year without a reportable incident.",
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["kind_display"] == "Safety"


def test_somebody_sees_their_own_award(employee_client, worker):
    Award.objects.create(
        employee=worker, title="Long service, 10 years",
        kind=Award.Kind.LONG_SERVICE, awarded_on=date.today(),
    )

    response = employee_client.get(AWARDS)

    assert response.status_code == 200, response.data
    assert [row["title"] for row in response.data["results"]] == ["Long service, 10 years"]


def test_nobody_awards_themselves(employee_client, worker):
    response = employee_client.post(
        AWARDS,
        {"employee": worker.pk, "title": "Employee of the year", "awarded_on": str(date.today())},
        format="json",
    )

    assert response.status_code == 403
    assert Award.objects.count() == 0


def test_an_award_is_not_visible_to_a_colleague(employee_client, worker, hr_user, company):
    other = Employee.objects.create(
        user=hr_user, employee_code="EMP-X2",
        date_joined=date(2024, 1, 1), primary_company=company,
    )
    Award.objects.create(employee=other, title="Theirs", awarded_on=date.today())

    response = employee_client.get(AWARDS)

    assert response.data["results"] == []


# ── Disciplinary actions ─────────────────────────────────────────────────


def test_hr_issues_a_written_warning(admin_client, worker):
    response = admin_client.post(
        ACTIONS,
        {
            "employee": worker.pk,
            "subject": "Unauthorised absence, 12-14 Poush",
            "severity": "written",
            "incident_date": str(date.today() - timedelta(days=10)),
            "issued_on": str(date.today()),
            "expires_on": str(date.today() + timedelta(days=365)),
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["severity_display"] == "Written warning"
    assert response.data["is_current"] is True


def test_an_expired_warning_stops_counting(admin_client, worker):
    """A warning that never expires is a dismissal on the instalment plan."""
    action = DisciplinaryAction.objects.create(
        employee=worker,
        subject="Late three times",
        severity=DisciplinaryAction.Severity.VERBAL,
        incident_date=date.today() - timedelta(days=800),
        issued_on=date.today() - timedelta(days=790),
        expires_on=date.today() - timedelta(days=60),
    )

    response = admin_client.get(f"{ACTIONS}{action.pk}/")

    assert response.data["is_current"] is False


def test_an_overturned_action_stops_counting_whatever_its_expiry(admin_client, worker):
    action = DisciplinaryAction.objects.create(
        employee=worker,
        subject="Disputed",
        severity=DisciplinaryAction.Severity.FINAL,
        status=DisciplinaryAction.Status.OVERTURNED,
        incident_date=date.today(),
        issued_on=date.today(),
        expires_on=date.today() + timedelta(days=365),
    )

    response = admin_client.get(f"{ACTIONS}{action.pk}/")

    assert response.data["is_current"] is False


def test_somebody_can_read_the_file_kept_on_them(employee_client, worker):
    """A disciplinary file the subject cannot open is not due process."""
    DisciplinaryAction.objects.create(
        employee=worker, subject="Mine to see",
        severity=DisciplinaryAction.Severity.WRITTEN,
        incident_date=date.today(), issued_on=date.today(),
    )

    response = employee_client.get(ACTIONS)

    assert response.status_code == 200
    assert [r["subject"] for r in response.data["results"]] == ["Mine to see"]


def test_somebody_cannot_rewrite_the_file_kept_on_them(employee_client, worker):
    action = DisciplinaryAction.objects.create(
        employee=worker, subject="Standing",
        severity=DisciplinaryAction.Severity.WRITTEN,
        incident_date=date.today(), issued_on=date.today(),
    )

    response = employee_client.patch(
        f"{ACTIONS}{action.pk}/", {"status": "overturned"}, format="json"
    )

    assert response.status_code == 403
    action.refresh_from_db()
    assert action.status == DisciplinaryAction.Status.OPEN


def test_an_officer_may_work_a_case_but_not_open_or_delete_one(
    officer_client, officer_user, worker
):
    """The verb split, on a surface where it matters: an officer records what
    the employee said and moves the case along; issuing and expunging are the
    admin's."""
    action = DisciplinaryAction.objects.create(
        employee=worker, subject="Under review",
        severity=DisciplinaryAction.Severity.WRITTEN,
        incident_date=date.today(), issued_on=date.today(),
    )

    edited = officer_client.patch(
        f"{ACTIONS}{action.pk}/",
        {"employee_response": "Explained the delay at the intake."},
        format="json",
    )
    assert edited.status_code == 200, edited.data

    created = officer_client.post(
        ACTIONS,
        {
            "employee": worker.pk, "subject": "New", "severity": "verbal",
            "incident_date": str(date.today()), "issued_on": str(date.today()),
        },
        format="json",
    )
    assert created.status_code == 403

    removed = officer_client.delete(f"{ACTIONS}{action.pk}/")
    assert removed.status_code == 403


# ── Experience, in two kinds ─────────────────────────────────────────────


def test_experience_separates_what_we_know_from_what_we_were_told(admin_client, worker):
    EmployeeExperience.objects.create(
        employee=worker, kind=EmployeeExperience.Kind.PREVIOUS,
        title="Site Engineer", company="Chilime Hydropower",
        start_year=2019, end_year=2023,
    )
    EmployeeExperience.objects.create(
        employee=worker, kind=EmployeeExperience.Kind.INTERNAL,
        title="Senior Engineer", start_year=2024, is_verified=True,
    )

    response = admin_client.get(f"/api/v1/employees/employees/{worker.pk}/profile/")

    assert response.status_code == 200, response.data
    kinds = {e["title"]: e["kind"] for e in response.data["experiences"]}
    assert kinds == {"Site Engineer": "previous", "Senior Engineer": "internal"}


def test_a_previous_post_defaults_to_unverified(worker):
    """It is what somebody told us at interview until HR has seen a document."""
    entry = EmployeeExperience.objects.create(
        employee=worker, title="Engineer", company="Elsewhere", start_year=2020
    )

    assert entry.kind == EmployeeExperience.Kind.PREVIOUS
    assert entry.is_verified is False


# ── The contact fields ───────────────────────────────────────────────────


def test_the_office_and_personal_channels_are_kept_apart(admin_client, worker):
    """Collapsing them means offboarding either strands the record or publishes
    a private mobile in the staff directory."""
    response = admin_client.patch(
        f"/api/v1/employees/employees/{worker.pk}/",
        {
            "office_phone": "01-5970000",
            "office_email": "s.rai@company.com.np",
            "personal_phone": "9801234567",
            "personal_email": "sita.rai@gmail.com",
            "blood_group": "O+",
            "permanent_address": "Uttargaya-4, Rasuwa",
            "temporary_address": "Baluwatar, Kathmandu",
        },
        format="json",
    )

    assert response.status_code == 200, response.data
    worker.refresh_from_db()
    assert worker.office_email == "s.rai@company.com.np"
    assert worker.personal_email == "sita.rai@gmail.com"
    assert worker.blood_group == "O+"
    assert worker.permanent_address != worker.temporary_address


# ── Work history, from HR's side ─────────────────────────────────────────

EXPERIENCES = "/api/v1/employees/experiences/"


def test_hr_can_maintain_and_verify_somebody_elses_work_history(hr_client, worker):
    """🔒 The gap: `is_verified` could only be set by the person claiming it.

    Experience was reachable only through `accounts/experiences/`, which is
    strictly self-scoped. HR could read a work history in the profile payload
    and could not correct it, add the internal post it had just promoted
    somebody into, or tick the flag that exists precisely for HR to confirm a
    self-declared claim against a document.
    """
    made = hr_client.post(
        EXPERIENCES,
        {
            "employee": worker.pk,
            "kind": "previous",
            "title": "Site Engineer",
            "company": "Chilime Hydropower",
            "start_year": 2018,
            "end_year": 2021,
        },
        format="json",
    )
    assert made.status_code == 201
    assert made.data["is_verified"] is False

    verified = hr_client.patch(
        f"{EXPERIENCES}{made.data['id']}/", {"is_verified": True}, format="json"
    )
    assert verified.status_code == 200
    assert verified.data["is_verified"] is True

    # Audited, so a verification has somebody standing behind it.
    from employees.models import EmployeeExperience

    assert EmployeeExperience.objects.get(pk=made.data["id"]).updated_by is not None


def test_previous_and_internal_are_the_same_table_and_two_sections(hr_client, worker):
    """A post here and a job before here carry the same six facts, so `kind`
    is a field rather than a second table — but the reader sees two lists."""
    for kind, title in (("previous", "Graduate Engineer"), ("internal", "Senior Engineer")):
        assert hr_client.post(
            EXPERIENCES,
            {"employee": worker.pk, "kind": kind, "title": title, "start_year": 2019},
            format="json",
        ).status_code == 201

    rows = hr_client.get(f"{EXPERIENCES}?employee={worker.pk}").data["results"]
    assert {r["kind"] for r in rows} == {"previous", "internal"}
    assert hr_client.get(f"{EXPERIENCES}?employee={worker.pk}&kind=internal").data["count"] == 1


def test_a_post_cannot_end_before_it_started(hr_client, worker):
    response = hr_client.post(
        EXPERIENCES,
        {"employee": worker.pk, "kind": "previous", "title": "Impossible",
         "start_year": 2020, "end_year": 2015},
        format="json",
    )
    assert response.status_code == 400
    assert "end_year" in response.data


def test_an_officer_maintains_work_history_but_does_not_add_to_it(officer_client, hr_client, worker):
    """The verb rule, on one more record type: operate, do not create."""
    made = hr_client.post(
        EXPERIENCES,
        {"employee": worker.pk, "kind": "previous", "title": "Draughtsman",
         "start_year": 2015},
        format="json",
    )
    assert officer_client.patch(
        f"{EXPERIENCES}{made.data['id']}/", {"title": "Senior Draughtsman"}, format="json"
    ).status_code == 200
    assert officer_client.post(
        EXPERIENCES,
        {"employee": worker.pk, "kind": "previous", "title": "Nope", "start_year": 2010},
        format="json",
    ).status_code == 403
