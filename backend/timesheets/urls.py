from rest_framework.routers import DefaultRouter

from timesheets.viewsets import TimeEntryViewSet

app_name = "timesheets"

router = DefaultRouter()
router.register("entries", TimeEntryViewSet, basename="time-entry")

urlpatterns = router.urls
