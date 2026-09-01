from django.urls import path
from rest_framework.routers import DefaultRouter

from attendance.api_views import HardwareSyncWebhook
from attendance.policy_api import AttendancePolicyView, EmployeeAttendanceMethodViewSet
from attendance.views import AttendanceCalendarView
from attendance.viewsets import (
    AttendanceDeviceEventViewSet,
    AttendanceLogViewSet,
    DeviceViewSet,
    RegularisationRequestViewSet,
    ShiftAssignmentViewSet,
    ShiftViewSet,
)

app_name = "attendance"

router = DefaultRouter()
router.register("shifts", ShiftViewSet, basename="shift")
router.register("regularisations", RegularisationRequestViewSet, basename="regularisation")
router.register("shift-assignments", ShiftAssignmentViewSet, basename="shift-assignment")
router.register("logs", AttendanceLogViewSet, basename="attendance-log")
router.register("device-events", AttendanceDeviceEventViewSet, basename="attendance-device-event")
router.register("devices", DeviceViewSet, basename="attendance-device")
router.register(
    "attendance-methods", EmployeeAttendanceMethodViewSet, basename="attendance-method"
)

urlpatterns = [
    path("calendar/", AttendanceCalendarView.as_view(), name="attendance-calendar"),
    path("device-sync/", HardwareSyncWebhook.as_view(), name="device-sync"),
    path("policy/", AttendancePolicyView.as_view(), name="attendance-policy"),
] + router.urls
