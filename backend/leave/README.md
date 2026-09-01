# `leave` app

Company-scoped. This is also the phase (Phase 4) where real Celery
(worker + beat) actually gets stood up — Phases 0-3 deliberately used
plain management commands instead. See "Celery" below and `core/README.md`.

## Models

- **`LeaveType`** — name, `is_paid`, `annual_quota_days`,
  `carry_forward_allowed`, `max_carry_forward_days`. Deliberately merges
  what the original architecture doc called `LeaveType` + `LeavePolicy`
  into one configurable model — no evidence yet of needing per-grade
  quota variants for the same leave type.
- **`ApprovalChain`** / **`ApprovalStep`** — **one company-wide chain**
  (not per-leave-type), ordered steps resolved by **role**
  (`services.ApprovalStep.ApproverRole`: `manager` = the requester's
  actual manager, `hr_admin` = *any* HR admin, not one fixed person) —
  never a specific user baked into the chain. `services.get_default_chain()`
  lazily creates a sensible 2-step default (Manager → HR Admin) the first
  time it's needed, so a fresh company never hard-fails a leave request
  for lack of configuration.
- **`LeaveBalance`** — per employee/leave-type/year ledger:
  `allocated_days`, `carried_forward_days`, `used_days`,
  `remaining_days` (computed property). Lazily created on first need
  (`services.get_or_create_balance`) with `allocated_days` defaulted from
  the leave type's `annual_quota_days` — you don't need the annual
  accrual job to have run yet for balances to exist in dev/test.
- **`LeaveRequest`** — `days_requested` (decimal — supports 0.5 for a
  single-date half-day request, or a full date range), two independently
  computed flags stored at submission time (see below), `current_step`
  (pointer into the chain).
- **`ApprovalAction`** — append-only decision history (who, when, which
  step, approved/rejected, comment) — same pattern as
  `employees.EmployeeLog` / `attendance.AttendanceEditLog`.

## `is_paid` vs `exceeds_balance` — two different questions

Easy to conflate, don't:
- **`is_paid`**: does payroll pay for this request? `leave_type.is_paid`
  **and** the employee wasn't on probation (`Employee.probation_end_date`)
  on the start date.
- **`exceeds_balance`**: does this draw more than the tracked quota? Only
  depends on `leave_type.is_paid` — **not** the employee's probation
  status, because probation leave still deducts from the balance (a
  deliberate policy decision: quota accounting and payroll treatment are
  separate concerns). Get this wrong and an unpaid-due-to-probation
  request silently stops warning about overdrafts.

Both are computed once at submission and stored, so they reflect
conditions *at request time* even if probation status or the balance
changes before a decision is made.

## Approval flow

`services.submit_leave_request()` → notifies the resolved approver(s) for
step 1 → `services.decide()` on approve/reject: rejects finalize
immediately; approvals either advance `current_step` (notifying the next
step's approver) or, on the last step, finalize as `approved` and deduct
`days_requested` from the balance. A `MANAGER` step with no assigned
manager auto-skips (there's no one to approve it) rather than stalling
the request forever. Every transition calls `notifications.services.notify()`.

## Endpoints (`/api/v1/leave/`)

| Endpoint | Purpose |
|---|---|
| `GET/POST types/`, `approval-chains/` | HR-managed config |
| `GET balances/` | Self / direct reports (manager) / everyone (HR) |
| `POST requests/` | Submit — see the two-flags note above |
| `GET requests/` | Same self/reports/everyone scoping as balances |
| `GET requests/pending-my-action/` | Requests whose *current step* resolves to you specifically — computed server-side (`can_act_on_step`), since the frontend can't replicate the manager/HR-admin resolution logic on its own |
| `POST requests/{id}/approve/`, `/reject/`, `/cancel/` | |
| `GET requests/{id}/actions/` | Full decision history |

## Celery

```
celery -A config worker --pool=solo -l info   # --pool=solo required on Windows
celery -A config beat -l info
```

`tasks.apply_annual_leave_accrual` (via `core.celery_tasks.a plain `@shared_task``)
allocates the new year's balance and applies carry-forward; it's a no-op
unless today is the reset day (Jan 1 — a fixed single reset day is an
accepted v1 simplification, see `docs/development-plan.md`) unless `force=True`.
`tasks.fanout_annual_leave_accrual` dispatches it once per company via
`core.celery_tasks.the beat schedule`. For manual testing without
waiting for the schedule:

```
python manage.py trigger_leave_accrual --force
```

**Gotcha that bit us**: any function using `base=a plain `@shared_task`` must declare
`company_schema` as a real, first parameter — Celery validates
`.delay()`/`.apply_async()` arguments against the plain function
signature *before* `a plain `@shared_task`.__call__` ever runs, so a function that
omits it fails with a confusing "got multiple values for argument" error
the moment a caller passes a schema name positionally. See
`core/README.md` and `docs/development-plan.md` for the full story.
