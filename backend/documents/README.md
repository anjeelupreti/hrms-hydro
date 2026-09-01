# `documents` app

Company-scoped. Phase 6. Generic file store — any company-scoped model can
own documents via the `ContentType` framework, instead of every app
growing its own `FileField` + storage-path logic. Payslip PDFs
(`payroll`) are its first consumer; employee contracts/uploads (Phase
14) will reuse this unchanged.

## Model

- **`Document`** — `kind` (`PAYSLIP`/`GENERIC`), `file`, `original_filename`,
  plus `content_type`/`object_id`/`content_object` (the generic FK to
  whatever owns this document).

## Storage

Local disk for now (`STORAGES["default"]` in `config/settings/base.py`)
— accepted, but noted as a real risk in `docs/development-plan.md` § Known Risks:
Render redeploys wipe ephemeral disk. `STORAGES` is the single seam for
swapping to an S3-compatible backend (via `django-storages`) later —
`documents/services.py` call sites never need to change.

`document_upload_path` (in `models.py`) deliberately includes
`connection.schema_name` in the file path
(`documents/<company_schema>/<model>/<object_id>/<filename>`) — all
companies currently share one local disk, so this is the only thing
preventing one company's uploads from colliding with (or being trivially
enumerable alongside) another's. **Keep this even after moving to S3.**

## Services (`services.py`)

- `save_generated_document(content_object, filename, content_bytes, kind, actor=None)`
  — the one place a server-generated file (e.g. a rendered payslip PDF)
  gets persisted against any model instance.
- `latest_document_for(content_object, kind=...)` — fetch the most recent
  document for an object (used by `PayslipViewSet.download`).

No serializers/viewsets of its own — consumers (like `payroll`) expose
their own download actions that read through `latest_document_for`
rather than a generic `documents` API surface, since access control
belongs with the owning object (a payslip's permission rules, not a
generic "any document" endpoint).
