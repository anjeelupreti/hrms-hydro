from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path, re_path

from core.media import MediaView
from core.observability import readyz


def health(request, version=None):
    """Liveness probe (Render healthCheckPath). Pings the DB but never 500s —
    reports degraded status instead so the host sees a response. No auth."""
    db_ok = True
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:  # noqa: BLE001
        db_ok = False
    return JsonResponse({"status": "ok" if db_ok else "degraded", "database": db_ok})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/<str:version>/health/", health, name="health"),
    path("healthz", health, name="healthz"),  # host-root probe (no version)
    # Readiness is a different question from liveness — see core.observability.
    path("api/<str:version>/readyz/", readyz, name="readyz"),
    path("readyz", readyz, name="readyz-root"),
    path("api/<str:version>/accounts/", include("accounts.urls")),
    path("api/<str:version>/employees/", include("employees.urls")),
    path("api/<str:version>/attendance/", include("attendance.urls")),
    path("api/<str:version>/notifications/", include("notifications.urls")),
    path("api/<str:version>/leave/", include("leave.urls")),
    path("api/<str:version>/payroll/", include("payroll.urls")),
    path("api/<str:version>/organization/", include("organization.urls")),
    path("api/<str:version>/companies/", include("companies.urls")),
    path("api/<str:version>/crm/", include("crm.urls")),
    path("api/<str:version>/events/", include("events.urls")),
    path("api/<str:version>/memoranda/", include("memoranda.urls")),
    path("api/<str:version>/field-visits/", include("fieldvisits.urls")),

    # Work, not selling. Projects left `crm` because an internal project has
    # no client, and a model requiring one cannot describe one.
    path("api/<str:version>/projects/", include("projects.urls")),
    path("api/<str:version>/chat/", include("chat.urls")),
    path("api/<str:version>/personal/", include("personal.urls")),
    path("api/<str:version>/mail/", include("mail.urls")),
    path("api/<str:version>/training/", include("training.urls")),
    path("api/<str:version>/recruitment/", include("recruitment.urls")),
    path("api/<str:version>/wfh/", include("wfh.urls")),
    path("api/<str:version>/dashboard/", include("dashboard.urls")),
    path("api/<str:version>/reports/", include("reports.urls")),
    path("api/<str:version>/expenses/", include("expenses.urls")),
    path("api/<str:version>/documents/", include("documents.urls")),
    path("api/<str:version>/checklists/", include("checklists.urls")),
    path("api/<str:version>/timesheets/", include("timesheets.urls")),
    path("api/<str:version>/goals/", include("goals.urls")),
    path("api/<str:version>/assets/", include("assets.urls")),
    path("api/<str:version>/helpdesk/", include("helpdesk.urls")),
    path("api/<str:version>/surveys/", include("surveys.urls")),
]

# Served by `core.media.MediaView`, which checks the session and the permission
# — `django.conf.urls.static.static` checks neither.
# Registered outside the `DEBUG` guard on purpose: that helper is
# development-only, so a deployment without a bucket configured would serve no
# files at all rather than serving them safely.
urlpatterns += [
    re_path(r"^media/(?P<path>.+)$", MediaView.as_view(), name="media"),
]
