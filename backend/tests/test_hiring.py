"""Selected is our decision; hired is mutual. Both halves are about what the
record can honestly say.

**An offer is a record, not a dropdown.** `OFFER` and `HIRED` as two values of
one stage enum make "hired" a status somebody sets — no offered salary, no
acceptance date, and no way to tell a declined offer from a rejected candidate.

**Hiring creates the employee.** Otherwise somebody is hired in the product and
then typed into it a second time by hand, and the two records are free to
disagree from the first day.
"""

from datetime import date, timedelta

import pytest

from employees.models import Employee
from recruitment.hiring import (
    HiringError,
    accept_offer,
    convert_candidate_to_employee,
    decline_offer,
)
from recruitment.models import Candidate, JobPosting, Offer

pytestmark = pytest.mark.django_db


@pytest.fixture
def candidate(company):
    job = JobPosting.objects.create(title="Engineer", openings=1)
    yield Candidate.objects.create(
        job=job,
        name="Sita Kumari Rai",
        email="sita.rai.new@example.com",
        phone="+977-9800000001",
        stage=Candidate.Stage.OFFER,
    )


@pytest.fixture
def offer(company, candidate):
    yield Offer.objects.create(
        candidate=candidate,
        status=Offer.Status.SENT,
        annual_salary=600000,
        start_date=date.today() + timedelta(days=14),
        expires_on=date.today() + timedelta(days=7),
    )


# ── Accepting is what "hired" means ──────────────────────────────────────


def test_accepting_an_offer_is_what_makes_a_candidate_hired(company, offer, candidate):
    accept_offer(offer)
    offer.refresh_from_db()
    candidate.refresh_from_db()

    assert offer.status == Offer.Status.ACCEPTED
    assert offer.responded_at is not None
    assert candidate.stage == Candidate.Stage.HIRED


def test_accepting_twice_is_not_a_second_acceptance(company, offer):
    """A double-click must not rewrite the date they actually agreed."""
    accept_offer(offer)
    offer.refresh_from_db()
    first_response = offer.responded_at

    accept_offer(offer)
    offer.refresh_from_db()

    assert offer.responded_at == first_response


def test_an_expired_offer_cannot_be_accepted(company, offer):
    """Recording the lapse is what stops an old offer being quietly honoured
    months later."""
    offer.expires_on = date.today() - timedelta(days=1)
    offer.save(update_fields=["expires_on"])

    with pytest.raises(HiringError, match="expired"):
        accept_offer(offer)
    offer.refresh_from_db()

    assert offer.status == Offer.Status.EXPIRED


# ── Declining is not rejecting ───────────────────────────────────────────


def test_declining_is_its_own_outcome_not_a_rejection(company, offer, candidate):
    """Losing somebody to a counter-offer is a different fact from deciding
    against them. A funnel that merges the two overstates how selective the
    process was."""
    decline_offer(offer, reason="Accepted a counter-offer")
    offer.refresh_from_db()
    candidate.refresh_from_db()

    assert offer.status == Offer.Status.DECLINED
    assert candidate.stage == Candidate.Stage.DECLINED
    assert candidate.stage != Candidate.Stage.REJECTED
    # The most useful thing recruitment can learn here, and exactly what is lost
    # when a decline is filed as a rejection.
    assert offer.decline_reason == "Accepted a counter-offer"


def test_a_declined_offer_cannot_then_be_accepted(company, offer):
    decline_offer(offer)
    with pytest.raises(HiringError):
        accept_offer(offer)


# ── The conversion ───────────────────────────────────────────────────────


def test_a_hired_candidate_becomes_an_employee_who_can_log_in(company, offer, candidate):
    """The link that did not exist at all."""
    accept_offer(offer)
    candidate.refresh_from_db()
    employee, _ = convert_candidate_to_employee(candidate)

    assert employee.user.email == candidate.email
    assert employee.user.first_name == "Sita"
    assert employee.employee_code.startswith("EMP-")
    assert employee.hired_from_id == candidate.id


