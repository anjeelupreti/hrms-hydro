"""The candidate's own answer to an offer — the one signature that is not ours.

Acceptance is the one fact in the hiring flow that has to come from the other
party, because it is the one that creates an obligation on both sides. HR
marking an offer accepted after a phone call is a note of a conversation, not an
acceptance — so this is the route by which the candidate answers for themselves.

**A secret in a link, not an account.** A candidate has no login and must not
need one to say yes: an offer that requires signing up to accept is an offer
with a form in front of it. The token is `secrets.token_urlsafe(32)` — 256 bits,
never derived from the pk, the email or a timestamp, because it is the only
thing standing between a stranger and somebody's salary.

**What the public view is allowed to say.** Their name, the role, the salary,
the start date and the expiry — the contents of the letter they were sent, and
nothing else. Not the internal notes, not the other candidates, not the hiring
manager's assessment. The endpoint is unauthenticated, so the response body *is*
the security boundary.

**A wrong token answers 404, never 403.** "Forbidden" confirms the token exists,
which turns a guessing attack into a search with feedback. The same reasoning
that puts a 404 on records outside somebody's scope elsewhere in this codebase.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

from django.utils import timezone

logger = logging.getLogger(__name__)


class OfferLinkError(Exception):
    """The link cannot be used, and the message says why in the candidate's terms."""


def offer_for_token(token: str):
    """Resolve a response link, or `None`.

    `None` rather than an exception for a bad token: the caller answers 404 and
    a missing offer is not exceptional — it is what a mistyped or expired link
    looks like, and those arrive routinely.
    """
    from recruitment.models import Offer

    if not token or len(token) < 20:
        # Short-circuited before the query. A one-character token is not a
        # near-miss worth a database round trip, and refusing it here keeps the
        # cheap rejection cheap under a guessing attempt.
        return None
    return (
        Offer.objects.select_related(
            "candidate", "candidate__job", "designation", "department"
        )
        .filter(response_token=token)
        .first()
    )


def mark_viewed(offer):
    """Stamp the first time they opened it, once.

    Separate from `responded_at`, and worth keeping: an offer opened four times
    and still unanswered is a candidate negotiating elsewhere, and that is worth
    knowing *before* the expiry date rather than after it. Only the first view
    is recorded — the rest are the same person re-reading, and overwriting would
    turn "when did they first see it" into "when did they last look".
    """
    if offer.viewed_at is None:
        offer.viewed_at = timezone.now()
        offer.save(update_fields=["viewed_at", "updated_at"])
    return offer


def public_offer_payload(offer, *, company_name=None):
    """Exactly what the candidate is allowed to see, and no more.

    Built by hand rather than by a serializer over the model. A serializer with
    an exclude list leaks whatever gets added to the model next, and this is an
    unauthenticated endpoint — the failure mode is somebody's salary and the
    internal hiring notes on a URL. An allow-list of six fields cannot do that.
    """
    candidate = offer.candidate
    return {
        "candidate_name": candidate.name,
        "company_name": company_name or "",
        # The designation on the offer wins over the job they applied to: an
        # offer is frequently made for a different level than the advert.
        "role": offer.designation.title if offer.designation else (
            candidate.job.title if candidate.job_id else ""
        ),
        "department": offer.department.name if offer.department else "",
        "annual_salary": str(offer.annual_salary) if offer.annual_salary is not None else None,
        "start_date": offer.start_date.isoformat() if offer.start_date else None,
        "expires_on": offer.expires_on.isoformat() if offer.expires_on else None,
        "status": offer.status,
        # Whether the link can still be acted on. Computed here so the page
        # never has to re-derive the rule and reach a different answer.
        "can_respond": bool(offer.is_open and not offer.has_lapsed),
        "responded_at": offer.responded_at.isoformat() if offer.responded_at else None,
    }


