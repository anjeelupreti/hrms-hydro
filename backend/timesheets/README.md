# `timesheets` app

Company-scoped. Phase 17c. Hours logged against **CRM projects** — the
project-time-tracking extension flagged in the integration backlog. Built so
the data can later feed billing/payroll without a redesign (hence the
`billable` flag and an approval step).

## Model

- **`TimeEntry`** — one employee's hours on one project on one day. FK to
  `crm.Project` (+ optional `crm.ProjectTask`), `date`, `hours` (0–24
  validated), `description`, `billable`, `status`
  (`submitted → approved`/`rejected`) with `decided_by`/`decided_at`.

## Permissions

- A non-HR user sees and logs only **their own** entries; may edit/delete
  their own while not yet approved.
- HR sees everything and approves/rejects.

## Endpoints (`/api/v1/timesheets/entries/`)

| Endpoint | Purpose |
|---|---|
| `GET /` | List (own, or all for HR). Filters: `project`, `status`, `employee`, `billable`, and `start`/`end` date range |
| `POST /` | Log time (employee = the requester) |
| `PATCH/DELETE /<id>/` | Edit/remove own entry (not once approved, unless HR) |
| `POST /<id>/approve/`, `/reject/` | HR decision |
| `GET /summary/` | Total hours + hours grouped by project (respects the same filters) |
