"""P1.4 — request context and readiness.

Observability is easy to add and easy to have silently stop working. These
pin the two properties that matter: a log line can be traced back to one
request, and the readiness probe actually *fails* when a dependency is down
instead of reporting "ok" into the void.
"""

import logging
from unittest.mock import patch

import pytest

from core.observability import (
    RequestContextFilter,
    current_request_id,
    readyz,
)

pytestmark = pytest.mark.django_db


# ── Request id ───────────────────────────────────────────────────────────


def test_every_response_carries_a_request_id(api_client):
    response = api_client.get("/healthz")

    assert response["X-Request-ID"]
    assert len(response["X-Request-ID"]) >= 8


def test_each_request_gets_a_different_id(api_client):
    first = api_client.get("/healthz")["X-Request-ID"]
    second = api_client.get("/healthz")["X-Request-ID"]

    assert first != second


def test_an_upstream_request_id_is_preserved(api_client):
    """The Next.js proxy or a load balancer may already have started a trace.
    Minting a fresh id here would break the join across the two hops."""
    response = api_client.get("/healthz", HTTP_X_REQUEST_ID="upstream-abc123")

    assert response["X-Request-ID"] == "upstream-abc123"


def test_the_context_does_not_leak_between_requests(api_client):
    """Under ASGI the same task serves later requests. A context left set
    would label the next request's logs with the previous one's id."""
    api_client.get("/healthz")

    # Outside any request, the defaults are back.
    assert current_request_id() == "-"


# ── The logging filter ───────────────────────────────────────────────────


def test_the_filter_stamps_records_with_context():
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname=__file__, lineno=1,
        msg="hello", args=(), exc_info=None,
    )

    assert RequestContextFilter().filter(record) is True
    assert hasattr(record, "request_id")


def test_the_filter_never_drops_a_record_outside_a_request():
    """A log emitted from a management command or a Celery task has no
    request context. It must still be logged, with placeholders — a filter
    that returned False here would silently swallow worker logs."""
    record = logging.LogRecord(
        name="worker", level=logging.ERROR, pathname=__file__, lineno=1,
        msg="task failed", args=(), exc_info=None,
    )

    assert RequestContextFilter().filter(record) is True
    assert record.request_id == "-"


def test_the_configured_format_renders_without_a_request(settings):
    """Guards against a formatter referencing a field the filter forgot to
    set — which fails at emit time, i.e. only when something already went
    wrong and you most need the log."""
    record = logging.LogRecord(
        name="worker", level=logging.INFO, pathname=__file__, lineno=1,
        msg="starting", args=(), exc_info=None,
    )
    RequestContextFilter().filter(record)
    fmt = settings.LOGGING["formatters"]["standard"]["format"]

    rendered = logging.Formatter(fmt).format(record)

    assert "starting" in rendered
    assert "-" in rendered  # the placeholder schema/request id


# ── Readiness ────────────────────────────────────────────────────────────


def _get(path="/readyz"):
    from django.test import RequestFactory

    return readyz(RequestFactory().get(path))


def test_readyz_reports_ready_when_dependencies_are_up(company):
    with patch("core.observability._check_broker", return_value=(True, "ok", 0)):
        response = _get()

    assert response.status_code == 200


def test_readyz_returns_503_when_the_broker_is_down(company):
    """The point of the probe. Reporting 200 with a dead broker keeps traffic
    routing to a process that cannot complete any background work."""
    with patch("core.observability._check_broker", return_value=(False, "ConnectionError", None)):
        response = _get()

    assert response.status_code == 503


def test_readyz_returns_503_when_the_database_is_down(company):
    with patch("core.observability._check_database", return_value=(False, "OperationalError")), \
         patch("core.observability._check_broker", return_value=(True, "ok", 0)):
        response = _get()

    assert response.status_code == 503


def test_readyz_reports_queue_depth_when_available(company):
    import json

    with patch("core.observability._check_broker", return_value=(True, "ok", 42)):
        response = _get()

    payload = json.loads(response.content)
    assert payload["checks"]["broker"]["queue_depth"] == 42
    assert payload["checks"]["broker"]["queue_depth_warning"] is False


def test_a_deep_queue_warns_but_does_not_fail_readiness(company):
    """A backlog means the workers are slow, not that this process is
    unhealthy. Failing readiness here would get the container restarted,
    which removes the backlog's only consumer and makes it worse."""
    import json

    with patch("core.observability._check_broker", return_value=(True, "ok", 5000)):
        response = _get()

    payload = json.loads(response.content)
    assert response.status_code == 200
    assert payload["checks"]["broker"]["queue_depth_warning"] is True


def test_healthz_stays_a_liveness_probe_and_does_not_check_the_broker(api_client):
    """`/healthz` must keep answering 200 while the broker is down —
    otherwise an orchestrator kills a process that is merely degraded."""
    with patch("core.observability._check_broker", return_value=(False, "ConnectionError", None)):
        response = api_client.get("/healthz")

    assert response.status_code == 200