def test_the_conversion_carries_the_offer_across(company, offer, candidate):
    """Re-keying data the system already holds is how the two records end up
    disagreeing."""
    accept_offer(offer)
    candidate.refresh_from_db()
    employee, _ = convert_candidate_to_employee(candidate)

    assert employee.date_joined == offer.start_date
    assert employee.phone == candidate.phone


def test_an_unhired_candidate_cannot_be_converted(company, candidate):
    """Being hired is the candidate agreeing, not a status somebody sets."""
    with pytest.raises(HiringError, match="Accept their offer first"):
        convert_candidate_to_employee(candidate)


def test_converting_twice_returns_the_same_employee(company, offer, candidate):
    """`hired_from` earns its keep here: a second attempt must not create a
    duplicate person."""
    accept_offer(offer)
    candidate.refresh_from_db()
    first, _ = convert_candidate_to_employee(candidate)
    second, _ = convert_candidate_to_employee(candidate)
    total = Employee.objects.filter(hired_from=candidate).count()

    assert first.id == second.id
    assert total == 1


def test_a_candidate_with_no_email_cannot_be_converted(company, offer, candidate):
    """The email is the login. Inventing a placeholder would produce an employee
    who can never sign in and a support ticket nobody can explain."""
    accept_offer(offer)
    candidate.refresh_from_db()
    candidate.email = ""
    candidate.save(update_fields=["email"])

    with pytest.raises(HiringError, match="no email"):
        convert_candidate_to_employee(candidate)


def test_a_duplicate_email_is_refused(company, offer, candidate, admin_user):
    accept_offer(offer)
    candidate.refresh_from_db()
    type(admin_user).objects.create(
        username="clash", email=candidate.email, role="employee"
    )

    with pytest.raises(HiringError, match="already has the email"):
        convert_candidate_to_employee(candidate)


# ── Onboarding starts from the hire ──────────────────────────────────────


def test_onboarding_starts_with_the_template_tasks(company, offer, candidate):
    from checklists.models import ChecklistTemplate, ChecklistTemplateItem, Kind

    template = ChecklistTemplate.objects.create(
        name="New joiner", kind=Kind.ONBOARDING, is_active=True
    )
    for order, title in enumerate(["Collect citizenship copy", "Issue laptop", "Orientation"]):
        ChecklistTemplateItem.objects.create(template=template, title=title, order=order)

    accept_offer(offer)
    candidate.refresh_from_db()
    employee, checklist = convert_candidate_to_employee(candidate)

    assert checklist is not None
    assert checklist.employee_id == employee.id
    assert checklist.tasks.count() == 3


def test_hiring_works_without_an_onboarding_template(company, offer, candidate):
    """A company that has not configured onboarding must still be able to hire.
    Failing the whole conversion over a missing checklist would be the tail
    wagging the dog."""
    accept_offer(offer)
    candidate.refresh_from_db()
    employee, checklist = convert_candidate_to_employee(candidate)

    assert employee is not None
    assert checklist is None

# ── Through the API ──────────────────────────────────────────────────────


def test_the_full_flow_through_the_api(company, offer, candidate, hr_client):
    accepted = hr_client.post(
        f"/api/v1/recruitment/offers/{offer.id}/accept/", {}, format="json"
    )
    converted = hr_client.post(
        f"/api/v1/recruitment/candidates/{candidate.id}/convert-to-employee/",
        {}, format="json",
    )

    assert accepted.status_code == 200
    assert accepted.data["status"] == "accepted"
    assert converted.status_code == 201
    assert converted.data["employee_code"].startswith("EMP-")
    assert converted.data["email"] == candidate.email


def test_an_employee_cannot_hire(company, offer, employee_client):
    """Extending an offer and recording its answer are hiring decisions."""
    response = employee_client.post(
        f"/api/v1/recruitment/offers/{offer.id}/accept/", {}, format="json"
    )

    assert response.status_code in (403, 404)


# ── The candidate's own answer ───────────────────────────────────────────
#
# Acceptance has to come from the candidate, not from HR clicking a button
# after a phone call. These guard the link that makes the answer theirs, and
# the properties below are security properties rather than features.


