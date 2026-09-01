# `chat` app

Company-scoped real-time chat (Phase 11b). Direct messages and named
groups, with message edit/delete and typing indicators, over WebSockets
via **Django Channels** — not polling.

This is the first ASGI/WebSocket surface in the project. Everything else
is request/response over WSGI; chat needed a persistent connection for
live send/receive, so `daphne` was added (first in `SHARED_APPS`) and
`runserver` now serves ASGI automatically.

## Models

- **`Conversation`** — `type` is `dm` (exactly two members, no stored
  name — the UI shows the *other* member) or `group` (2+ members, named).
  `-updated_at` ordering + a bump on every new message keeps the
  conversation list most-recent-first.
- **`ConversationMembership`** — who's in a conversation + `last_read_at`.
  Unread count is simply messages newer than `last_read_at` not sent by
  the member. Plain model (not `AuditModel`): the conversation is audited,
  memberships aren't.
- **`Message`** — `sender` (explicit, non-null — a message always has an
  author), `body`, `edited_at`, `deleted_at`. **Deletion is soft**:
  `deleted_at` is set and `body` is cleared, so the thread keeps its shape
  (the UI renders a "This message was deleted" tombstone) and the deleted
  content is genuinely gone, not just hidden. `edited_at` drives the
  "edited" marker.

## WebSocket auth — the ticket pattern (the important bit)

The browser **never holds the JWT** (it lives in an httpOnly cookie the
Next.js BFF reads server-side), and browsers can't set an `Authorization`
header on a WebSocket handshake. So:

1. Browser asks the BFF for a ticket → BFF (which has the cookie) calls
   `POST /api/v1/chat/ws-ticket/` with the bearer token.
2. Django mints a **short-lived (60s) signed ticket** (`chat/tickets.py`,
   `django.core.signing`) carrying `{user_id, company_schema}` — pinned to
   the company that served the request (`connection.schema_name`, trusted).
3. Browser opens `ws://.../ws/chat/?ticket=<ticket>`.
4. `ChatConsumer.connect()` verifies the ticket and derives the user +
   company from it. A forged/expired ticket → the socket is closed (4001).

The ticket is signed, not encrypted, and grants nothing but a chat
connection for 60s — a far smaller blast radius than exposing the
15-minute access token to JS.

## Company isolation on the channel layer

Channels has no per-request middleware, so `ChatConsumer` does company
resolution itself: the schema comes from the ticket, and **every** DB
access is wrapped in `the ORM(schema)` (via
`database_sync_to_async`). Group names are namespaced by schema —
`chat_<schema>_conv_<id>` and `chat_<schema>_user_<id>` — so a broadcast
in company A can never reach a socket in company B, even though
conversation ids collide across schemas. This is the WebSocket analog of
`core.permissions.the permission classes in `accounts/permissions.py``; it's covered by an explicit
isolation check in the Phase 11b verification.

`config/asgi.py` deliberately does **not** wrap the consumer in
`AuthMiddlewareStack` — the consumer fully self-authenticates via the
ticket, so session-based auth would add nothing. Origin validation
(`AllowedHostsOriginValidator`) is a deployment-hardening item for
Phase 16, not needed for local cross-origin dev.

## What flows over WS vs REST

| Over WebSocket (live) | Over REST (initial load / setup) |
|---|---|
| `message.send`, `message.edit`, `message.delete` | `GET conversations/` (list + unread + last message) |
| `typing` (not persisted) | `POST conversations/` (create DM/group; DMs dedupe) |
| `mark_read` | `GET conversations/{id}/messages/?before=<id>` (paged history) |
| — | `POST conversations/{id}/mark-read/` (fallback if socket is down) |
| — | `GET participants/` (who you can start a chat with) |
| — | `POST ws-ticket/` (mint the connection ticket) |

Message send echoes back to the sender's own socket carrying the
`client_id` it sent, so the frontend can reconcile its optimistic
placeholder. New conversations are pushed to each member's personal group
(`conversation.new`) so a connected socket joins the new conversation
group live, without reconnecting.

`participants/` lists **users**, not employees — chat is user-scoped so
accounts without an `Employee` record (e.g. the HR admin) can still chat.

## Endpoints (`/api/v1/chat/`)

| Endpoint | Purpose |
|---|---|
| `GET/POST conversations/` | List my conversations / create a DM or group. Non-router routes (`participants/`, `ws-ticket/`) are registered before the router so the `conversations/{pk}/` detail pattern can't shadow them. |
| `GET conversations/{id}/messages/?before=` | Paged history (50/page, `has_more` flag), chronological. |
| `POST conversations/{id}/mark-read/` | Set my read cursor. |
| `GET participants/` | Active users except me. |
| `POST ws-ticket/` | Mint a 60s WebSocket ticket. |

WebSocket route: `ws/chat/?ticket=<ticket>` (see `chat/routing.py`).
Frontend WS base URL is `NEXT_PUBLIC_WS_URL` (default `ws://localhost:8000`).

## Frontend entry point

Chat is surfaced as a **Messenger-style floating widget** (a bottom-right
FAB that opens a compact panel), not a sidebar nav item — see
`frontend/components/chat/ChatWidget.tsx`, mounted once globally in
`AppShellLayout`. Because it's always mounted, the WebSocket lives for the
whole session and the unread badge on the FAB stays live on every page.
Unlike most features here, chat is available to **every** authenticated
user (it's user-scoped), so it isn't gated to HR.
