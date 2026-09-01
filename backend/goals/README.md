# `goals` app

Company-scoped. Phase 17c. **Goals / OKRs** — the forward-looking companion to
Performance Reviews (`organization` app, which is backward-looking).

## Models

- **`Objective`** — an individual's goal (`owner` set) or a company-wide one
  (`owner` null). `period` is free-form ("Q3 2026"). **Progress is derived**
  (average of its key results), never stored.
- **`KeyResult`** — a measurable result: `start_value` → `target_value`, with
  a `current_value` that moves via check-ins. `progress` = clamped 0–100% of
  the start→target range. `unit` is cosmetic.

## Permissions

- Everyone sees company objectives (owner null) + their own; HR sees all.
- A non-HR user can only create/edit objectives for **themselves**; HR can
  create company objectives and edit anyone's.

## Endpoints (`/api/v1/goals/objectives/`)

| Endpoint | Purpose |
|---|---|
| `GET /` | List (own + company; all for HR). `?status=`, `?owner=` |
| `POST/PATCH /` | Create/update (writable nested `key_results`); progress recomputes |
| `DELETE /<id>/` | Remove (owner or HR) |
| `POST /<id>/checkin/` | `{key_result, current_value}` — a progress check-in |

Nested `key_results` are replaced wholesale on save (same pattern as
`checklists` templates). Check-in re-fetches the objective before serializing
so the returned progress reflects the just-saved value (not a stale prefetch).
