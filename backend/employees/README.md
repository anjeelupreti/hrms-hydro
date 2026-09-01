# `employees` app

Company-scoped. The core HR record — most other apps (`attendance`,
`leave`) FK into `Employee`, not `accounts.User` directly, since an
`Employee` carries the employment data a `User` shouldn't (department,
manager, employment status, ...).

## Models

- **`Department`**, **`Designation`** — simple lookup tables, HR-managed.
- **`Employee`** — `user` (1:1 to `accounts.User`), `employee_code`
  (auto-generated, `EMP-0001` sequential per company), `department`,
  `designation`, `manager` (self-FK — the org chart), `employment_status`
  (active/on_leave/resigned/terminated — **never hard-deleted**, status
  change only, since attendance/leave/payroll history must survive),
  `probation_end_date` (nullable — while set and in the future relative
  to a date, `leave.services.submit_leave_request` marks requests unpaid
  regardless of the leave type's own `is_paid` flag, without affecting
  balance deduction; see `leave/README.md`).
- **`EmployeeLog`** — append-only history for `employment_status`,
  `department`, `designation`, `manager`, `probation_end_date` changes:
  who, when, from what, to what. Not a generic history library — a
  small dedicated model, the same pattern `attendance.AttendanceEditLog`
  and `leave.ApprovalAction` also use. Extend `TRACKED_FIELDS` in
  `serializers.EmployeeWriteSerializer` (and `EmployeeLog.Field` choices)
  if another field needs this treatment.

## Employee creation side-effect

Creating an `Employee` auto-provisions the linked `User`: username
derived from the email's local part (with collision suffixing), a random
temp password via `accounts.utils.generate_temp_password()`, and a
welcome email with those credentials. There's no separate "invite" step.

## Lifecycle workflows (Phase 7) — `LifecycleEvent` / `LifecycleApprovalAction`

Promotion/Award/Resignation/Termination/Transfer are **first-class
workflow objects**, not a raw `PATCH` to `Employee.employment_status` or
`.department`/`.designation`/`.manager`. A `LifecycleEvent` carries an
`effective_date` and goes through `PENDING_APPROVAL → APPROVED/REJECTED`
(HR-only, see `services.decide`) — **except `AWARD`**, which changes no
`Employee` field at all (it's informational) and is applied immediately
on submission with no approval step.

Once `APPROVED`, `services.apply_event()` writes the actual field change
and an `EmployeeLog` entry — **the same log every other change already
uses**, deliberately not a second parallel history mechanism. If
`effective_date <= today` at approval time, this happens immediately;
otherwise the event sits `APPROVED` until the daily Celery Beat sweep
(`tasks.apply_due_lifecycle_events` / `fanout_apply_due_lifecycle_events`)
catches it once the date arrives.

`LifecycleApprovalAction` is the append-only decision log — same shape
as `leave.ApprovalAction`.

### Endpoints (`/api/v1/employees/lifecycle-events/`)

| Endpoint | Purpose |
|---|---|
| `GET/POST lifecycle-events/` | List (HR: all; employee: own + direct reports) / submit a new event |
| `GET lifecycle-events/pending-approval/` | HR-only approval queue |
| `POST lifecycle-events/{id}/approve/`, `/reject/` | HR-only decision |
| `POST lifecycle-events/{id}/cancel/` | Owner or HR, only while `PENDING_APPROVAL` |
| `GET lifecycle-events/{id}/actions/` | Decision history for one event |

## Endpoints (`/api/v1/employees/`)

| Endpoint | Purpose |
|---|---|
| `GET/POST departments/`, `designations/` | HR-managed lookups |
| `GET/POST employees/` | Paginated, filterable (`department`, `designation`, `employment_status`) + searchable (code/name/email) |
| `GET/PATCH/PUT employees/{id}/` | Detail / update — no `DELETE` |
| `GET employees/{id}/logs/` | `EmployeeLog` history, newest first |

Reads: any authenticated company user. Writes: `role=hr_admin` or
superuser (`accounts.permissions.IsHRAdminOrReadOnly`). Lifecycle events
have their own, stricter permission model — see above.

## Celery

```
python manage.py trigger_lifecycle_sweep   # dispatch the due-events fan-out on demand
```
