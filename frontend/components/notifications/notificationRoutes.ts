// Where a notification takes you when clicked. Keyed by the same `verb`
// strings the backend's notify() emits (see backend/notifications and each
// app's services). Kept next to notificationIcons.tsx — extend both
// together whenever a new notify() verb is added.
const VERB_ROUTES: Record<string, string> = {
  leave_requested: "/leave",
  leave_approved: "/leave",
  leave_rejected: "/leave",
  lifecycle_event_pending: "/employees/lifecycle",
  lifecycle_event_approved: "/employees/lifecycle",
  lifecycle_event_rejected: "/employees/lifecycle",
  lifecycle_event_applied: "/employees/lifecycle",
  payroll_draft_created: "/payroll",
  payslip_finalized: "/payroll",
  birthday: "/",
  birthday_report: "/",
  work_anniversary: "/",
  holiday: "/",
  review_cycle_started: "/reviews",
  review_pending_manager: "/reviews",
  review_completed: "/reviews",
  meeting_invited: "/meetings",
  announcement_posted: "/announcements",
  training_requested: "/training",
  training_enrolled: "/training",
  training_declined: "/training",
  training_completed: "/training",
  training_certificate: "/training",
  document_signature_requested: "/documents",
  document_signed: "/documents",
  document_signature_declined: "/documents",
  expense_submitted: "/expenses",
  expense_approved: "/expenses",
  expense_rejected: "/expenses",
  expense_reimbursed: "/expenses",
  wfh_requested: "/wfh",
  wfh_approved: "/wfh",
  wfh_rejected: "/wfh",
};

/** Route to navigate to when a notification is clicked, or null if the
 * verb has no meaningful destination (falls back to just marking read). */
export function getNotificationRoute(verb: string): string | null {
  return VERB_ROUTES[verb] ?? null;
}
