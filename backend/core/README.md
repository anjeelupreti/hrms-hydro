# `core` app

Shared, cross-cutting infrastructure used by every other app. No models
of its own beyond an abstract base — nothing here needs a migration.

## `models.py` — `AuditModel`

Abstract base giving any company-scoped model `created_at`, `updated_at`,
`created_by`, `updated_by`. `created_by`/`updated_by` are nullable
because system-initiated changes (Celery tasks, the absence-sweep
command, migrations) have no `request.user`.

This only ever shows the *last* edit. Where the history of a field
matters (employment status, department reassignment, attendance
corrections, leave approval decisions), the pattern is a small dedicated
append-only log model instead (`employees.EmployeeLog`,
`attendance.AttendanceEditLog`, `leave.ApprovalAction`) — not a generic
history library. See `docs/development-plan.md` for why.

## `viewsets.py` — `AuditViewSetMixin`

Mix into any `ModelViewSet` to auto-stamp `created_by`/`updated_by` from
`request.user` on create/update — callers never send these fields, and
can't spoof who made a change.

## `permissions.py` — `the permission classes in `accounts/permissions.py``

In `REST_FRAMEWORK.DEFAULT_PERMISSION_CLASSES` for every request. Checks
the authenticated JWT's `company_schema` claim against
`connection.schema_name` — rejects (403) a token replayed against any
company other than the one it was minted for, independent of how the
request got routed there. See `companies/README.md` for the header-based
routing this defends against.

## `pagination.py` — `DefaultPagination`

`PageNumberPagination` with a client-adjustable `page_size` (via
`?page_size=`, capped at 100). The global `REST_FRAMEWORK.DEFAULT_PAGINATION_CLASS`.

## `celery_tasks.py` — `a plain `@shared_task``

Base class for any Celery task touching company-scoped data. Celery
workers have no per-request middleware to set the active schema, so
every company-scoped task must declare `company_schema` as a real,
first parameter and use `base=a plain `@shared_task``. **The parameter must actually
be in the function signature** — Celery validates `.delay()` arguments
against the undecorated function, before this class's `__call__` override
ever runs. `the beat schedule(task, ...)` dispatches one independent
`.delay()` per company (never loop schemas inside a single execution, so
one company's failure/retry can't affect another's). `leave/tasks.py` is
the reference example — see it and `docs/development-plan.md` before adding a new
company-scoped task.
