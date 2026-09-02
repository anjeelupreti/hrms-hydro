from rest_framework.routers import DefaultRouter

from fieldvisits.viewsets import FieldVisitViewSet

app_name = "fieldvisits"

router = DefaultRouter()
router.register("visits", FieldVisitViewSet, basename="field-visit")

urlpatterns = router.urls
