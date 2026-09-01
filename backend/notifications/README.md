# `notifications` app

Company-scoped. Started minimal in Phase 4 (email + in-app only, because
`leave` genuinely needed it then); Phase 5 generalized it into the real
thing: Web Push, a full feed page, and birthday/anniversary/holiday
Celery Beat reminders.

## Models

- **`Notification`** — recipient, `verb` (short machine tag like
  `leave_requested`), `message` (human-readable, carries all context
  itself). **No FK back to `LeaveRequest` or anything else** — by
  design, so this stays decoupled from every app that calls `notify()`.
- **`NotificationPreference`** — per-user `email_enabled`,
  `in_app_enabled`, `push_enabled`. Auto-created (`get_or_create`) on
  first use, defaulting to email+in-app on, push off.
- **`PushSubscription`** — one row per browser/device a user has
  subscribed on (a user can have several — phone, laptop, etc., all get
  notified). `endpoint` is the browser-assigned unique identifier;
  re-subscribing from the same browser updates the existing row.
- **`Holiday`** — company-configurable, explicit `date` per year (not a
  recurring month/day) since festivals like Dashain/Tihar/Eid shift on
  the Gregorian calendar year to year — HR adds each year's holidays
  rather than the system assuming a fixed date. Same configurability
  pattern as `LeaveType`/`ApprovalChain`.
- **`CompanyEvent`** (Phase 8) — a company-wide calendar entry
  (meeting/interview/announcement/other). Distinct from `Holiday` (a
  whole-day, whole-company non-work day) and from any individual
  employee's attendance/leave. `location` (Phase 11a) added for the
  room/video-link.
- **`MeetingAttendee`** (Phase 11a) — per-attendee invite/RSVP for a
  `CompanyEvent`, the gap explicitly flagged as deferred back in Phase 8.
  `organizer` is just the event's `created_by` (from `AuditModel`) — no
  separate field. Meaningful mainly for `event_type=MEETING`/`INTERVIEW`;
  an `ANNOUNCEMENT` calendar entry has no attendees.
- **`Announcement`** (Phase 11a) — company-wide or department-scoped
  broadcast (`department=None` = company-wide). Publishing fans out
  through the existing `notify()` — no separate delivery mechanism.

## `services.py` — `notify(user, verb, message, email_subject=None)`

The one function every other app should call to notify someone. Sends
email/in-app/push per that user's `NotificationPreference`. Email goes
through `core.email.safe_send_mail` (never raises — a bounce/rejection
must not break whatever business action triggered the notification).
Push goes through `pywebpush`; a 404/410 response (browser/OS says the
subscription is gone for good) deletes the stale `PushSubscription`
rather than retrying it forever; anything else is logged, not raised.

## Web Push (VAPID) setup

Keys must be **raw base64url**, not PEM — see `docs/development-plan.md` for why
`py_vapid`'s default PEM-file API wasn't used. Generate a pair per
environment (dev/staging/prod each need their own — never share):

```python
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
import base64

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")

private_key = ec.generate_private_key(ec.SECP256R1())
private_raw = private_key.private_numbers().private_value.to_bytes(32, "big")
public_raw = private_key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)

print("VAPID_PRIVATE_KEY=" + b64url(private_raw))
print("VAPID_PUBLIC_KEY=" + b64url(public_raw))
```

Set `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_CONTACT_EMAIL` in
`.env`. Without them, `notify()`'s push path is a silent no-op (not an
error) — safe to leave unset in an environment that doesn't need push yet.

## Celery Beat reminders

`tasks.py`, fanned out per-company via `core.celery_tasks.a plain `@shared_task`` (same
pattern as `leave/tasks.py`):

| Task | Logic |
|---|---|
| `send_birthday_reminders` | Notifies the employee directly + their manager (not the whole company — see docs/development-plan.md for why broadcasting every birthday company-wide doesn't scale) |
| `send_work_anniversary_reminders` | `date_joined` month/day match, skips the join year itself |
| `send_holiday_reminders` | Broadcasts to **every** active employee — unlike birthdays, a holiday is operationally relevant to everyone |

For manual testing without waiting for the Beat schedule:
```
python manage.py trigger_reminders birthday|anniversary|holiday
```

## Endpoints (`/api/v1/notifications/`)

| Endpoint | Purpose |
|---|---|
| `GET /`, `POST {id}/mark-read/`, `POST mark-all-read/`, `GET unread-count/` | The in-app feed |
| `GET/PATCH preferences/` | Your own `NotificationPreference` |
| `GET vapid-public-key/` | For the frontend's `PushManager.subscribe({ applicationServerKey })` |
| `POST push-subscribe/`, `POST push-unsubscribe/` | Registers/removes a `PushSubscription`; subscribing also flips `push_enabled` on, unsubscribing (when it was your last device) flips it off |
| `GET/POST/PATCH/DELETE holidays/` | HR-managed. **Registered before the empty-prefix notification routes in `urls.py`** — that viewset's own `/{pk}/` detail route would otherwise shadow `/holidays/` if registered first; see the comment in `urls.py`. |
| `GET/POST/PATCH/DELETE company-events/?start=&end=` | HR-managed (read: any authenticated user); same registration-order note as `holidays/` above applies. `start`/`end` filter to events overlapping that range. |
| `GET/POST meetings/`, `POST meetings/{id}/rsvp/` | Any authenticated user can create a meeting (`event_type` forced to `meeting`/`interview`); creating one builds the underlying `CompanyEvent` plus one `MeetingAttendee` per invited employee via `services.invite_attendees`. `rsvp/` takes `{ "status": "accepted"\|"declined" }`; only the invited employee may respond to their own invite. |
| `GET/POST/DELETE announcements/?active_only=` | HR-managed (read: any authenticated user). `perform_create` calls `services.publish_announcement`, which notifies the target scope (one `department` or, if unset, every active employee) through the same `notify()` used everywhere else — no separate delivery path. |

### RSVP prefetch-staleness bug (found & fixed, Phase 11a)

`MeetingViewSet.get_queryset()` prefetches `attendees` for list/detail
efficiency. The `rsvp()` action originally called
`services.respond_to_invite()` (which mutates the `MeetingAttendee` via
a separately-fetched instance) and then re-serialized the *same* `event`
object returned by `self.get_object()` — but that object's `attendees`
prefetch cache was already populated **before** the mutation, so the
response echoed the stale pre-RSVP status even though the DB was
correct. Fixed by re-fetching the event through `get_queryset()` again
right before serializing the response, so the prefetch is rebuilt from
current DB state. Worth remembering for any other view that mutates a
related row via a separate instance after `get_object()` already
prefetched it.
