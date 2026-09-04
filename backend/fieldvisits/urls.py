from rest_framework.routers import DefaultRouter

from fieldvisits.viewsets import FieldVisitViewSet, SiteViewSet

app_name = "fieldvisits"

router = DefaultRouter()
router.register("visits", FieldVisitViewSet, basename="field-visit")
router.register("sites", SiteViewSet, basename="site")

urlpatterns = router.urls
