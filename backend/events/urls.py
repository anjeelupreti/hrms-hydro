from rest_framework.routers import DefaultRouter

from events.viewsets import EventViewSet

app_name = "events"

router = DefaultRouter()
router.register("events", EventViewSet, basename="event")

urlpatterns = router.urls
