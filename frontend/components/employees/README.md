# Employees UI

- `app/employees/page.tsx` — MUI X DataGrid, server-side pagination,
  search + department/designation/status filters. Role-gated "Add
  Employee" button (`useMe().role === "hr_admin"` or superuser) and an
  edit icon per row for the same audience.
- `EmployeeFormDialog.tsx` — wide (`maxWidth="md" fullWidth`) modal, not
  a sidebar, per explicit product direction. Split into an outer
  `EmployeeFormDialog` (fetches the record via `useEmployeeDetail` when
  editing) and an inner `EmployeeForm` (keyed by `employeeId`) that
  initializes its `useState` directly from the loaded data — **not** via
  a `useEffect` + `setState`, which trips the `react-hooks/set-state-in-effect`
  ESLint rule and causes cascading renders. Any future "edit form
  pre-filled from an async-loaded record" should copy this shape, not the
  effect-based one.
- Shows `EmployeeLog` history (status changes, reassignments) inline in
  the edit dialog via `useEmployeeLogs`.
- `LifecycleEventDialog.tsx` (Phase 7) — submits a Promotion/Award/
  Resignation/Termination/Transfer via `POST lifecycle-events/`, opened
  from a per-row icon on the Employees list. Fields shown adapt to
  `event_type` (e.g. only a promotion shows the designation picker).
  Deliberately does **not** apply any `Employee` field change itself —
  that only happens after HR approval (`app/employees/lifecycle/page.tsx`),
  except Award which needs none.
- `LifecycleApprovalsInbox.tsx` (Phase 7) — HR-only approval queue, same
  card-list-with-approve/reject-buttons shape as `leave/ApprovalsInbox.tsx`.
  Rendered at the top of `app/employees/lifecycle/page.tsx`.

Data hooks: `hooks/useEmployees.ts`, `hooks/useLifecycle.ts`. Types:
`types/employees.ts`, `types/lifecycle.ts`.
