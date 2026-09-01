/**
 * Changes an employee has asked HR to make to their own record.
 *
 * The approval step exists for one reason: a bank account number changed
 * silently the day before payroll sends somebody's salary somewhere else, and
 * nothing about the run looks wrong afterwards.
 */

export type ChangeRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  /** The employee took it back before anybody decided. */
  | "withdrawn"
  /** They asked again for the same field. Kept, so the sequence stays readable. */
  | "superseded";

export type EmployeeChangeRequest = {
  id: number;
  employee: number;
  employee_name: string;
  field: string;
  field_label: string;
  /** Moves money or establishes legal identity — the approval queue leads with these. */
  is_sensitive: boolean;
  /** What it was when they asked, not what it is now. */
  old_value: string;
  new_value: string;
  reason: string;
  status: ChangeRequestStatus;
  requested_by_name: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
  created_at: string;
};

/**
 * A field that may be asked about, served by the server.
 *
 * **Never hardcoded here.** The allow-list is what stops somebody requesting a
 * change to their own salary, and a second copy of a security rule in the
 * client is a copy that can drift.
 */
export type RequestableField = {
  name: string;
  label: string;
  sensitive: boolean;
  current: string;
  /**
   * The legal values, when the column is constrained — `null` for free text.
   *
   * Without this the form renders a text box over a column with fixed choices,
   * and nothing downstream catches the result: Django's `save()` does not
   * enforce `choices`, so "Divorced" with a capital D goes into the column as
   * typed and stops matching every query that looks for it.
   */
  choices: { value: string; label: string }[] | null;
  /**
   * Whether the column holds a date, so the form can offer a calendar.
   *
   * The other half of `choices`. Submission rejects anything `parse_date`
   * cannot read — which is right, and happens after somebody has typed
   * "next March" and pressed send. Every other date in the product is picked,
   * and there is no reason this one should be the exception that has to be
   * spelled correctly.
   */
  is_date: boolean;
};

export const STATUS_COLOR: Record<
  ChangeRequestStatus,
  "warning" | "success" | "error" | "default"
> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
  withdrawn: "default",
  superseded: "default",
};
