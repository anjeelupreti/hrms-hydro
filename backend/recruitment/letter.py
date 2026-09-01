"""The offer letter as a document, stored against the offer.

**Why a PDF at all when the page shows the same terms.** The page is where they
answer; the letter is what they keep, forward to a spouse, and produce if the
terms are ever disputed. It is also the thing a candidate expects — an offer
that arrives as a link and no document reads as provisional.

**Generated at send, once, and stored.** Not rendered on demand: the letter has
to be the terms *as they were when sent*. Regenerating it later from the current
row would silently rewrite history the moment somebody edits the offer, which is
precisely the case where the document matters.
"""

import logging

from django.template.loader import render_to_string
from django.utils import timezone

from documents.models import Document
from documents.services import save_generated_document

logger = logging.getLogger(__name__)


def generate_offer_letter(offer, *, request=None, actor=None):
    """Render and store the letter. Returns the `Document`, or `None`.

    `None` rather than raising, and the caller carries on. WeasyPrint needs
    native GTK libraries that pip does not install, so on a machine without them
    this fails — and an offer that could not be *sent* because a PDF renderer
    was missing would be a hiring process blocked on a system library. The email
    and the response link work without it; the letter is an attachment to them,
    not a precondition.

    The import is local for the same reason it is in `payroll.pdf`: importing
    WeasyPrint at module scope crashes the whole Django process on any machine
    lacking those libraries, including ones that never generate a letter.
    """
    try:
        from weasyprint import HTML
    except Exception as exc:  # noqa: BLE001 — a missing renderer is not a hiring failure
        logger.warning("offer letter not generated (renderer unavailable): %s", exc)
        return None

    from organization.models import CompanyProfile
    from recruitment.offer_response import offer_link

    try:
        company = CompanyProfile.get_solo()
        candidate = offer.candidate
        role = (
            offer.designation.title
            if offer.designation
            else (candidate.job.title if candidate.job_id else "")
        )
        salary_display = (
            f"{offer.annual_salary:,.2f}" if offer.annual_salary is not None else ""
        )

        html = render_to_string(
            "recruitment/offer_letter.html",
            {
                "offer": offer,
                "candidate": candidate,
                "company": company,
                "role": role,
                "salary_display": salary_display,
                "issued_on": timezone.localdate().isoformat(),
                # Only when a token exists. A draft letter with a dead link is
                # worse than one with no link at all.
                "respond_url": offer_link(offer, request) if offer.response_token else "",
            },
        )
        pdf_bytes = HTML(string=html).write_pdf()
    except Exception as exc:  # noqa: BLE001 — same contract as above
        logger.exception("offer letter render failed for offer %s: %s", offer.pk, exc)
        return None

    safe_name = "".join(
        ch if ch.isalnum() or ch in "-_" else "-" for ch in offer.candidate.name
    ).strip("-")
    filename = f"offer-{safe_name or offer.pk}-{timezone.localdate().isoformat()}.pdf"
    return save_generated_document(
        offer, filename, pdf_bytes, kind=Document.Kind.OFFER_LETTER, actor=actor
    )
