# Payroll components

Phase 6. Pairs with `hooks/usePayroll.ts` and `types/payroll.ts`.

- **`SalaryStructureDialog.tsx`** — opened from the Employees list (a
  payments icon next to Edit, HR-only). Shows an employee's salary
  structure history read-only, plus a form to save a **new** version —
  there's no edit/update here on purpose: `SalaryStructure` is never
  edited in place (see `backend/payroll/README.md`), so this dialog only
  ever creates a new effective-dated row.

## Pages (`app/payroll/`)

- **`page.tsx`** — role-aware landing. HR sees the Payroll Runs list
  (with summary cards standing in for a full Payroll Report until Phase
  13's Reports module exists) plus links to Components/Tax Slabs config
  and a "New Run" action. Employees see their own "My Payslips" list
  instead — same route, different view, decided by `useMe().role`.
- **`components/page.tsx`** — Salary Components CRUD (HR-only). The form
  adapts its fields to `calc_type` (e.g. only shows the "percentage of"
  component picker when `calc_type === "percentage_of"`).
- **`tax-slabs/page.tsx`** — Tax Slabs CRUD (HR-only).
- **`runs/[id]/page.tsx`** — a single run's payslips, with "Run Payroll"
  (draft → processing), "Finalize" (completed → payslips locked to
  finalized + employees notified), per-payslip PDF download, and a
  "Mark paid" dialog that's explicit about only recording a manual
  transfer — Khalti/eSewa have no payout API, so nothing here actually
  moves money. Polls while `status === "processing"` (see
  `usePayrollRun`'s `refetchInterval`) since payslip computation happens
  async via Celery.
- **`loans/page.tsx`** (Phase 7) — role-aware like the landing page: HR
  sees every loan with Approve/Reject actions; employees see their own
  and a "Request Loan" button. Approving a loan auto-wires its deduction
  into the employee's salary structure server-side — this page has no
  separate "activate" step, just approve/reject.

## A real bug found while building this

The generic BFF proxy (`app/api/proxy/[...path]/route.ts`) read every
upstream response body via `.text()` before this phase — fine for JSON,
but the first binary-body endpoint (`payslips/{id}/download`, a PDF)
exposed that this silently corrupts binary payloads via a UTF-8
decode/re-encode round-trip, and also dropped the upstream
`Content-Disposition` header (losing the intended download filename).
Fixed by switching to `.arrayBuffer()` and forwarding
`Content-Disposition` when present. Worth remembering for any future
binary-download endpoint routed through this proxy.
