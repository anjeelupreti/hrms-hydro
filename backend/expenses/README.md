# `expenses` app

Company-scoped. Phase 14. Employee expense claims and reimbursement — an
employee submits a claim (optionally with a receipt), HR approves/rejects,
then marks it reimbursed once paid out-of-band.

## Models

- **`ExpenseClaim`** — one claim.
  - `category` — `travel`/`meals`/`supplies`/`software`/`training`/`other`.
  - `status` — `pending → approved → reimbursed`, or `rejected`, or
    `cancelled` (by the submitter while still pending/approved).
  - `receipt` — optional uploaded file (served via a gated endpoint, not a
    public media URL).
  - Decision/settlement audit: `decided_by`/`decided_at`/`decision_note`,
    `reimbursed_at`/`reimbursement_reference`.

## Permissions

- Non-HR users see and manage only **their own** claims.
- HR (`role=hr_admin` or superuser) sees all claims and performs
  approve/reject/reimburse.
- The viewset is list/retrieve/create only — state changes go through the
  explicit action endpoints below (no blanket update/delete), so every
  transition is deliberate and auditable.

## Endpoints (`/api/v1/expenses/claims/`)

| Endpoint | Who | Purpose |
|---|---|---|
| `GET claims/` | all (scoped) | `?status=` filter; HR sees everyone, others only their own. `?export=xlsx` for a styled workbook (HR) |
| `POST claims/` | employee | Submit a claim (multipart when attaching a receipt) |
| `GET claims/<id>/` | owner/HR | Retrieve one |
| `POST claims/<id>/approve/` | HR | pending → approved |
| `POST claims/<id>/reject/` | HR | pending → rejected (with note) |
| `POST claims/<id>/reimburse/` | HR | approved → reimbursed (records reference) |
| `POST claims/<id>/cancel/` | owner | pending/approved → cancelled |
| `GET claims/<id>/receipt/` | owner/HR | Streams the receipt file (gated) |

XLSX export uses the shared `XlsxExportMixin` (same helper as
[`reports`](../reports/README.md) and payroll).
