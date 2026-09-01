# `crm` app

Company-scoped. Phase 10. The most CRM-adjacent, least HR-core module in
the roadmap — deliberately sequenced last among the HR-core work (per
`docs/development-plan.md`).

## Models

- **`Client`** — a company/organization the company does business with.
- **`Contact`** — a person at a `Client`.
- **`Deal`** — lead/opportunity pipeline. `stage`
  (`lead → qualified → proposal → won/lost`) is the whole point of the
  kanban board on the frontend — dragging a card between columns is just
  a `PATCH` to this one field.
- **`Project`** — client-scoped project tracking (status, dates, owner).
- **`Activity`** — a logged interaction (call/email/meeting/note),
  generically linkable to a `Client`, `Contact`, or `Deal` via
  `ContentType` — same pattern as `documents.Document` — rather than
  three mostly-null FK columns on one model.

## Permissions — deliberately open, unlike most of this codebase

Every other config/record model in this app gated writes to
`role=hr_admin` (`IsHRAdminOrReadOnly`). CRM records don't fit that
split — a "sales rep" isn't necessarily an HR admin, and this codebase
has no such role yet. Per an explicit decision (see `docs/development-plan.md`),
**any authenticated company user can create/edit CRM records** for now.
Revisit with real per-record ownership/role restrictions if that proves
too permissive in practice — this was chosen as the simplest fit for
right now, not a permanent architectural stance.

## Activities (`serializers.ActivitySerializer`)

Write accepts exactly one of `client`, `contact`, or `deal` (a plain FK
id) — the serializer resolves it into `content_type`/`object_id`
internally, so the frontend never has to know `ContentType` exists.
Read exposes the same three back as `related_type`/`related_id`/
`related_label` (a human-readable string via `str(related_object)`).

## Endpoints (`/api/v1/crm/`)

| Endpoint | Purpose |
|---|---|
| `GET/POST/PATCH/DELETE clients/` | `?search=` filters by name; `?status=` filters active/inactive |
| `GET/POST/PATCH/DELETE contacts/` | `?client=<id>` |
| `GET/POST/PATCH/DELETE deals/` | `?client=`, `?stage=`, `?owner=` — `PATCH stage` is how the kanban board moves a card |
| `GET/POST/PATCH/DELETE projects/` | `?client=`, `?status=`, `?owner=` |
| `GET/POST activities/` | `?client=<id>` / `?contact=<id>` / `?deal=<id>` — exactly one at a time |