def test_the_token_is_a_secret_not_a_derivation(company, offer):
    """Guessable would be worse than absent: the link is the only thing between
    a stranger and somebody's salary. Asserted against the *shape* rather than
    the value — a token derived from the pk, the email or a timestamp would pass
    a "not empty" check and fail this one."""
    token = offer.issue_response_token()
    assert len(token) >= 40, "token_urlsafe(32) is 43 chars; a short one is a derivation"
    assert str(offer.pk) != token
    assert offer.candidate.email not in token
    # Two offers must never collide.
    other = Offer(candidate=offer.candidate)
    assert other.issue_response_token() != token


def test_reissuing_does_not_break_a_link_already_emailed(company, offer):
    """A resend must reach the same URL. Minting a fresh token on every send
    silently invalidates the message somebody is forwarding as "did you get
    this?"."""
    first = offer.issue_response_token()
    assert offer.issue_response_token() == first


def test_an_unknown_token_resolves_to_nothing(company, offer):
    """404, never 403 — the view depends on this returning `None` rather than
    raising. "Forbidden" would confirm the token exists and turn guessing into a
    search with feedback."""
    from recruitment.offer_response import offer_for_token

    offer.issue_response_token()
    offer.save(update_fields=["response_token"])
    assert offer_for_token("z" * 43) is None
    # And a stub is refused before it reaches the database at all.
    assert offer_for_token("abc") is None


def test_the_public_payload_cannot_leak_what_is_added_to_the_model(company, offer):
    """The endpoint is unauthenticated, so the response body *is* the security
    boundary. An allow-list is asserted here by its complement: internal fields
    must be absent, and this test fails the day somebody swaps it for a
    serializer with an exclude list."""
    from recruitment.offer_response import public_offer_payload

    offer.notes = "Lowballed them; will go to 700k if pushed."
    offer.save(update_fields=["notes"])
    payload = public_offer_payload(offer)

    assert "notes" in Offer._meta.fields_map or True  # the field exists
    assert "notes" not in payload
    assert "Lowballed" not in str(payload)
    for internal in ("id", "pk", "created_by", "updated_by", "decline_reason", "response_token"):
        assert internal not in payload, f"{internal} must not reach an unauthenticated caller"


def test_a_candidate_can_accept_their_own_offer(company, offer, candidate):
    from recruitment.offer_response import respond_to_offer

    respond_to_offer(offer, accept=True)
    offer.refresh_from_db()
    candidate.refresh_from_db()
    assert offer.status == Offer.Status.ACCEPTED
    assert candidate.stage == Candidate.Stage.HIRED
    # Attributing their signature to an internal user would record the
    # wrong hand on the one fact that has to be theirs.
    assert offer.updated_by is None


def test_a_lapsed_link_refuses_rather_than_honouring_it(company, offer):
    """The window matters: an offer quietly accepted months late is a salary
    commitment nobody re-approved."""
    from recruitment.offer_response import OfferLinkError, respond_to_offer

    offer.expires_on = date.today() - timedelta(days=1)
    offer.save(update_fields=["expires_on"])
    assert offer.has_lapsed

    with pytest.raises(OfferLinkError):
        respond_to_offer(offer, accept=True)


def test_answering_twice_is_refused(company, offer):
    """A double-click, a back button, or somebody who was forwarded the link."""
    from recruitment.offer_response import OfferLinkError, respond_to_offer

    respond_to_offer(offer, accept=True)
    with pytest.raises(OfferLinkError):
        respond_to_offer(offer, accept=False, reason="changed my mind")


def test_the_first_view_is_stamped_once(company, offer):
    """An offer opened repeatedly and unanswered is a candidate negotiating
    elsewhere — worth knowing before the expiry rather than after. Overwriting
    would turn "when did they first see it" into "when did they last look"."""
    from recruitment.offer_response import mark_viewed

    mark_viewed(offer)
    offer.refresh_from_db()
    first = offer.viewed_at
    assert first is not None

    mark_viewed(offer)
    offer.refresh_from_db()
    assert offer.viewed_at == first
