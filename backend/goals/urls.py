from rest_framework.routers import DefaultRouter

from goals.viewsets import ObjectiveViewSet

app_name = "goals"

router = DefaultRouter()
router.register("objectives", ObjectiveViewSet, basename="objective")

urlpatterns = router.urls
