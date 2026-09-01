from rest_framework.routers import DefaultRouter

from expenses.viewsets import ExpenseClaimViewSet

app_name = "expenses"

router = DefaultRouter()
router.register("claims", ExpenseClaimViewSet, basename="claim")

urlpatterns = router.urls
