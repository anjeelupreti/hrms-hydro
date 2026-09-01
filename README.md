# HRMS Hydro

An HRMS — an operating system, really — for a hydropower group. One company,
one deployment, one database.

Django/DRF backend, Next.js frontend (App Router, MUI), Celery for the
scheduled work, Postgres. Attendance, leave, payroll, recruitment, documents,
the org chart and the rest, in the terms this industry and this country
actually run in: Bikram Sambat, SSF, Provident Fund, CIT, Nepali tax slabs.

## What this is not

It began as a multi-tenant SaaS product and is no longer one. That branch lives
on separately; **this** tree has had the whole idea removed rather than
switched off — there is no tenant, no schema-per-customer, no platform console,
no subscription, no seat cap, no self-service sign-up and no marketing site.

The distinction matters when reading the code. A comment mentioning "the
company" means *this* company. There is nobody above the customer: the people
who deploy this are the technical administrators, and inside the product the
most senior account is the owner.

* **No `django-tenants`.** One schema, the ordinary Postgres backend, no
  `search_path` juggling and no pooled-connection restriction.
* **No public/marketing surface.** `/` sends you to the dashboard or to the
  login screen. The only world-readable pages are the company's own careers
  board and a candidate's offer link, both listed in `frontend/proxy.ts`.
* **The first account is made from the shell**, not from a sign-up form —
  `manage.py bootstrap_owner`. A private HRMS with a public "create your
  account" page is a door with nothing behind it but risk.

## Who can do what

Four roles, and the split between the middle two is the point.

| Role | What it means |
|---|---|
| **Owner** | The account the system was installed under. Holds everything, and is the only one who can appoint an HR admin. |
| **HR admin** | Shapes the system: creates employees, companies, slabs, leave types. Appoints and demotes officers. |
| **HR officer** | Operates the system: views, edits, approves, processes. Creates nothing and deletes nothing. |
| **Employee** | Their own record, their own payslips, their own leave. |

An officer's capabilities are granted one at a time — the role by itself
carries nothing, which is what makes "as per their scope" mean something.

All of it is decided in one file, [`backend/accounts/policy.py`](backend/accounts/policy.py):
the permission list, who holds what by role, and the *verb* axis that separates
creating and deleting from everyday operation. `backend/accounts/permissions.py`
is the only place that maps an HTTP request onto it.

## Companies

A hydropower group is not one company. It is a holding company and a project
company per licence, each with its own registration and its own payroll.

* `companies.Company` — the operating entities, with the group structure, the
  registration numbers, and the project facts (stage, installed capacity,
  river, licence).
* `Employee.primary_company` — who employs somebody. Exactly one, and it is
  what a payslip names.
* `Employee.secondary_companies` — where else they work. No payroll attaches.

The two are separate fields because "who works at Sanjen?" and "whose payroll
does Sanjen run?" are different questions and both get asked.

Not to be confused with `organization.CompanyProfile`, which is the singleton
the deployment itself runs on — the calendar, the fiscal year, the office
hours.

## Layout

```
backend/      Django project (manage.py lives here) — DRF, Celery, Channels
frontend/     Next.js app (App Router, TypeScript, MUI)
deployment/   docker-compose.yml, Dockerfiles, render.yaml
scripts/      smoke-routes.sh
```

## Running it

```bash
# Backend
cd backend
python -m venv .venv && .venv/Scripts/activate      # or source .venv/bin/activate
pip install -r requirements/dev.txt
cp .env.example .env                                 # SECRET_KEY, DB_*, at minimum
python manage.py migrate
python manage.py bootstrap_owner --email you@company.com.np
python manage.py seed_statutory_rates                # the country pack
python manage.py seed_reminder_rules
python manage.py runserver

# Frontend
cd frontend
npm install
npm run dev
```

`seed_demo` fills a review environment with realistic Nepali data. Never wire
it into production startup.

### Tests

```bash
cd backend
pytest                      # needs a real Postgres — see config/settings/test.py
```

```bash
cd frontend
npx tsc --noEmit
npm run build
```
