"""Device management API.

The security-relevant property here is narrow and worth stating: the token is
generated server-side, shown once, and stored only as a hash. A leaked device
list must not be a leaked set of credentials.
"""

import pytest

from attendance.models import Device, hash_device_secret

pytestmark = pytest.mark.django_db

ENDPOINT = "/api/v1/attendance/devices/"


def _payload(**overrides):
    data = {
        "name": "Main gate",
        "serial": "ZK-8821",
        "device_type": "zkteco",
        "location": "Reception",
        "timezone_name": "Asia/Kathmandu",
    }
    data.update(overrides)
    return data


# ── Access ───────────────────────────────────────────────────────────────


def test_anonymous_cannot_list_devices(api_client):
    assert api_client.get(ENDPOINT).status_code in (401, 403)


def test_employee_cannot_create_a_device(employee_client):
    """Issuing a device token is effectively minting an attendance-writing
    credential — squarely an HR-admin action."""
    response = employee_client.post(ENDPOINT, _payload(), format="json")
    assert response.status_code in (403, 405)


def test_hr_admin_can_create_a_device(hr_client, company):
    response = hr_client.post(ENDPOINT, _payload(), format="json")

    assert response.status_code == 201
    assert Device.objects.filter(serial="ZK-8821").exists()


# ── Token handling ───────────────────────────────────────────────────────


def test_token_is_returned_exactly_once_on_create(hr_client):
    response = hr_client.post(ENDPOINT, _payload(), format="json")

    token = response.data.get("token")
    assert token, "the caller has no other way to ever learn this value"
    assert len(token) > 20


def test_token_is_stored_only_as_a_hash(hr_client, company):
    token = hr_client.post(ENDPOINT, _payload(), format="json").data["token"]

    device = Device.objects.get(serial="ZK-8821")
    assert device.secret_hash == hash_device_secret(token)
    assert token not in device.secret_hash


def test_listing_devices_never_leaks_tokens_or_hashes(hr_client):
    hr_client.post(ENDPOINT, _payload(), format="json")

    row = hr_client.get(ENDPOINT).data["results"][0]

    assert "token" not in row
    assert "secret_hash" not in row


def test_retrieving_a_device_never_leaks_the_token(hr_client):
    created = hr_client.post(ENDPOINT, _payload(), format="json").data

    detail = hr_client.get(f"{ENDPOINT}{created['id']}/").data

    assert "token" not in detail
    assert "secret_hash" not in detail


def test_rotating_issues_a_new_token_and_kills_the_old(hr_client, company):
    created = hr_client.post(ENDPOINT, _payload(), format="json").data
    old_token = created["token"]

    rotated = hr_client.post(f"{ENDPOINT}{created['id']}/rotate-token/", {}, format="json")

    assert rotated.status_code == 200
    new_token = rotated.data["token"]
    assert new_token != old_token

    device = Device.objects.get(pk=created["id"])
    assert device.check_secret(new_token)
    assert not device.check_secret(old_token)


def test_employee_cannot_rotate_a_token(hr_client, employee_client):
    created = hr_client.post(ENDPOINT, _payload(), format="json").data

    response = employee_client.post(f"{ENDPOINT}{created['id']}/rotate-token/", {}, format="json")

    assert response.status_code in (403, 405)


# ── Constraints and bookkeeping ──────────────────────────────────────────


def test_serial_must_be_unique(hr_client):
    hr_client.post(ENDPOINT, _payload(), format="json")
    duplicate = hr_client.post(ENDPOINT, _payload(name="Back gate"), format="json")

    assert duplicate.status_code == 400


def test_deactivating_a_device_is_an_ordinary_patch(hr_client, company):
    created = hr_client.post(ENDPOINT, _payload(), format="json").data

    response = hr_client.patch(f"{ENDPOINT}{created['id']}/", {"is_active": False}, format="json")

    assert response.status_code == 200
    assert Device.objects.get(pk=created["id"]).is_active is False


def test_new_device_reports_no_events_and_no_last_seen(hr_client):
    created = hr_client.post(ENDPOINT, _payload(), format="json").data

    assert created["event_count"] == 0
    assert created["last_seen_at"] is None


def test_a_pushed_punch_shows_up_against_the_device(hr_client, api_client, company):
    """End to end: the console issues a credential, the terminal uses it, and
    the console then sees both the punch count and the last-seen stamp."""
    created = hr_client.post(ENDPOINT, _payload(), format="json").data

    push = api_client.post(
        "/api/v1/attendance/device-sync/",
        {"employee_id": "EMP-001", "event_type": "check_in", "timestamp": "2026-08-05T09:14:00Z"},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {created['token']}",
    )
    assert push.status_code == 201

    detail = hr_client.get(f"{ENDPOINT}{created['id']}/").data
    assert detail["event_count"] == 1
    assert detail["last_seen_at"] is not None
