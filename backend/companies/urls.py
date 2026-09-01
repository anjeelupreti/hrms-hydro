from rest_framework.routers import DefaultRouter

from companies.viewsets import CompanyViewSet

app_name = "companies"

router = DefaultRouter()
router.register("companies", CompanyViewSet, basename="company")

urlpatterns = router.urls
