from rest_framework.routers import DefaultRouter

from expenses.viewsets import ExpenseBudgetViewSet, ExpenseClaimViewSet

app_name = "expenses"

router = DefaultRouter()
router.register("claims", ExpenseClaimViewSet, basename="claim")
# What may be spent, and the most one claim may be — see `expenses/budgets.py`
# for why a pool and a cap live on the same row.
router.register("budgets", ExpenseBudgetViewSet, basename="budget")

urlpatterns = router.urls
