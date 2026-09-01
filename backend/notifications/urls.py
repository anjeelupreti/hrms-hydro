from rest_framework.routers import DefaultRouter

from notifications.viewsets import (
    AnnouncementViewSet,
    CompanyEventViewSet,
    HolidayViewSet,
    MeetingViewSet,
    NotificationViewSet,
    ReminderRuleViewSet,
)

app_name = "notifications"

router = DefaultRouter()
# holidays/, company-events/, meetings/, and announcements/ must be
# registered before the empty-prefix NotificationViewSet below — that
# viewset's own detail route matches "/{pk}/" against anything,
# including these prefixes, so registration order here is load-bearing.
router.register("holidays", HolidayViewSet, basename="holiday")
router.register("company-events", CompanyEventViewSet, basename="company-event")
router.register("meetings", MeetingViewSet, basename="meeting")
router.register("announcements", AnnouncementViewSet, basename="announcement")
router.register("reminder-rules", ReminderRuleViewSet, basename="reminder-rule")
router.register("", NotificationViewSet, basename="notification")

urlpatterns = router.urls
