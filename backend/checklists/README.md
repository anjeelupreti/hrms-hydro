# `checklists` app

Company-scoped. Phase 17c. Templated **onboarding / offboarding checklists** —
the task-list side of the employee lifecycle (the lifecycle *events* like
promotion/resignation live in [`employees`](../employees/README.md); this is
the "what tasks happen on hire/exit" companion).

## Models

- **`ChecklistTemplate`** (+ **`ChecklistTemplateItem`**) — a reusable list HR
  defines once. `kind` = onboarding/offboarding. Each item has a title and a
  `due_offset_days` (days from checklist start; negative = before, e.g. an
  offboarding task due 2 days before the last working day).
- **`Checklist`** — a template instantiated for one employee. Independent of
  the template after creation (editing the template doesn't rewrite live
  runs). `refresh_status()` auto-completes it once every task is done.
- **`ChecklistTask`** — one task on a live checklist: assignee (optional),
  due date, status (pending/done), completion timestamp.

## Permissions

- Templates: readable by any authenticated user, **HR-only** writes.
- Checklists: **HR** creates/cancels and sees all; a non-HR user sees only
  checklists that are about them or have a task assigned to them, and may
  only toggle the **status** of a task assigned to them (HR can reassign /
  set due dates / edit anything).

## Endpoints (`/api/v1/checklists/`)

| Endpoint | Purpose |
|---|---|
| `GET/POST/PATCH/DELETE templates/` | Template CRUD (writable nested `items`); `?kind=`, `?is_active=` |
| `GET/POST /` | List checklists (`?kind=`, `?status=`, `?employee=`); create instantiates tasks from a template (due dates = today + each item's offset) |
| `GET /<id>/` | One checklist + tasks + `progress` (done/total/pct) |
| `POST /<id>/cancel/` | Cancel a checklist (HR) |
| `PATCH tasks/<id>/` | Mark done/reopen (assignee or HR); reassign / due date (HR) |
| `GET tasks/mine/` | The signed-in user's assigned tasks on active checklists |

Creating from a template copies items → task rows; `created_by`/`updated_by`
are stamped by `core.AuditViewSetMixin` (never sent by the client).
