# `accounts` app

Company-scoped — the company schema has its own `User` table, its own
password hashes, its own everything. There is no cross-company login.

## Models

- **`User`** (`AbstractUser` + `role`) — `role` is a minimal RBAC flag
  (`hr_admin` / `employee`), not a full permission system. Any
  authenticated user can read most things; only `hr_admin`/superuser can
  write, via `permissions.IsHRAdminOrReadOnly`. Full configurable RBAC
  (custom roles per company, manager-scoped permissions beyond what
  `employees.Employee.manager` already gives us) is real future scope,
  not built yet.

## `utils.py` — `generate_temp_password()`

Cryptographically random password generator, shared by the password-reset
flow and by `employees` (auto-provisioning a `User` when an `Employee` is
created). If you need "generate a temp password and email it" anywhere
else, reuse this — don't reimplement.

## Endpoints (`/api/v1/accounts/`)

| Endpoint | Purpose |
|---|---|
| `POST token/` | Login — SimpleJWT, with a custom `company_schema` claim (`serializers.CompanyTokenObtainPairSerializer`) |
| `POST token/refresh/` | Rotates the refresh token (rotation + blacklist-after-rotation both on) |
| `POST token/blacklist/` | Logout |
| `GET me/` | Current user — includes `role`, `is_superuser`, and `employee_id` (null if this login has no linked `Employee` record, e.g. a pure HR/admin account) |
| `POST password-reset/request/` | Always 200 — doesn't leak whether the email exists. Emails a confirmation link if it does |
| `POST password-reset/confirm/` | Validates the link (Django's own `default_token_generator`, so it self-invalidates once the password changes), generates a new password via `generate_temp_password()`, emails it — the user never picks their own password through this flow |

The frontend never calls these directly — see `frontend/README.md`'s Auth
section for the BFF layer that does, and keeps the JWTs in httpOnly
cookies the browser's JS can't read.
