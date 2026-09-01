"""Chat presence — online now, and last seen otherwise.

The design turns on one thing: **presence is counted, not a boolean.** One
person routinely has three tabs and a phone, and a flag set false by any
disconnect would show them offline while they are still connected — confidently
wrong, which is worse than not showing presence at all.

The other half is that this must never break chat. Presence lives in Redis and
chat does not; a dev box or a test run without Redis has to degrade to "nobody
is online" rather than failing to send messages.
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from chat import presence

pytestmark = pytest.mark.django_db


class FakeRedis:
    """Enough Redis to exercise the counting, without needing a server."""

    def __init__(self):
        self.store = {}
        self.expiries = {}

    def incr(self, key):
        self.store[key] = int(self.store.get(key, 0)) + 1
        return self.store[key]

    def decr(self, key):
        self.store[key] = int(self.store.get(key, 0)) - 1
        return self.store[key]

    def delete(self, key):
        self.store.pop(key, None)
        self.expiries.pop(key, None)

    def expire(self, key, seconds):
        self.expiries[key] = seconds

    def mget(self, keys):
        return [self.store.get(k) for k in keys]


@pytest.fixture
def fake_redis(monkeypatch):
    client = FakeRedis()
    monkeypatch.setattr(presence, "_redis", lambda: client)
    return client


# ── Counted, not a flag ──────────────────────────────────────────────────


def test_the_first_connection_brings_someone_online(fake_redis):
    assert presence.connected(7) is True
    assert presence.online_user_ids([7]) == {7}


def test_a_second_tab_does_not_re_announce(fake_redis):
    """Only the first connection is worth announcing — opening another tab
    changes nothing anybody can see."""
    assert presence.connected(7) is True
    assert presence.connected(7) is False


def test_closing_one_of_two_tabs_leaves_them_online(fake_redis):
    """The whole reason this is a count.

    A boolean would have shown them offline here while their other tab is still
    connected.
    """
    presence.connected(7)
    presence.connected(7)

    assert presence.disconnected(7) is False
    assert presence.online_user_ids([7]) == {7}


def test_closing_the_last_tab_takes_them_offline(fake_redis):
    presence.connected(7)
    presence.connected(7)
    presence.disconnected(7)

    assert presence.disconnected(7) is True
    assert presence.online_user_ids([7]) == set()


def test_going_offline_removes_the_key_rather_than_leaving_a_zero(fake_redis):
    """A zero is indistinguishable from "never connected", and keeping one
    would grow a key per user who has ever opened the app."""
    presence.connected(7)
    presence.disconnected(7)

    assert presence._key(7) not in fake_redis.store


# ── The TTL that stops ghosts ────────────────────────────────────────────


def test_every_connection_sets_an_expiry(fake_redis):
    """If a worker is killed its `disconnect` never runs, so without an expiry
    that user shows online forever."""
    presence.connected(7)
    assert fake_redis.expiries[presence._key(7)] == presence.PRESENCE_TTL_SECONDS


def test_a_heartbeat_refreshes_the_expiry(fake_redis):
    """A long-idle tab would otherwise expire and read as offline while its
    socket is still open."""
    presence.connected(7)
    fake_redis.expiries[presence._key(7)] = 5

    presence.heartbeat(7)

    assert fake_redis.expiries[presence._key(7)] == presence.PRESENCE_TTL_SECONDS


# ── Degrading without Redis ──────────────────────────────────────────────


def test_everything_degrades_quietly_without_redis(monkeypatch):
    """Chat must keep working on a box with no Redis. Presence is decoration;
    it must never be the thing that stops a message being sent."""
    monkeypatch.setattr(presence, "_redis", lambda: None)

    assert presence.connected(7) is False
    assert presence.disconnected(7) is False
    assert presence.online_user_ids([7]) == set()
    presence.heartbeat(7)  # must not raise


def test_a_redis_failure_is_swallowed(monkeypatch):
    class Broken:
        def incr(self, *a):
            raise ConnectionError("redis is down")

        def mget(self, *a):
            raise ConnectionError("redis is down")

    monkeypatch.setattr(presence, "_redis", lambda: Broken())

    assert presence.connected(7) is False
    assert presence.online_user_ids([7]) == set()


# ── Last seen ────────────────────────────────────────────────────────────


def test_last_seen_is_persisted(company, payroll_setup):
    """The opposite kind of fact from `online`: it has to survive a restart,
    which is why it is a column and not a Redis key."""
    emp = payroll_setup["emp"]
    assert emp.last_seen_at is None
    presence.touch_last_seen(emp)
    emp.refresh_from_db()

    assert emp.last_seen_at is not None
    assert timezone.now() - emp.last_seen_at < timedelta(seconds=30)


def test_touching_last_seen_on_nobody_is_harmless(company):
    """A connected user with no employee record is a real configuration — an
    HR admin who is not themselves an employee."""
    presence.touch_last_seen(None)  # must not raise


# ── Through the API ──────────────────────────────────────────────────────


def test_the_endpoint_reports_online_and_last_seen(
    company, payroll_setup, hr_client, fake_redis
):
    emp = payroll_setup["emp"]
    presence.connected(emp.user_id)
    presence.touch_last_seen(emp)
    response = hr_client.get(f"/api/v1/chat/presence/?user_ids={emp.user_id}")

    assert response.status_code == 200
    row = response.data["presence"][0]
    assert row["user_id"] == emp.user_id
    assert row["is_online"] is True
    assert row["last_seen_at"] is not None


def test_the_endpoint_rejects_a_malformed_id_list(company, hr_client):
    response = hr_client.get("/api/v1/chat/presence/?user_ids=abc")

    assert response.status_code == 400


def test_the_endpoint_returns_empty_for_no_ids(company, hr_client):
    """Asked about nobody, answer about nobody — rather than falling back to
    "everyone", which is the query this endpoint deliberately does not offer."""
    response = hr_client.get("/api/v1/chat/presence/")

    assert response.status_code == 200
    assert response.data["presence"] == []
