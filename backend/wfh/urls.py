from rest_framework.routers import DefaultRouter

from wfh.viewsets import WFHRequestViewSet

app_name = "wfh"

router = DefaultRouter()
router.register("requests", WFHRequestViewSet, basename="request")

urlpatterns = router.urls
