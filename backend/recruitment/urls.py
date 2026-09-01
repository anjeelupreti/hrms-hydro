from django.urls import path
from rest_framework.routers import DefaultRouter

from recruitment.views_public import OfferDetailView, OfferRespondView
from recruitment.viewsets import CandidateViewSet, JobPostingViewSet, OfferViewSet

app_name = "recruitment"

router = DefaultRouter()
router.register("jobs", JobPostingViewSet, basename="job")
router.register("offers", OfferViewSet, basename="offer")
router.register("candidates", CandidateViewSet, basename="candidate")

urlpatterns = [
    # The candidate's link. Outside the router because it is addressed by a
    # secret rather than by a pk, and because a public path sitting in the same
    # namespace as the authenticated one is how a viewset action ends up
    # unintentionally reachable.
    path("offer-response/<str:token>/", OfferDetailView.as_view(), name="offer-response"),
    path(
        "offer-response/<str:token>/reply/",
        OfferRespondView.as_view(),
        name="offer-respond",
    ),
] + router.urls
