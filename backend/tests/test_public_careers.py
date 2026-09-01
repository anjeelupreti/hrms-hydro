"""The one part of a workspace that strangers are meant to reach.

A careers page is the only company surface whose entire audience has no account
and never will, which makes it the only place where "who is asking" is not a
defence. Everything here is therefore about what an anonymous caller can see and
what they can cause.

Three independent conditions have to hold, and any one of them alone breaks the
page:

* **It was behind the login wall.** Every unauthenticated path on a workspace
  host redirected to `/login`, and nothing exempted `/careers` — while the
  marketing domain, which has no company and therefore no jobs, left it open.
  Public exactly where it could not work; private exactly where it could. That
  half lives in `proxy.ts`.
* **Archiving a role left it on the public board.** `status` and `archived_at`
  are independent, and a filled role is archived rather than reopened as
  something else — so a company could take a posting down and keep receiving
  applications for it.
* **"Apply Now" was wired to nothing.** A job board that cannot receive an
  application is a poster.
"""

from datetime import date

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from recruitment.models import Candidate, JobPosting

pytestmark = [pytest.mark.django_db]

JOBS = "/api/v1/recruitment/jobs/public/"
COMPANY = "/api/v1/recruitment/jobs/public-company/"


@pytest.fixture
def open_job(company):
    yield JobPosting.objects.create(
        title="Turbine Technician",
        status=JobPosting.Status.OPEN,
        location="Butwal",
        description="Maintain and inspect the units.",
    )


def test_a_stranger_can_read_the_board(api_client, company, open_job):
    """`api_client` is anonymous — company-resolved, not signed in."""
    response = api_client.get(JOBS)

    assert response.status_code == 200
    assert [j["title"] for j in response.data] == ["Turbine Technician"]


def test_a_draft_role_is_not_advertised(api_client, company, open_job):
    JobPosting.objects.create(title="Secret Role", status=JobPosting.Status.DRAFT)

    titles = [j["title"] for j in api_client.get(JOBS).data]

    assert "Secret Role" not in titles


def test_an_archived_role_leaves_the_board(api_client, company, open_job):
    """`status` and `archived_at` are independent, so the public board must test
    both — otherwise a role taken down keeps collecting applications."""
    JobPosting.objects.filter(pk=open_job.pk).update(archived_at=timezone.now())

    assert api_client.get(JOBS).data == []


def test_the_board_says_nothing_it_was_not_asked_to(api_client, company, open_job):
    """The fields are listed by hand rather than serialized, so a field added to
    the model later does not become public by default. This is the test that
    makes that decision hold."""
    row = api_client.get(JOBS).data[0]

    assert set(row) == {
        "id", "title", "department", "location", "employment_type", "description", "posted_on",
    }


def test_a_stranger_can_see_who_is_hiring(api_client, company):
    """A board that does not say whose jobs these are is not a board. It had no
    company name on it at all, because nothing unauthenticated could tell it one."""
    response = api_client.get(COMPANY)

    assert response.status_code == 200
    assert set(response.data) == {"name", "logo_url", "address"}


def test_the_company_endpoint_does_not_leak_the_rest_of_the_profile(api_client, company):
    """`CompanyProfile` also holds the PAN, the bank details and the SMTP
    password, and this answers anybody who asks.

    Checked against the **model's own field list** rather than a list of scary
    words: a substring scan over the response says "pan" appears in "company"
    and fails on a page that is perfectly safe. Comparing keys to the model
    means a field added next year is caught by this test on the day it is added,
    which a hand-written denylist cannot do.
    """
    from organization.models import CompanyProfile

    allowed = {"name", "logo_url", "address"}
    returned = set(api_client.get(COMPANY).data)
    assert returned == allowed

    model_fields = {f.name for f in CompanyProfile._meta.get_fields()}
    leaked = (returned - {"logo_url"}) & (model_fields - allowed)
    assert leaked == set(), leaked


# ── Applying ──────────────────────────────────────────────────────────────


