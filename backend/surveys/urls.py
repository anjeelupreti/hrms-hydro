from rest_framework.routers import DefaultRouter

from surveys.viewsets import SurveyViewSet

app_name = "surveys"

router = DefaultRouter()
router.register("", SurveyViewSet, basename="survey")

urlpatterns = router.urls
