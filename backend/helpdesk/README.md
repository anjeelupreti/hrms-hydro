# `helpdesk` app

Company-scoped. Phase 17d. Internal **support tickets** (IT / HR / facilities /
payroll) with a comment thread.

## Models

- **`Ticket`** — subject, description, `category`, `priority`
  (low→urgent), `status` (open → in_progress → resolved → closed).
  `requester` = who raised it (`created_by`), `assignee` = who's handling it,
  `resolved_at` set when status hits resolved.
- **`TicketComment`** — a reply (`created_by` = author).

## Permissions

- A non-HR user sees tickets they raised or are assigned; may comment on
  those and open/close **their own**.
- HR sees all, sets assignee/priority/category/status, and comments.

## Endpoints (`/api/v1/helpdesk/tickets/`)

| Endpoint | Purpose |
|---|---|
| `GET /` | List (own/assigned; all for HR). `?status=`, `?category=`, `?priority=`, `?assignee=` |
| `POST /` | Open a ticket (requester = the caller) |
| `GET /<id>/` | Ticket + comment thread |
| `PATCH /<id>/` | HR: status/assignee/priority/category. Requester: open/close only |
| `POST /<id>/comment/` | Add a comment (participant only) |

Comment/checkin-style mutations re-fetch the ticket before serializing so the
response reflects the just-added comment (avoids a stale prefetch).
