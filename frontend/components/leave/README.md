# Leave UI

- `app/leave/page.tsx` — combines several sections: `ApprovalsInbox`
  (only rendered if there's anything in it), HR-only `LeaveTypeManager`,
  a balance summary (`useMyLeaveBalances`, requires `useMe().employee_id`),
  and "my requests" history.
- `LeaveRequestDialog.tsx` — wide modal. Date range → live day-count
  preview (client-side estimate; the server is the source of truth for
  the actual `days_requested` computation, including half-day handling).
  Shows a warning (not a block) if the request would exceed the
  remaining balance for that leave type — matches the backend's
  "allow with a warning, approver decides" policy.
- `ApprovalsInbox.tsx` — pulls from `GET /leave/requests/pending-my-action`,
  **not** a client-side filter of the full request list — the
  manager-vs-HR-admin approver resolution is server-side logic
  (`leave.services.can_act_on_step`) that the frontend has no way to
  replicate correctly on its own. Shows the `exceeds_balance`/unpaid
  flags as chips so the approver sees them before deciding.
- `LeaveTypeManager.tsx` — compact inline list + add-dialog for HR.
  There's no dedicated `ApprovalChain` editing UI yet — the tenant-wide
  default chain is created lazily server-side
  (`leave.services.get_default_chain`) and rarely needs hand-editing;
  manage it via the API directly if you do.

Data hooks: `hooks/useLeave.ts`. Types: `types/leave.ts`.
