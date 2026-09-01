"""Who is online, and when they were last seen.

**Counted, not a boolean.** One person routinely has three tabs and a phone. A
flag set false on any disconnect shows them offline while they are still
connected elsewhere — which is worse than no presence at all, because it is
confidently wrong. So connections are counted per user, and "offline" means the
count reached zero.

**In Redis, with a TTL.** Presence is ephemeral: it is true only while a socket
is open, and a database row per connect/disconnect would be a write per tab
switch. The TTL is the part that matters — if a worker is killed, its
`disconnect` never runs and the count is never decremented, so without an
expiry that user shows online forever. The connection refreshes the key while it
lives; nothing refreshes it once the process is gone.

`last_seen_at` is the opposite kind of fact — it must survive a restart — so it
is persisted on the employee record.
"""

import logging

from django.utils import timezone

logger = logging.getLogger(__name__)

#: Long enough to survive a slow network and a missed heartbeat, short enough
#: that a crashed worker's ghost clears within a couple of minutes.
PRESENCE_TTL_SECONDS = 120


def _key(user_id):
    return f"presence:{user_id}"


def _redis():
    """The channel layer's Redis, reused rather than a second connection.

    Returns None when the layer is in-memory (tests, a dev box without Redis),
    and every caller treats that as "presence unavailable" rather than failing —
    chat must keep working without it.
    """
    try:
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        pools = getattr(layer, "_layers", None) or getattr(layer, "pools", None)
        if pools is None:
            return None
        import redis.asyncio as aioredis  # noqa: F401  (import check only)
        from django.conf import settings

        url = settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"][0]
        import redis

        return redis.Redis.from_url(url if isinstance(url, str) else url[0])
    except Exception:  # noqa: BLE001 — presence is decoration, never a blocker
        return None


def connected(user_id):
    """Register a connection. Returns True if this made them newly online."""
    client = _redis()
    if client is None:
        return False
    try:
        key = _key(user_id)
        count = client.incr(key)
        client.expire(key, PRESENCE_TTL_SECONDS)
        return count == 1
    except Exception:
        logger.debug("presence: connect not recorded", exc_info=True)
        return False


def disconnected(user_id):
    """Deregister a connection. Returns True if they are now fully offline."""
    client = _redis()
    if client is None:
        return False
    try:
        key = _key(user_id)
        count = client.decr(key)
        if count <= 0:
            # Delete rather than leave a zero: a zero is indistinguishable from
            # "never connected" to `is_online`, and keeping it would grow a key
            # per user who has ever opened the app.
            client.delete(key)
            return True
        client.expire(key, PRESENCE_TTL_SECONDS)
        return False
    except Exception:
        logger.debug("presence: disconnect not recorded", exc_info=True)
        return False


def heartbeat(user_id):
    """Refresh the TTL for a live connection."""
    client = _redis()
    if client is None:
        return
    try:
        client.expire(_key(user_id), PRESENCE_TTL_SECONDS)
    except Exception:
        logger.debug("presence: heartbeat failed", exc_info=True)


def online_user_ids(user_ids):
    """Which of these users are currently connected.

    Takes a set rather than answering "everyone online", because the only place
    that matters is a list already on screen — and "give me every online user"
    is a query that grows with the company for no benefit.
    """
    client = _redis()
    if client is None or not user_ids:
        return set()
    try:
        # Fixed to a list first: the pairing below relies on the order the ids
        # were sent in, and `user_ids` is a set at every call site.
        ids = list(user_ids)
        values = client.mget([_key(uid) for uid in ids])
        return {
            # strict=True: mget returns one value per key by contract, so a
            # length mismatch means the client misbehaved — and pairing the
            # wrong value to a user reports somebody online who is not.
            uid for uid, value in zip(ids, values, strict=True)
            if value is not None and int(value) > 0
        }
    except Exception:
        logger.debug("presence: lookup failed", exc_info=True)
        return set()


def touch_last_seen(employee):
    """Persist when somebody was last connected.

    Written on disconnect rather than on every message: "last seen" only needs
    to be right to the minute, and a write per keystroke would be the most
    expensive thing in the chat.
    """
    if employee is None:
        return
    employee.last_seen_at = timezone.now()
    employee.save(update_fields=["last_seen_at"])
