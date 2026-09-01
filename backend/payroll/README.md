# `payroll` app

Company-scoped. Phase 6. Configurable payroll engine — not hardcoded to
one country's tax regime, per `docs/development-plan.md`.

## Models

- **`SalaryComponent`** — one earning or deduction line, one of four
  calculation types: `FLAT` (a fixed amount), `PERCENTAGE_OF` (a rate
  applied to another component's already-computed value),
  `FORMULA` (evaluated with `simpleeval`, never `eval`), or
  `SLAB_BASED` (progressive tax slabs). `order` decides both display and
  computation order — a `FORMULA`/`PERCENTAGE_OF` component can only
  reference the `code` of a component computed *earlier* in the same
  pass. `code` doubles as a `simpleeval` variable name, so it's
  restricted to a valid-identifier shape (`^[a-z][a-z0-9_]*$`).
- **`SalaryStructure`** / **`SalaryStructureAssignment`** — a
  per-employee, effective-dated structure (which components apply, and
  at what amount/rate). Never edited in place — a change is a new
  `SalaryStructure` row with a later `effective_from`, so a payroll run
  for a past period keeps computing against whatever was actually active
  then (same principle as `EmployeeLog`'s append-only history, just via
  effective-dating instead of a log table).
- **`TaxSlab`** — ordered, company-configurable, effective-dated by fiscal
  year. `max_amount = null` means the open-ended top slab.
- **`PayrollRun`** — one per period (`period_year`/`period_month`),
  `DRAFT → PROCESSING → COMPLETED` (or `FAILED`).
- **`Payslip`** — one per employee per run, `DRAFT → FINALIZED → PAID`.
  `PAID` only ever means "recorded as paid manually" —
  `disbursement_method`/`disbursement_reference` are free-text; **no
  money actually moves**. Khalti/eSewa have no payout/disbursement API
  today (see `docs/development-plan.md` § Payments), so this system only ever
  records that a transfer happened outside it.
- **`PayslipLineItem`** — append-only, one row per computed component per
  payslip, storing a snapshot (`component_code`/`component_name`/`amount`
  at calculation time) so a later rename or formula change on
  `SalaryComponent` never rewrites what a past payslip actually showed.
- **`Loan`** (Phase 7) — employee self-service Office/Personal loan
  request: `REQUESTED → APPROVED/REJECTED`, then `ACTIVE → CLOSED` once
  fully repaid. Approval wires `monthly_deduction` into the employee's
  salary structure automatically (see below); repayment is tracked and
  the loan auto-closes at zero balance — no separate "mark repaid" step.

## Loans (`services.activate_loan` / `apply_loan_repayments`)

Approving a `Loan` calls `activate_loan()`, which:

1. Gets-or-creates the company-wide `SalaryComponent` (`code="loan_repayment"`,
   `DEDUCTION`/`FLAT`) — shared across every loan in the company, not one
   component per loan.
2. Creates a new `SalaryStructure` version effective today, carrying over
   every existing assignment plus this loan's `monthly_deduction` — same
   "never edit in place" principle as any other structure change.

Each payroll run, `payroll.tasks.process_payslip` calls
`apply_loan_repayments(payslip)` **after** `compute_payslip` (deliberately
*not* wrapped in the same try/except as PDF generation — a loan balance
drifting out of sync with actual deductions is a real correctness bug
that should fail loudly, not a cosmetic rendering issue safe to retry):
it finds the `PayslipLineItem` for the loan's component, decrements
`outstanding_balance` by that amount, and once it reaches zero, closes
the loan and calls `close_loan_deduction()` to remove the deduction from
a new structure version.

**A real bug found here**: two same-day structure-versioning operations
(e.g. one loan activating and another loan's final repayment closing,
both today) collided on `SalaryStructure`'s `(employee, effective_from)`
unique constraint — an uncaught `IntegrityError` inside the Celery chord.
Fixed by extracting `_upsert_structure_version()`: if a version already
exists for that employee/date, its assignments are replaced in place
instead of raising a duplicate-key error. Different dates still always
get a genuinely new, immutable version; only same-day operations merge.
See `docs/development-plan.md` for the full incident note.

## Calculation engine (`services.compute_payslip`)

For an employee/run: resolve the `SalaryStructure` effective on the last
day of that period, then walk its assignments in `component.order`,
building up a `context` dict of `{component_code: computed_value}`:

- `FLAT` → the assignment's amount (or the component's default if unset).
- `PERCENTAGE_OF` → `context[base_code] * (rate / 100)`.
- `FORMULA` → `simpleeval.simple_eval(formula, names=context)` — the
  context is converted to `float` for the eval (Decimal isn't natively
  supported by `simpleeval`'s operators), then the result is quantized
  back to 2 decimal places.
- `SLAB_BASED` → `compute_slab_tax()`, a standard progressive-band
  calculation against that fiscal year's `TaxSlab` rows.

Idempotent by design: rerunning `compute_payslip` for the same
employee/run deletes and recreates that payslip's line items rather than
appending duplicates — useful after fixing a salary structure mid-run.

### Proration by calendar days (`services.compute_proration`)

A month is paid pro-rata by the calendar days the employee is actually
payable in it, not as an all-or-nothing full month. The payable window
starts on the latest of `(month start, structure.effective_from,
employee.date_joined)` and runs to month end; `factor = payable_days /
days_in_month`. So a structure effective on the 31st of a 31-day month
pays `1/31`, and a mid-month joiner is paid from their join date. The
factor scales **FLAT earnings** only — `PERCENTAGE_OF`/`FORMULA`/
`SLAB_BASED` components read the already-prorated earnings from `context`
and so scale automatically, while FLAT *deductions* (loan installments,
fixed obligations) stay whole. `payable_days`/`period_days` are stored on
the `Payslip` for transparency (shown as a "Days" chip in the UI).

Proration is toggled per company by `CompanyProfile.payroll_prorate`
(default **on**); off = any active structure pays the full month. Leavers
aren't special-cased here because a resigned/terminated employee is
already excluded from the run (`run_payroll` filters `ACTIVE`).

### Draft review, HR edits, and the once-only lock

A computed payslip is a **DRAFT** — auto-prefilled but editable. HR can
preview it, adjust any line's amount, add one-off adjustment lines
(earning or deduction), or delete lines; `services.set_payslip_line_items`
rewrites the line items and recomputes gross/deductions/net from them.
`PayslipViewSet.recompute` throws the edits away and re-prefills from the
salary structure.

Making a payslip **ready is a one-way lock**: `PayslipViewSet.finalize`
(or the run-level `finalize`) moves `DRAFT → FINALIZED`, reprints the PDF
from the final figures, and notifies the employee. Every edit endpoint
rejects a non-`DRAFT` payslip — once finalized (and therefore printable),
the figures are immutable.

## Fan-out (`tasks.py`)

`PayrollRun` uses a Celery **`chord`**, not the plain per-company
`.delay()` loop `leave`/`notifications` use — because a run needs a
"done" signal once *every* employee's payslip is computed, not just
"dispatched":

```
run_payroll(company_schema, payroll_run_id)
  → chord([process_payslip.si(company_schema, run_id, employee_id) for each active employee])
    (finalize_payroll_run.si(company_schema, run_id))
```

`process_payslip` computes the payslip, then tries to render its PDF —
**a PDF failure must not fail the task**: it's wrapped in its own
try/except and logged, because the payslip's figures (already committed)
are the actual payroll result; the PDF is just a rendering of them.
Coupling the two meant an environment problem alone (see WeasyPrint note
below) could leave a run stuck at `PROCESSING` forever via the chord,
even though every number was computed correctly.

**Known limitation, left as-is**: if a header task *itself* raises (e.g.
a broken `FORMULA`), the chord's default behavior never calls
`finalize_payroll_run` — the run stays at `PROCESSING` rather than
moving to `FAILED`. Accepted for now since it surfaces as a visibly
stuck run (checked via Celery/Sentry) rather than silently reporting a
partial run as done.

`create_monthly_draft_run` (Beat, 1st of the month) only ever creates a
`DRAFT` — per `docs/development-plan.md`, payroll draft creation is separate from
computation, so HR always explicitly reviews before triggering a run via
`PayrollRunViewSet.run`.

## WeasyPrint — a real environment gotcha

WeasyPrint needs native GTK/Pango/Cairo libraries that aren't part of
the Python package and **aren't installed on a stock Windows dev
machine**. Importing it at module level crashed the entire Django
process (not just PDF generation) the first time this was tried, since
`payroll/tasks.py` is imported by the URL/viewset chain. Fixed by moving
`from weasyprint import HTML` inside `pdf.generate_payslip_pdf()` —
only that one function needs the native libs.

- **Windows dev**: install the
  [GTK for Windows Runtime Environment Installer](https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer)
  (or develop inside WSL) before PDF generation will actually work. If you
  install to anywhere other than WeasyPrint's hardcoded default
  (`C:\Program Files\GTK3-Runtime Win64\bin` — see
  `venv/Lib/site-packages/weasyprint/text/ffi.py`), set
  `WEASYPRINT_DLL_DIRECTORIES` in `.env` to your actual install path, e.g.
  `WEASYPRINT_DLL_DIRECTORIES=C:\GTK3-Runtime\bin`. Without this,
  `os.add_dll_directory()` never points at the right folder and every
  `libgobject-2.0-0.dll` load fails with Windows error `0x7e` even though
  the runtime is genuinely installed — this bit us the first time: the
  installer ran (via `winget install tschoonj.GTKForWindows`, since the
  GUI installer it launches can't be driven non-interactively — downloaded
  and ran the `.exe` directly with the NSIS `/S` silent flag and a custom
  `/D=` target instead) but PDFs still failed until this env var was set.
- **Linux/Docker**: `apt-get install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0`
  in the image — `WEASYPRINT_DLL_DIRECTORIES` is a Windows-only concern,
  irrelevant here.

If a payslip's PDF failed to render (check Celery logs), retry it
without recomputing the payslip via `PayslipViewSet.regenerate_pdf`
(`POST /api/v1/payroll/payslips/{id}/regenerate-pdf/`, HR-only).

## Permissions

Unlike most config in this codebase (leave types, holidays), even *read*
access to payroll data is HR-only (`payroll.permissions.IsHRAdmin`) —
compensation data is sensitive. The one exception is `PayslipViewSet`,
which employees can read but scoped to their own, non-`DRAFT` payslips
only (a draft payslip is a working computation HR hasn't reviewed yet,
not a real paycheck figure).

## Endpoints (`/api/v1/payroll/`)

| Endpoint | Purpose |
|---|---|
| `components/` | `SalaryComponent` CRUD (HR) |
| `tax-slabs/` | `TaxSlab` CRUD (HR) |
| `structures/` | `SalaryStructure` list/retrieve/create only — no update, see model docstring (HR) |
| `runs/` | `PayrollRun` list/retrieve/create (HR) |
| `runs/{id}/run/` | Trigger computation (`DRAFT` → `PROCESSING`, dispatches the chord) |
| `runs/{id}/finalize/` | `COMPLETED` → locks its `DRAFT` payslips to `FINALIZED`, notifies employees |
| `runs/{id}/payslips/` | List payslips for a run |
| `payslips/` | List (HR: all; employee: own, non-draft only) |
| `payslips/{id}/line-items/` (PUT) | Replace a `DRAFT` payslip's lines + recompute totals (HR; 400 if not draft) |
| `payslips/{id}/recompute/` | Discard edits, re-prefill a `DRAFT` from the salary structure (HR) |
| `payslips/{id}/finalize/` | One-way lock `DRAFT` → `FINALIZED`, reprints PDF, notifies (HR) |
| `payslips/{id}/download/` | Payslip PDF (404 if not yet rendered) |
| `payslips/{id}/regenerate-pdf/` | Retry PDF rendering (HR) |
| `payslips/{id}/mark_paid/` | `FINALIZED` → `PAID` (manual disbursement record, HR) |
| `loans/` | List (HR: all; employee: own) / request a loan (employee self-service) |
| `loans/{id}/approve/`, `/reject/` | HR-only decision; approval activates the deduction |

## Celery

```
.\venv\Scripts\celery.exe -A config worker --pool=solo -l info
.\venv\Scripts\celery.exe -A config beat -l info
python manage.py trigger_payroll_draft   # dispatch the monthly draft-run fan-out on demand
```

See [`core/README.md`](../core/README.md) (`a plain `@shared_task``) — every
company-scoped task here declares `company_schema` as a real parameter,
same gotcha as `leave`/`notifications`.