def respond_to_offer(offer, *, accept: bool, reason: str = ""):
    """Record the candidate's answer, as the candidate.

    Delegates to the same `accept_offer` / `decline_offer` the internal screens
    call. Two paths to one outcome would drift, and the drift would be in what
    happens to `Candidate.stage` — which is what every hiring report reads.

    **`actor=None` is deliberate and is the honest record.** The audit fields
    name the *user* who made a change, and the candidate is not a user of this
    system. Attributing their acceptance to the HR person who happened to send
    the link would be recording the wrong hand on the one signature that must be
    theirs. `sent_at` and the token already say who offered; `responded_at` says
    when they answered.
    """
    from recruitment.hiring import HiringError, accept_offer, decline_offer

    if offer.has_lapsed:
        raise OfferLinkError(
            f"This offer expired on {offer.expires_on}. Please contact the company "
            "if you would still like to accept."
        )
    if not offer.is_open:
        raise OfferLinkError(
            "This offer has already been answered. If that was not you, contact "
            "the company."
        )

    try:
        if accept:
            return accept_offer(offer, actor=None)
        return decline_offer(offer, reason=reason, actor=None)
    except HiringError as exc:
        # The internal rule, restated for somebody outside the company. The
        # service's own wording ("must be reissued") is written for HR.
        raise OfferLinkError(str(exc)) from exc


# ── Sending the offer ────────────────────────────────────────────────────


def offer_link(offer, request=None) -> str:
    """The URL the candidate follows.

    Built from the request where there is one, so a deployment reached on an
    internal hostname mails a link that resolves back to the same place a
    person is already using. `FRONTEND_BASE_URL` is the fallback for anything
    running without a request — a Celery send, a management command.
    """
    from django.conf import settings

    host = None
    if request is not None:
        host = request.get_host()
    if not host:
        # A background job has no request — a Celery send, a management
        # command, anything scheduled. Fall back to the configured frontend.
        base = urlparse(settings.FRONTEND_BASE_URL)
        host = base.netloc or "localhost:3000"

    scheme = "http" if host.split(":")[0].endswith("localhost") else "https"
    return f"{scheme}://{host}/offer/{offer.response_token}"


def send_offer_email(offer, *, request=None):
    """Email the candidate their offer and the link to answer it.

    Called by the offer viewset's `send` action, so that "sent" in the database
    and "in the candidate's inbox" mean the same thing.

    Fail-soft, like every other mail path here: `send_templated_mail` never
    raises, and the status change must stand even if the mail server is down.
    An offer marked sent with the mail undelivered is recoverable — somebody
    resends. An offer that refused to be marked sent because SMTP was
    misconfigured is a hiring process blocked on a mail server.
    """
    from core.email import send_templated_mail

    candidate = offer.candidate
    email = (getattr(candidate, "email", "") or "").strip()
    if not email:
        logger.warning("offer %s has no candidate email; not sending", offer.pk)
        return False

    facts = []
    if offer.designation:
        facts.append({"label": "Role", "value": offer.designation.title})
    if offer.department:
        facts.append({"label": "Department", "value": offer.department.name})
    if offer.annual_salary is not None:
        facts.append({
            "label": "Annual salary",
            "value": f"Rs {offer.annual_salary:,.2f}",
        })
    if offer.start_date:
        facts.append({"label": "Start date", "value": offer.start_date.isoformat()})
    if offer.expires_on:
        facts.append({"label": "Please reply by", "value": offer.expires_on.isoformat()})

    # The letter, attached. Best-effort by contract — `generate_offer_letter`
    # returns None when the PDF renderer is unavailable, and the email still
    # goes with the terms in its body and the link in its button. An offer that
    # could not be sent because a system library was missing would be a hiring
    # process blocked on WeasyPrint.
    attachments = []
    try:
        from recruitment.letter import generate_offer_letter

        document = generate_offer_letter(offer, request=request)
        if document is not None and document.file:
            with document.file.open("rb") as fh:
                attachments.append(
                    (document.original_filename, fh.read(), "application/pdf")
                )
    except Exception:  # noqa: BLE001 — never let the letter stop the offer
        logger.exception("could not attach offer letter for offer %s", offer.pk)

    send_templated_mail(
        f"Your offer{' — ' + offer.designation.title if offer.designation else ''}",
        [email],
        heading="We would like you to join us",
        greeting=f"Hello {candidate.name},",
        intro=(
            "Here are the terms of the offer. Everything below is what we have "
            "recorded — if anything looks wrong, reply to this email before "
            "accepting."
        ),
        facts=facts,
        cta_label="Accept or decline",
        cta_url=offer_link(offer, request),
        outro=(
            "The link is personal to you. Please do not forward it — whoever "
            "opens it can answer on your behalf."
        ),
        attachments=attachments or None,
    )
    return True
