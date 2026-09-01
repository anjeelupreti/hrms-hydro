"""Device ingest authorisation and validation.

These exist because the endpoint shipped accepting *any* Bearer token — its
own comment said so. Every path below is one an attacker or a misconfigured
terminal would actually take.
"""

import pytest

from attendance.models import AttendanceDeviceEvent, Device

pytestmark = pytest.mark.django_db


ENDPOINT = "/api/v1/attendance/device-sync/"


def _punch(**overrides):
    payload = {
        "employee_id": "EMP-001",
        "event_type": "check_in",
        "timestamp": "2026-08-05T09:14:00Z",
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def device(company):
    """A registered terminal, plus the plaintext token it was issued."""
    d = Device(name="Main gate", serial="ZK-8821", device_type=Device.DeviceType.ZKTECO)
    token = Device.generate_secret()
    d.set_secret(token)
    d.save()
    return d, token


def _post(client, payload, token=None):
    kwargs = {}
    if token is not None:
        kwargs["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return client.post(ENDPOINT, payload, format="json", **kwargs)


# ── Authorisation ────────────────────────────────────────────────────────


def test_no_authorization_header_is_rejected(api_client, device):
    response = _post(api_client, _punch())
    assert response.status_code == 401


def test_arbitrary_bearer_token_is_rejected(api_client, device):
    """The original bug: any token at all was accepted."""
    response = _post(api_client, _punch(), token="literally-anything")
    assert response.status_code == 401


def test_empty_bearer_token_is_rejected(api_client, device):
    response = _post(api_client, _punch(), token="")
    assert response.status_code == 401


def test_registered_device_token_is_accepted(api_client, company, device):
    _, token = device
    response = _post(api_client, _punch(), token=token)
    assert response.status_code == 201

    assert AttendanceDeviceEvent.objects.count() == 1
    event = AttendanceDeviceEvent.objects.get()
    assert event.external_employee_id == "EMP-001"
    assert event.processed is False, "events must stage, never write straight to the log"


def test_deactivated_device_is_rejected(api_client, company, device):
    d, token = device
    d.is_active = False
    d.save()

    response = _post(api_client, _punch(), token=token)
    assert response.status_code == 401


def test_rotating_the_secret_invalidates_the_old_token(api_client, company, device):
    d, old_token = device
    new_token = d.rotate_secret()

    assert _post(api_client, _punch(), token=old_token).status_code == 401
    assert _post(api_client, _punch(), token=new_token).status_code == 201


def test_auth_failures_do_not_distinguish_causes(api_client, company, device):
    """Unknown vs disabled must look identical — the difference is free recon."""
    d, token = device
    unknown = _post(api_client, _punch(), token="not-a-real-token")

    d.is_active = False
    d.save()
    disabled = _post(api_client, _punch(), token=token)

    assert unknown.json() == disabled.json()


def test_secret_is_never_stored_in_plaintext(company, device):
    d, token = device
    d.refresh_from_db()
    assert token not in d.secret_hash
    assert len(d.secret_hash) == 64  # sha256 hex


# ── Payload validation ───────────────────────────────────────────────────


def test_unknown_event_type_is_reported_not_swallowed(api_client, company, device):
    """The original code caught every exception and dropped the row silently,
    so a misconfigured device looked healthy for months."""
    _, token = device
    response = _post(api_client, _punch(event_type="teleported"), token=token)

    assert response.status_code == 400
    assert response.json()["rejected"][0]["index"] == 0
    assert AttendanceDeviceEvent.objects.count() == 0


def test_missing_employee_id_is_rejected(api_client, device):
    _, token = device
    payload = _punch()
    del payload["employee_id"]
    assert _post(api_client, payload, token=token).status_code == 400


def test_unparseable_timestamp_is_rejected(api_client, device):
    _, token = device
    assert _post(api_client, _punch(timestamp="yesterday-ish"), token=token).status_code == 400


def test_partial_batch_reports_both_halves(api_client, company, device):
    _, token = device
    response = _post(
        api_client,
        [_punch(employee_id="EMP-001"), _punch(event_type="nonsense")],
        token=token,
    )

    body = response.json()
    assert response.status_code == 201
    assert body["status"] == "partial"
    assert body["staged"] == 1
    assert len(body["rejected"]) == 1

    assert AttendanceDeviceEvent.objects.count() == 1


def test_oversized_batch_is_refused(api_client, company, device):
    from attendance.api_views import MAX_EVENTS_PER_PUSH

    _, token = device
    response = _post(api_client, [_punch()] * (MAX_EVENTS_PER_PUSH + 1), token=token)

    assert response.status_code == 413
    assert AttendanceDeviceEvent.objects.count() == 0


def test_non_list_non_object_payload_is_refused(api_client, device):
    _, token = device
    assert _post(api_client, "just a string", token=token).status_code == 400


# ── Bookkeeping ──────────────────────────────────────────────────────────


def test_successful_push_updates_last_seen(api_client, company, device):
    d, token = device
    assert d.last_seen_at is None

    _post(api_client, _punch(), token=token)

    d.refresh_from_db()
    assert d.last_seen_at is not None


def test_event_is_linked_to_the_pushing_device(api_client, company, device):
    d, token = device
    _post(api_client, _punch(), token=token)

    event = AttendanceDeviceEvent.objects.get()
    assert event.device_id == d.id
    assert event.reported_device_id == d.serial
