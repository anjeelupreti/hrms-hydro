"""The two endpoints a candidate reaches without an account.

Both are unauthenticated and both are addressed by a secret, so the rules that
matter are here rather than in a permission class:

* **A bad token is 404, never 403.** "Forbidden" confirms the token exists,
  which turns guessing into a search with feedback.
* **Throttled by scope.** The rate is what makes guessing pointless; a real
  candidate opens their link a few times and answers once.
* **The response body is the security boundary.** `public_offer_payload` is an
  allow-list of six fields, built by hand — a serializer with an exclude list
  leaks whatever is added to the model next, and on this endpoint that would be
  somebody's salary and the internal hiring notes.
"""

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from recruitment.offer_response import (
    OfferLinkError,
    mark_viewed,
    offer_for_token,
    public_offer_payload,
    respond_to_offer,
)


class OfferResponseThrottle(ScopedRateThrottle):
    """Named class, not a `throttle_scope` kwarg — see `JobApplicationThrottle`
    for why that raises at import time on an `@action`. Kept consistent here
    even though these are plain `APIView`s."""

    scope = "offer_response"


def _company_name():
    """The company as the candidate knows it. Absent rather than guessed — a
    letter headed "My Company" is worse than one with no heading."""
    try:
        from organization.models import CompanyProfile

        return CompanyProfile.get_solo().name or ""
    except Exception:  # noqa: BLE001 — a missing profile must not 500 the letter
        return ""


class OfferDetailView(APIView):
    """What the candidate was offered, for the page behind their link."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [OfferResponseThrottle]

    def get(self, request, token, *args, **kwargs):
        offer = offer_for_token(token)
        if offer is None:
            return Response(
                {"detail": "This link is not valid."}, status=status.HTTP_404_NOT_FOUND
            )
        # Stamped before rendering: they have opened it, whatever they decide.
        mark_viewed(offer)
        return Response(public_offer_payload(offer, company_name=_company_name()))


class OfferRespondView(APIView):
    """Their answer. The one signature in the hiring flow that is not ours."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [OfferResponseThrottle]

    def post(self, request, token, *args, **kwargs):
        offer = offer_for_token(token)
        if offer is None:
            return Response(
                {"detail": "This link is not valid."}, status=status.HTTP_404_NOT_FOUND
            )

        action = str(request.data.get("action", "")).lower()
        if action not in {"accept", "decline"}:
            return Response(
                {"detail": "Say whether you accept or decline."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            respond_to_offer(
                offer,
                accept=action == "accept",
                # Their words, and the most useful thing recruitment can learn.
                # Never required: a decline held up by a mandatory form becomes
                # an unanswered offer, and the reason is lost either way.
                reason=str(request.data.get("reason", ""))[:255],
            )
        except OfferLinkError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        offer.refresh_from_db()
        return Response(public_offer_payload(offer, company_name=_company_name()))
