# `organization` app

Company-scoped. Phase 9. Two mostly-unrelated features share this app
because they're both "company-wide configuration HR manages once": org
profile / per-company email settings, and Performance Reviews.

## Models

- **`CompanyProfile`** — singleton per company (`get_solo()`, `pk=1`):
  name, logo (`ImageField`), address, timezone, `working_days` (a JSON
  list of ISO weekday numbers, e.g. `[1,2,3,4,5]`). Configurable, not a
  hardcoded weekend — same principle as the attendance calendar (Phase
  8) and `Holiday` (Phase 5): don't bake in one country's assumptions.
- **`CompanyEmailSettings`** — singleton per company (`get_solo()`). Lets a
  company's HR send email under their own SMTP account/From-address
  instead of the deployment default. **Real security surface** — see
  below. Phase 11c added `imap_host`/`imap_port`/`imap_use_ssl` so the
  same account also backs the company inbox (see the `mail` app); the
  username/encrypted password are shared between SMTP and IMAP.
- **`ReviewCycle`** — `DRAFT → ACTIVE → CLOSED`.
- **`Review`** — one per employee per cycle, created by
  `services.start_cycle()`. `reviewer` **snapshots** the employee's
  manager at cycle-start time (same "snapshot, don't recompute"
  principle as `payroll.PayslipLineItem`) — a later manager reassignment
  doesn't retroactively change who's reviewing an in-progress cycle.
  Flow: `PENDING_SELF → PENDING_MANAGER → COMPLETED` (or straight to
  `COMPLETED` if the employee has no manager at all).

## Per-company email settings — the real security surface

This was deliberately deferred from Phase 5 (see `docs/development-plan.md`) exactly
because it needed to be built carefully, not squeezed into an unrelated
phase. What's actually in place:

- **Encrypted at rest.** `CompanyEmailSettings.encrypted_password` is a
  `BinaryField`, encrypted with `cryptography.Fernet` using
  `settings.FIELD_ENCRYPTION_KEY` (generate one per environment — see
  `.env.example`). **Never rotate this key in place** once real company
  passwords exist: `get_password()` fails closed to `""` on
  `InvalidToken` rather than raising, so a silently-broken key doesn't
  crash outgoing mail — it just quietly stops authenticating, which is
  its own risk to be aware of, not a reason to skip key-rotation
  planning.
- **Never round-tripped back out.** `CompanyEmailSettingsSerializer`'s
  `password` field is write-only; every read response only exposes
  `password_is_set` (a boolean). There is no endpoint, admin view, or
  log line anywhere that prints a decrypted password.
- **Read access is HR-only, not just write.** Unlike almost everything
  else in this codebase (`Holiday`, `LeaveType`, etc. are read-open,
  write-restricted), even *reading* the SMTP host/username is gated to
  HR admins — see `CompanyEmailSettingsView`.
- **Test-connection before saving.** `EmailConnectionTestView` opens a
  real SMTP connection with candidate credentials and reports success/
  failure *without persisting anything* — HR finds out immediately if
  credentials are wrong, rather than discovering it only when the next
  real email silently fails to send.
- **`organization.email_backend.CompanyAwareEmailBackend`** (the
  `EMAIL_BACKEND` setting) reads the current company's active
  `CompanyEmailSettings` and overrides host/port/credentials/from-address
  per-connection; falls back to the deployment default (`EMAIL_HOST` etc.
  in `.env`) when the company has none configured, or when called outside
  the company schema (public schema has no such table — fails closed to the
  default rather than raising).

## Reviews (`services.py`)

- `start_cycle(cycle)` — creates one `Review` per active employee,
  snapshotting `reviewer = employee.manager`. Idempotent
  (`get_or_create`), so it's safe to call again after adding employees
  mid-cycle.
- `submit_self_assessment(review, text, rating)` — sets the self fields,
  advances status to `PENDING_MANAGER` (or straight to `COMPLETED` if
  there's no reviewer), notifies the reviewer.
- `submit_manager_assessment(review, actor, text, rating)` — sets the
  manager fields, advances to `COMPLETED`, notifies the employee.

## Endpoints (`/api/v1/organization/`)

| Endpoint | Purpose |
|---|---|
| `GET/PATCH company-profile/` | Singleton; read: any authenticated user, write: HR |
| `GET/PATCH email-settings/` | Singleton; **HR-only in both directions** |
| `POST email-settings/test-connection/` | Test candidate SMTP settings without saving |
| `POST email-settings/test-imap/` | Test candidate IMAP settings without saving (blank password reuses the saved one) |
| `GET/POST review-cycles/` | HR creates; read-open (employees should see an active cycle exists) |
| `POST review-cycles/{id}/start/` | HR-only — creates the `Review` rows |
| `GET reviews/` | HR: all. Employee: own (as employee or as reviewer) |
| `POST reviews/{id}/submit-self/` | Owner only, only while `PENDING_SELF` |
| `POST reviews/{id}/submit-manager/` | Reviewer or HR, only while `PENDING_MANAGER` |

## A real proxy bug found while building the logo upload

The frontend's generic BFF proxy (`frontend/app/api/proxy/[...path]/route.ts`)
forced every non-GET request's `Content-Type` to `application/json` and
read the body via `.text()` — fine until this phase's company-logo
upload, the first `multipart/form-data` request ever sent through it.
Forcing the content type stripped the multipart boundary (Django
couldn't parse the body at all), and `.text()` would have corrupted the
binary file bytes even if the header had been correct — the same class
of bug as the payslip-PDF-download corruption found in Phase 6, just on
the request side instead of the response side. Fixed by preserving the
original `Content-Type` header and reading the body via `arrayBuffer()`
instead of `text()`.
