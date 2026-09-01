"""Request context for logs, and a readiness probe.

Two problems this solves.

**Correlating a log line to a request.** "An error happened" is not actionable
on its own. A context variable carries the request id for the life of the
request, and a logging filter stamps every record with it, so grepping one id
gives the whole story across modules.

**Telling liveness from readiness apart.** `/healthz` answers "is this
process alive" — an orchestrator restarts the container if not. `/readyz`
answers "can it actually serve traffic", which needs the database, the
broker, and a worker on the other end of it. Conflating them means a pod
with a dead Redis keeps receiving requests, or a healthy pod gets killed
during a blip.
"""

import logging
import uuid
from contextvars import ContextVar

from django.conf import settings
from django.db import connection
from django.http import JsonResponse

# An empty default rather than None so log formatting never fails on a record
# emitted outside a request (management commands, Celery, startup).
_request_id: ContextVar[str] = ContextVar("request_id", default="-")

# Header a load balancer or the Next.js proxy may already have set. Reusing
# an upstream id is what makes a trace span the whole stack rather than
# starting fresh at Django.
REQUEST_ID_HEADER = "HTTP_X_REQUEST_ID"


def current_request_id() -> str:
    return _request_id.get()


class RequestContextMiddleware:
    """Binds a request id for the life of this request."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.META.get(REQUEST_ID_HEADER, "").strip()
        request_id = incoming or uuid.uuid4().hex[:12]

        id_token = _request_id.set(request_id)
        request.request_id = request_id
        try:
            response = self.get_response(request)
        finally:
            # Reset explicitly: under ASGI the same task may serve another
            # request, and a leaked context would mislabel its logs.
            _request_id.reset(id_token)

        # Echo it back so a client can quote the id in a bug report.
        response["X-Request-ID"] = request_id
        return response


class RequestContextFilter(logging.Filter):
    """Injects `request_id` into every log record.

    A filter rather than a formatter so the field exists on the record for
    structured handlers (JSON shippers, Sentry) as well as plain text.
    """

    def filter(self, record):
        record.request_id = current_request_id()
        return True


# ── Readiness ────────────────────────────────────────────────────────────


def _check_database() -> tuple[bool, str]:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return True, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, type(exc).__name__


def _check_broker() -> tuple[bool, str, int | None]:
    """Pings Redis and reports the default queue's depth.

    Depth is returned alongside because a reachable broker with a runaway
    backlog is a different failure from an unreachable one, and both look
    identical from the outside until something times out.
    """
    try:
        import redis

        client = redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2)
        client.ping()
        try:
            depth = client.llen("celery")
        except Exception:  # noqa: BLE001 — reachable but depth unavailable
            depth = None
        return True, "ok", depth
    except Exception as exc:  # noqa: BLE001
        return False, type(exc).__name__, None


def readyz(request, version=None):
    """Readiness: can this process actually serve traffic?

    Unlike `/healthz`, this **does** fail — 503 when a dependency is down, so
    an orchestrator stops routing to it. Reporting "ok" while the database is
    unreachable would be worse than no probe at all.
    """
    db_ok, db_detail = _check_database()
    broker_ok, broker_detail, queue_depth = _check_broker()

    ready = db_ok and broker_ok
    payload = {
        "status": "ready" if ready else "not-ready",
        "checks": {
            "database": {"ok": db_ok, "detail": db_detail},
            "broker": {"ok": broker_ok, "detail": broker_detail},
        },
    }
    if queue_depth is not None:
        payload["checks"]["broker"]["queue_depth"] = queue_depth
        # Surfaced, not enforced: a threshold here would make a slow worker
        # look like a dead process and get the container restarted, which
        # deletes the backlog's only consumer.
        payload["checks"]["broker"]["queue_depth_warning"] = queue_depth > 1000

    return JsonResponse(payload, status=200 if ready else 503)
