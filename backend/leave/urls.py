from rest_framework.routers import DefaultRouter

from leave.viewsets import (
    ApprovalChainViewSet,
    LeaveBalanceViewSet,
    LeaveRequestViewSet,
    LeaveTypeViewSet,
)

app_name = "leave"

router = DefaultRouter()
router.register("types", LeaveTypeViewSet, basename="leave-type")
router.register("approval-chains", ApprovalChainViewSet, basename="approval-chain")
router.register("balances", LeaveBalanceViewSet, basename="leave-balance")
router.register("requests", LeaveRequestViewSet, basename="leave-request")

urlpatterns = router.urls
