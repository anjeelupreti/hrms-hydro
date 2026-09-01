# HRMS Hydro — Backend Developer Guide (Django & DRF)

The definitive reference for the backend: architecture, data model, request
lifecycle, background tasks, technology rationale and coding conventions.

---

## 1. Core Architecture & System Overview

Python 3.12, Django 5.1, Django REST Framework 3.15, PostgreSQL.

**One company, one database, one schema.** This began as a schema-per-tenant
SaaS product and the whole mechanism has been removed rather than switched off:
there is no `django-tenants`, no `search_path` switching, no public schema, no
platform console and no subscription. A deployment serves exactly one company,
on its own branch, and the people who run the deployment are its technical
administrators.

What that buys, and it is worth being explicit because the old design's costs
are visible all over the git history:

* An ordinary `django.db.backends.postgresql` connection — so a pooled
  endpoint (PgBouncer in transaction mode, Neon's `-pooler` host) is safe
  again, where before it could run a query against the wrong customer's data.
* Celery tasks that take the arguments they actually need. No task carries a
  schema name as its first parameter, and there is no fan-out step.
* Group names, upload paths and cache keys that are not namespaced by a schema
  that no longer exists.

---

## 2. Technology Stack & Dependency Rationale

| Layer / Library | Package & Version | Why Used / Purpose | Where Defined / Configured |
|---|---|---|---|
| **Core Framework** | `Django 5.1`, `djangorestframework 3.15` | Robust ORM, batteries-included security, flexible REST viewsets & serializers | `config/settings/base.py`, `config/urls.py` |
| **Database Adapter** | `psycopg 3.2` | Native PostgreSQL 16+ driver — async capability, connection pooling, binary copy performance | `.env`, `config/settings/base.py` |
| **Authentication** | `djangorestframework-simplejwt 5.3` | Stateless JWT auth (access 15 min, refresh 7 days) | `accounts/views.py`, `accounts/serializers.py` |
| **Async & WebSockets** | `channels 4.1`, `channels-redis 4.2`, `daphne 4.1` | ASGI for real-time messaging (chat, presence) | `config/asgi.py`, `chat/consumers.py` |
| **Task Queue** | `celery 5.4`, `redis 5.0` | Async execution — email, payslip PDF rendering, the nightly sweeps | `config/celery.py`, `*/tasks.py` |
| **Payroll Engine** | `simpleeval 1.0` | Safe expression evaluation for custom salary components, without `eval()` | `payroll/services.py`, `payroll/models.py` |
| **PDF Generation** | `weasyprint 63.0` | HTML/CSS-to-PDF for payslips and training certificates | `payroll/pdf.py`, `training/views.py` |
| **Spreadsheets** | `openpyxl 3.1` | Excel (`.xlsx`) exports for HR, payroll, leave and attendance | `reports/views.py`, `core/exports.py` |
| **Push Notifications** | `pywebpush 2.3` | Web Push (VAPID) for browser notifications | `notifications/services.py` |
| **Encryption** | `cryptography 49.0` | Fernet encryption for the company's stored SMTP password | `organization/models.py` (`CompanyEmailSettings`) |
| **Storage & Media** | `django-storages 1.14`, `boto3 1.35`, `Pillow 12.0` | Attachments, avatars, S3-compatible or local media | `documents/models.py`, `config/settings/base.py` |
| **2FA / Security** | `pyotp 2.9`, `qrcode 7.4` | Opt-in TOTP two-factor auth | `core/totp.py`, `accounts/views.py` |

---

## 3. Database Schema & Data Models

One `INSTALLED_APPS`, in `config/settings/base.py`. There is no shared/tenant
split to keep on the right side of.

### Base Models & Core Mixins (`core/models.py`)

* **`AuditModel`** — the abstract base nearly every model extends:
  - `created_at` (`DateTimeField`, `auto_now_add=True`)
  - `updated_at` (`DateTimeField`, `auto_now=True`)
  - `created_by` (`ForeignKey` to User, nullable)
  - `updated_by` (`ForeignKey` to User, nullable)

  `created_by` / `updated_by` are nullable because system-initiated changes —
  a Celery task, a migration, a seed — have no `request.user`.

### Two things called "company", and they are not the same

* **`organization.CompanyProfile`** — the singleton the deployment runs on.
  One row. The calendar (Bikram Sambat or Gregorian), the fiscal year, the
  office hours, the timezone, the logo.
* **`companies.Company`** — a *list*. The legal entities in the group: a
  holding company and typically one project company per licence, each with its
  own registration, licence number, installed capacity and payroll.

An employee has one `primary_company` (who pays them; `PROTECT`, because a
payslip has to be able to name its issuer) and any number of
`secondary_companies` (where else they work; no payroll attaches). Two fields
rather than one list because "who works at Sanjen?" and "whose payroll does
Sanjen run?" are different questions and both get asked.

---

## 4. Request Lifecycle & Auth Flow

```
[ Frontend / BFF ]
        │
        ▼ (HTTP request, Bearer access token)
[ RequestContextMiddleware ] ──> Binds a request id for every log line
        │
        ▼
[ SimpleJWT Auth ] ──────────> Validates the token, resolves request.user
        │
        ▼
[ DRF permission classes ] ──> accounts.permissions → accounts.policy
        │
        ▼
[ ViewSet / serializer ] ────> Business logic; serializers strip what the
        │                      caller may not read (see EmployeeDetailSerializer)
        ▼
[ Response JSON / file stream ]
```

### Authorization

Every question goes to **`accounts/policy.py`**, which is the only place that
decides. Three layers, kept apart deliberately:

| Layer | Answers | Example |
|---|---|---|
| Role | where you sit | owner · hr_admin · hr_officer · employee |
| Permission | what you may do | `payroll.run`, `leave.approve` |
| Verb | how far | view · edit · create · delete |
| Scope | over whom | the manager relationship |

**The verb is the axis worth understanding.** An HR officer holding
`people.manage` may edit an employee and may not create or delete one. It is a
second axis rather than a longer permission list, because
`people.manage.create` and its fourteen siblings would be a model nobody can
hold in their head — and one nobody can hold in their head is one nobody
audits.

`accounts/permissions.py` maps a request onto that, and it reads the **viewset
action** rather than the HTTP method. `POST /employees/` creates a person;
`POST /leave-requests/12/approve/` is somebody doing their job. Gating on the
method would stop an officer approving leave, running payroll or clocking
anybody in — precisely what they exist to do.

Roles:

* **Owner** — created by `manage.py bootstrap_owner`, never appointable. Holds
  everything, and is the only account that can appoint or demote an HR admin.
* **HR admin** — holds everything by role. Appoints and demotes officers.
* **HR officer** — holds *nothing* by role. Capabilities are granted one at a
  time, which is what makes "as per their scope" mean something.
* **Employee** — self-service: their own attendance, leave, payslips, claims.

---

## 5. Background Task Processing (Celery & Redis)

Ordinary `@shared_task` functions — there is no schema to carry, so no task
base class and no fan-out. Everything scheduled is listed in
`CELERY_BEAT_SCHEDULE` in `config/settings/base.py`; the task itself decides
whether today is a day it should do anything (the leave accrual, for instance,
is a no-op except on the fiscal new year).

```bash
# Worker (solo pool required on Windows)
celery -A config worker --pool=solo -l info

# Beat, for the nightly sweeps and the reminders
celery -A config beat -l info
```

`CELERY_TASK_ALWAYS_EAGER=true` runs tasks inline for a deployment with no
worker. It keeps every feature working and silently disables the whole beat
schedule — see the comment on the setting before reaching for it.

---

## 6. App Directory Reference

Each app has its own `README.md`.

| App | Main models / components | Purpose |
|---|---|---|
| [`core`](core/README.md) | `AuditModel`, calendars, observability, media | Base mixins, the calendar abstraction, request-id logging, gated media serving, pagination and export helpers. |
| [`accounts`](accounts/README.md) | `User`, `PermissionGrant`, `policy.py` | Roles, capabilities, the delegation API, JWT auth, TOTP 2FA, password recovery, account provisioning. |
| [`companies`](companies/README.md) | `Company` | The group's operating entities — the legal companies people are employed by. |
| [`employees`](employees/README.md) | `Employee`, `Department`, `Designation`, `LifecycleEvent`, `EmployeeLog` | The employment record, the org hierarchy, lifecycle events, the change-request queue, spreadsheet import. |
| [`attendance`](attendance/README.md) | `Shift`, `ShiftAssignment`, `AttendanceLog`, `Device`, `AttendanceDeviceEvent` | Punch sessions, biometric ingest, shifts, lateness, regularisation. |
| [`leave`](leave/README.md) | `LeaveType`, `LeaveBalance`, `LeaveRequest` | Entitlements, accrual and carry-forward, the approval flow. |
| [`payroll`](payroll/README.md) | `SalaryComponent`, `SalaryStructure`, `PayrollRun`, `Payslip` | Salary computation, tax slabs, statutory schemes, disbursement files, payslip PDFs. |
| [`organization`](organization/README.md) | `CompanyProfile`, `CompanyEmailSettings`, `ReviewCycle`, `Review` | System-wide settings, the encrypted SMTP credentials, performance reviews, setup readiness. |
| [`notifications`](notifications/README.md) | `Notification`, `ReminderRule`, `Holiday`, `PushSubscription` | The notification centre, Web Push, the configurable reminder engine. |
| [`documents`](documents/README.md) | `Document`, `RepositoryDocument` | Generic document storage, visibility rules, signature requests, access logging. |
| [`crm`](crm/README.md) | `Client`, `Contact`, `Deal`, `Invoice`, `ClientTicket` | The company's own customers: pipeline, invoicing, and the client desk. |
| [`projects`](projects/README.md) | `Project`, `Task`, `Subtask` | Work delivery, boards, estimates. |
| [`expenses`](expenses/README.md) | `ExpenseClaim` | Reimbursement: draft → submitted → approved → paid. |
| [`recruitment`](recruitment/README.md) | `Job`, `Candidate`, `Offer` | The public careers board, the ATS pipeline, offer links, hire-to-employee conversion. |
| [`training`](training/README.md) | `Program`, `Enrollment`, `Certificate` | Programmes, enrolment, completion, certificate PDFs. |
| [`chat`](chat/README.md) | `Conversation`, `Message` | Real-time messaging over Channels, with a REST fallback and Redis presence. |
| [`mail`](mail/README.md) | `MailMessage` | The company mailbox, over the configured IMAP/SMTP. |
| [`wfh`](wfh/README.md) | `WfhRequest` | Work-from-home requests and approval. |
| [`reports`](reports/README.md) | Export service | One export engine producing JSON or styled `.xlsx`. |
| [`checklists`](checklists/README.md) | `Checklist`, `ChecklistTask` | Onboarding and offboarding. |
| [`goals`](goals/README.md) | `Objective`, `KeyResult` | OKRs for teams and individuals. |
| [`helpdesk`](helpdesk/README.md) | `Ticket`, `TicketComment` | Internal IT and HR support. |
| [`surveys`](surveys/README.md) | `Survey`, `Question`, `Response` | Feedback surveys and pulse polls. |
| [`timesheets`](timesheets/README.md) | `Timesheet`, `TimeEntry` | Weekly project time tracking. |
| [`assets`](assets/README.md) | `Asset`, `AssetAssignment` | Hardware and software inventory, and who holds what. |
| [`personal`](personal/README.md) | `Todo`, `Note` | A person's own scratch space. |
| [`dashboard`](dashboard/README.md) | — | The composed dashboard payload. |

---

## 7. Developer Conventions

1. **URL routing** — `/api/v1/<app_name>/`, DRF `DefaultRouter` for standard
   viewsets.
2. **Serializers** — always an explicit `fields` list, never `'__all__'`.
   Nested for reads, flat primary keys for writes.
3. **Viewsets** — `ModelViewSet` or `GenericViewSet` with an explicit
   `queryset`, `serializer_class` and `permission_classes`. Errors as
   `{"detail": "…"}` or `{"field": ["…"]}`.
4. **Authorisation** — never spell a rule out inline. Ask `accounts.policy`,
   and name the capability a viewset gates with `required_permission`. A rule
   written in a view is a rule the next caller skips.
5. **Dates** — never hardcode a calendar. `core.calendars.company_calendar()`
   answers "which calendar?" and `fiscal_year_for()` answers "which year?".
   A built-in Nepal rule is the thing that costs us the engine.

---

## 8. Local Setup & Commands

### Prerequisites

* Python 3.12+
* PostgreSQL 16 and Redis (Docker Desktop, or
  `deployment/docker-compose.yml`)

```bash
# 1. Environment
python -m venv .venv && .venv/Scripts/activate     # or source .venv/bin/activate
pip install -r requirements/dev.txt
cp .env.example .env

# 2. Schema
python manage.py migrate

# 3. The first account — the only step that cannot be done from inside
python manage.py bootstrap_owner --email you@company.com.np

# 4. Reference data
python manage.py seed_statutory_rates
python manage.py seed_reminder_rules

# 5. Serve
python manage.py runserver 0.0.0.0:8000

# 6. Tests (needs a real Postgres — see config/settings/test.py)
pytest
```

`python manage.py seed_demo` fills a review environment with realistic Nepali
data. Never wire it into production startup.
