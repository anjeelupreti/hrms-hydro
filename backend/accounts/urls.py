from django.urls import path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenBlacklistView,
    TokenRefreshView,
)

from accounts.team import (
    TeamCatalogueView,
    TeamGrantView,
    TeamRoleView,
    TeamView,
)
from accounts.views import (
    ChangePasswordView,
    MeView,
    MyExperienceViewSet,
    MyProfileView,
    MyResumeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PortalSummaryView,
    ThrottledTokenObtainPairView,
    TwoFactorDisableView,
    TwoFactorEnableView,
    TwoFactorSetupView,
    TwoFactorStatusView,
)

app_name = "accounts"

_router = DefaultRouter()
_router.register("experiences", MyExperienceViewSet, basename="experience")

urlpatterns = [
    path("portal/summary/", PortalSummaryView.as_view(), name="portal-summary"),
    path("me/", MeView.as_view(), name="me"),
    path("team/", TeamView.as_view(), name="team"),
    path("team/catalogue/", TeamCatalogueView.as_view(), name="team_catalogue"),
    path("team/<int:user_id>/role/", TeamRoleView.as_view(), name="team_role"),
    path("team/<int:user_id>/grants/", TeamGrantView.as_view(), name="team_grants"),
    path("profile/", MyProfileView.as_view(), name="profile"),
    path("profile/resume/", MyResumeView.as_view(), name="profile-resume"),
    path("change-password/", ChangePasswordView.as_view(), name="change_password"),
    path("2fa/", TwoFactorStatusView.as_view(), name="twofactor_status"),
    path("2fa/setup/", TwoFactorSetupView.as_view(), name="twofactor_setup"),
    path("2fa/enable/", TwoFactorEnableView.as_view(), name="twofactor_enable"),
    path("2fa/disable/", TwoFactorDisableView.as_view(), name="twofactor_disable"),
    path("token/", ThrottledTokenObtainPairView.as_view(), name="token_obtain"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("token/blacklist/", TokenBlacklistView.as_view(), name="token_blacklist"),
    path(
        "password-reset/request/",
        PasswordResetRequestView.as_view(),
        name="password_reset_request",
    ),
    path(
        "password-reset/confirm/",
        PasswordResetConfirmView.as_view(),
        name="password_reset_confirm",
    ),
    *_router.urls,
]
