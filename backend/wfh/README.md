# `wfh` app

Company-scoped work-from-home / remote-work tracking (adapted from the
reference template's "Remote Operations" screen; not a numbered roadmap
phase).

## Model

- **`WFHRequest`** — an employee's request to work remotely for a date
  range: `work_location` (home / remote), `location_note`, `reason`,
  `status` (pending → approved/rejected, or cancelled), and who decided it.
  Deliberately separate from leave: the person is still *working*, so it
  never touches leave balances — it's tracked on its own for the
  remote-operations view. `days` is a derived property.

## Flow & access

Any authenticated employee can request WFH for themselves. Approval mirrors
the leave pattern: **HR/superuser or the employee's own manager** may
approve/reject (`services.can_decide`); the owner can cancel their own.
Each transition notifies through the shared `notify()` — a new request
pings the manager + HR admins (`wfh_requested`), and the decision pings the
employee (`wfh_approved` / `wfh_rejected`). Listing is scoped: HR sees all,
a manager sees their reports + themselves, everyone else sees only their
own.

## Metrics

`GET requests/summary/` returns a live snapshot: `remote_today` (approved
requests covering today, scoped), `remote_count`, `onsite_count`,
`pending_count`, and `remote_percent` (share of active headcount remote
today) — feeding the Remote Work dashboard hero.

## Endpoints (`/api/v1/wfh/`)

| Endpoint | Purpose |
|---|---|
| `GET requests/?status=&employee=` | List (scoped). |
| `POST requests/` | Employee self-request. |
| `GET requests/summary/` | Remote-today metrics. |
| `POST requests/{id}/approve/`, `/reject/` | HR or manager decision. |
| `POST requests/{id}/cancel/` | Owner (or HR) withdraws. |

Notification verbs (`wfh_requested` / `wfh_approved` / `wfh_rejected`) are
in the frontend icon + route maps, so those notifications deep-link to
`/wfh`.