def test_anybody_can_apply(api_client, company, open_job):
    response = api_client.post(
        f"/api/v1/recruitment/jobs/{open_job.pk}/apply/",
        {"name": "Asha Rai", "email": "asha@example.com", "phone": "9800000000"},
        format="multipart",
    )

    assert response.status_code == 201, response.data
    candidate = Candidate.objects.get(job=open_job)
    assert candidate.name == "Asha Rai"
    assert candidate.stage == Candidate.Stage.APPLIED


def test_an_applicant_cannot_place_themselves_in_the_pipeline(api_client, company, open_job):
    """The shape this endpoint exists to avoid.

    Bound to a serializer, an anonymous poster could put themselves at `offer`
    with five stars. `stage`, `rating` and `source` are set on the server, and
    the request's versions are ignored rather than validated — the only way to
    be sure is not to read them.
    """
    api_client.post(
        f"/api/v1/recruitment/jobs/{open_job.pk}/apply/",
        {
            "name": "Chancer",
            "email": "chancer@example.com",
            "stage": Candidate.Stage.OFFER,
            "rating": 5,
            "source": "Referral from the CEO",
        },
        format="multipart",
    )

    candidate = Candidate.objects.get(job=open_job)
    assert candidate.stage == Candidate.Stage.APPLIED
    assert candidate.rating is None
    assert candidate.source == "Careers page"


def test_applying_to_a_closed_role_is_refused(api_client, company):
    """A link kept from last month must not submit into a role nobody is
    hiring for. 404 rather than 403 — whether a closed job exists is not a
    stranger's business."""
    draft = JobPosting.objects.create(title="Not yet", status=JobPosting.Status.DRAFT)

    response = api_client.post(
        f"/api/v1/recruitment/jobs/{draft.pk}/apply/",
        {"name": "X", "email": "x@example.com"},
        format="multipart",
    )

    assert response.status_code == 404
    assert Candidate.objects.count() == 0


def test_applying_to_an_archived_role_is_refused(api_client, company, open_job):
    """The board hides it; the endpoint has to refuse it too. Hiding a door is
    not locking it."""
    JobPosting.objects.filter(pk=open_job.pk).update(archived_at=timezone.now())

    response = api_client.post(
        f"/api/v1/recruitment/jobs/{open_job.pk}/apply/",
        {"name": "X", "email": "x@example.com"},
        format="multipart",
    )

    assert response.status_code == 404


def test_a_name_and_an_email_are_required(api_client, company, open_job):
    """Without a way to reply, an application is not one."""
    response = api_client.post(
        f"/api/v1/recruitment/jobs/{open_job.pk}/apply/",
        {"name": "Nameless"},
        format="multipart",
    )

    assert response.status_code == 400


def test_an_oversized_attachment_is_refused(api_client, company, open_job):
    """An anonymous endpoint that accepts a file is free storage unless it says
    otherwise."""
    from recruitment.viewsets import MAX_RESUME_BYTES

    huge = SimpleUploadedFile(
        "cv.pdf", b"x" * (MAX_RESUME_BYTES + 1), content_type="application/pdf"
    )
    response = api_client.post(
        f"/api/v1/recruitment/jobs/{open_job.pk}/apply/",
        {"name": "Big", "email": "big@example.com", "resume": huge},
        format="multipart",
    )

    assert response.status_code == 400
    assert Candidate.objects.count() == 0


def test_an_application_reaches_the_hiring_board(api_client, hr_client, company, open_job):
    """The end of the thread: what a stranger posts is what HR sees. Two halves
    built at different times, and nothing had ever checked they met."""
    api_client.post(
        f"/api/v1/recruitment/jobs/{open_job.pk}/apply/",
        {"name": "Bimala Thapa", "email": "bimala@example.com"},
        format="multipart",
    )

    rows = hr_client.get(f"/api/v1/recruitment/candidates/?job={open_job.pk}").data["results"]

    assert [r["name"] for r in rows] == ["Bimala Thapa"]


def test_a_candidate_still_cannot_be_read_anonymously(api_client, company, open_job):
    """Applying is public; the pipeline is not. Somebody who applied must not be
    able to read who else did."""
    Candidate.objects.create(
        job=open_job, name="Private Person", email="p@example.com",
    )

    response = api_client.get("/api/v1/recruitment/candidates/")

    assert response.status_code in (401, 403)
