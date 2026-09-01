# `training` app

Company-scoped Learning & Development (Phase 12) — training programs,
scheduled sessions, and per-employee enrollment with completion tracking.

## Why this exists

Every HRMS needs a training/L&D surface, and it's usually
compliance-serious rather than nice-to-have:

- **Compliance** — safety, anti-harassment, data-privacy courses that
  regulators/auditors require you to *prove* everyone completed. That
  needs a durable, per-person, per-run record — not a spreadsheet.
- **Development** — onboarding, skills courses, certifications tied to
  performance and career growth.

The whole point is being able to answer "who has (and hasn't) completed
X, and when" at any time.

## What it consists of — a 3-level model

The shape mirrors how training actually happens:

| Model | Role | Example |
|---|---|---|
| **`TrainingProgram`** | the reusable course *definition* (title, category, delivery mode) | "Workplace Safety 101" |
| **`TrainingSession`** | a *scheduled run* of a program (start/end, location, capacity, trainer, status) | Safety 101 · Aug 1 · Room A · 20 seats |
| **`Enrollment`** | one employee's place in a session, with outcome | Jane → completed, score 88 |

Separating program from session is deliberate: you define "Fire Safety"
**once** and run it every quarter (many sessions), tracking completion
**per person per run** (enrollments) — that's the audit trail. Modelling
this as a single flat "training record" would lose the reuse and the
per-run history.

## How it works

**Two ways an employee gets into a session** (the Phase 12 decision):

1. **Request → approve** — an employee browses open sessions and requests
   a seat (`Enrollment.status = requested`); HR approves (→ `enrolled`)
   or declines (→ `declined`).
2. **HR assigns** — HR puts an employee straight into a session
   (→ `enrolled`), no request step.

**Completion** — HR marks the outcome: `completed` (with an optional
0–100 `score` and free-text `feedback`) or `no_show`. An employee can
`cancel` their own seat.

**Certificates** — HR issues a completion certificate per participant
(`enrollments/{id}/issue-certificate`) or in bulk for a session
(`sessions/{id}/issue-certificates` with `enrollment_ids`). Issuing
completes the enrollment if it isn't already, stamps
`certificate_issued_at`, renders a branded PDF (WeasyPrint → stored as a
`documents.Document` of kind `certificate`; best-effort, same graceful
degradation as payslip PDFs) and notifies the participant
(`training_certificate`). The PDF is fetched via
`enrollments/{id}/certificate` (participant or HR). `has_certificate` on
the enrollment tells the UI whether to show "View" or "Issue".

**Seats / capacity** — `capacity = 0` means unlimited. Only `enrolled`
and `completed` enrollments occupy a seat; a pending `requested` doesn't,
so requests never block a seat before HR has decided. `is_full` /
`seats_taken` are computed on the session.

**Notifications** — every transition reuses `notifications.notify()`:
a new request notifies all HR admins (`training_requested`); assign /
approve / decline / complete notify the affected employee
(`training_enrolled` / `training_declined` / `training_completed`). These
verbs are in the frontend's notification icon map.

## Permissions

- **Programs & sessions** — `IsHRAdminOrReadOnly`: any authenticated user
  can browse (employees need to see what's on offer), only HR can
  create/edit.
- **Enrollments** — open to authenticated users, but scoped: an employee
  only ever sees and acts on *their own* (self-request, cancel own); the
  approve / decline / complete / assign actions are HR-gated inside the
  viewset. HR sees every enrollment.

## Endpoints (`/api/v1/training/`)

| Endpoint | Purpose |
|---|---|
| `GET/POST/PATCH/DELETE programs/` | Programs (write: HR). `?is_active=&category=` filters. |
| `GET/POST/PATCH/DELETE sessions/?program=&status=` | Sessions (write: HR). |
| `POST sessions/{id}/assign/` | HR assigns employees: `{ "employee_ids": [...] }`. |
| `GET/POST enrollments/?session=&status=&employee=` | List (scoped) / employee self-request `{ "session": id }`. |
| `POST enrollments/{id}/approve/`, `/decline/` | HR decides a pending request. |
| `POST enrollments/{id}/complete/` | HR marks outcome: `{ "status": "completed"\|"no_show", "score"?, "feedback"? }`. |
| `POST enrollments/{id}/cancel/` | Employee (own) or HR withdraws a seat. |

Verified end-to-end (15/15 checks): create program/session, employee
request, HR approve, HR direct-assign, seat/capacity accounting,
complete with score+feedback, cancel, and permission gating (employee
gets 403 on HR-only actions).
