# `companies` app

The operating companies people are employed by.

**Not the same thing as `organization.CompanyProfile`.** That is the singleton
this deployment runs on — the calendar, the fiscal year, the office hours, one
row. This is a *list*: a hydropower group runs several legal entities at once,
typically one per licence, and a person is employed by one of them while
frequently working across others.

## Models

- **`Company`** — one legal entity.
  - `name`, `code` — both unique. The code is the identifier: it is what
    payroll exports and employee codes are keyed on, and what fits where a
    registered name will not.
  - `legal_name` — only where it differs from the name people use.
  - `kind` — `parent` / `subsidiary` / `spv` / `jv` / `branch`.
  - `parent` — the group structure, self-referential, `SET_NULL`. Dissolving a
    holding company must not delete the subsidiaries' records with it.
    `clean()` walks the chain, because A→B→A is the loop that actually gets
    created and it makes every org-chart read non-terminating.
  - `registration_number`, `pan_vat_number`, `licence_number`,
    `established_on`.
  - `project_stage` — survey · licensed · construction · commissioning ·
    operation · not applicable. Where a project is in its life decides the
    shape of its workforce: under construction it is mostly civil staff on
    fixed terms; the same company operating is a small permanent crew.
  - `installed_capacity_mw` — decimal, not integer. Plants of 4.5 and 25.5 MW
    are ordinary and rounding one to 5 misstates a licence.
  - `river`, `address`, `district`, `province`, contact fields, `logo`.
  - `is_active` — a company that has been wound up is deactivated, never
    deleted. It still owns the employment history of everyone who worked for
    it, and a payslip naming an entity absent from the database is unreadable.

## One primary, several secondary

The two fields live on `employees.Employee`:

- **`primary_company`** — who actually employs somebody. Exactly one. It signs
  their contract, files their tax and appears on their payslip.
  `on_delete=PROTECT`: nulling it would silently detach a payroll from its
  employer.
- **`secondary_companies`** — where else they work. A chief engineer at the
  parent seconded to two project SPVs; a shared finance team serving the whole
  group. No employment relationship and no money.

Splitting them is what lets a headcount question have an answer. "Who works for
Sanjen Jalavidyut?" and "whose payroll does Sanjen run?" are different
questions, and a single many-to-many cannot tell them apart. The employee list
filter `?company=<id>` answers the first (payroll *or* secondment); the
`employee_count` on this app's serializer answers the second.

## API

`/api/v1/companies/companies/`

- Readable by anyone signed in — an employee's own profile names their company,
  so hiding the list would only make the name render as a number.
- Writing needs `settings.manage`, and **creating** or **deleting** additionally
  needs an admin role: an HR officer may keep the details current and may not
  invent a new entity. See the verb section of `accounts/policy.py`.
- `DELETE` is refused with `409` and a count while anybody is on the payroll —
  stated in words rather than surfacing as a foreign-key error.
- `GET options/` returns just id, name, code and kind, for the two pickers on
  the employee form.
