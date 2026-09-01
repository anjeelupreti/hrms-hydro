from django.urls import path
from rest_framework.routers import DefaultRouter

from organization.calendar_api import CalendarMonthView, DateConvertView
from organization.viewsets import (
    CompanyProfileView,
    EmailConnectionTestView,
    ImapConnectionTestView,
    ReviewCycleViewSet,
    ReviewViewSet,
    SetupReadinessView,
    CompanyEmailSettingsView,
    TodayView,
)

app_name = "organization"

router = DefaultRouter()
router.register("review-cycles", ReviewCycleViewSet, basename="review-cycle")
router.register("reviews", ReviewViewSet, basename="review")

urlpatterns = [
    path("company-profile/", CompanyProfileView.as_view(), name="company-profile"),
    path("today/", TodayView.as_view(), name="today"),
    # What is still unconfigured. Resolved from live data on every read —
    # see organization/setup.py for why nothing here is a stored flag.
    path("setup/", SetupReadinessView.as_view(), name="setup-readiness"),
    # The company's calendar, served so the browser never owns a second
    # conversion table — see organization/calendar_api.py.
    path("calendar/month/", CalendarMonthView.as_view(), name="calendar-month"),
    path("calendar/convert/", DateConvertView.as_view(), name="calendar-convert"),
    path("email-settings/", CompanyEmailSettingsView.as_view(), name="email-settings"),
    path("email-settings/test-connection/", EmailConnectionTestView.as_view(), name="email-settings-test"),
    path("email-settings/test-imap/", ImapConnectionTestView.as_view(), name="email-settings-test-imap"),
] + router.urls
