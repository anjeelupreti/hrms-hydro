# `assets` app

Company-scoped. Phase 17d. **Asset management** — company equipment assigned
to employees and returned on exit (ties into offboarding).

## Models

- **`Asset`** — name, unique `asset_tag`, `category` (laptop/phone/…),
  `serial_number`, `status` (available/assigned/maintenance/retired),
  purchase date, notes, and `assigned_to` (the live current holder).
- **`AssetAssignment`** — one assignment of an asset to an employee. An open
  row (`returned_at` null) is the current holder; the full history stays for
  audit / offboarding.

## Permissions

- Readable by any authenticated user; **create/edit/assign/return are
  HR-only**.

## Endpoints (`/api/v1/assets/assets/`)

| Endpoint | Purpose |
|---|---|
| `GET /` | List; `?status=`, `?category=`, `?assigned_to=` |
| `POST/PATCH/DELETE /<id>/` | Asset CRUD (HR) |
| `POST /<id>/assign/` | `{employee, note}` → opens an assignment, sets status=assigned (400 if already out) |
| `POST /<id>/return/` | Closes the open assignment, sets status=available |
| `GET /<id>/assignments/` | Assignment history for the asset |
| `GET /mine/` | Assets currently assigned to the signed-in employee |
