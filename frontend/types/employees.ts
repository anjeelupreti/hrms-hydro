export type EmploymentStatus =
  | "active"
  | "on_leave"
  /** Employed, not working, locked out. Derived from a `Suspension` record
   *  rather than set by hand, so the roster and the login cannot disagree. */
  | "suspended"
  | "resigned"
  | "terminated";

export type BloodGroup = "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";

export const BLOOD_GROUPS: BloodGroup[] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
export type Gender = "male" | "female" | "other" | "";

export type Department = {
  id: number;
  name: string;
  code: string;
  description: string;
};

export type Designation = {
  id: number;
  title: string;
  department: number | null;
};

export type EmployeeListItem = {
  id: number;
  user_id: number;
  employee_code: string;
  full_name: string;
  email: string;
  phone: string;
  photo: string | null;
  department_name: string | null;
  designation_title: string | null;
  employment_status: EmploymentStatus;
  date_joined: string | null;
  manager: number | null;
  supervisor_ids?: number[];
  /** The approval chain, in order. The last one is the checker whose approval
   *  a leave request needs — see `leave.services.effective_chain`. */
  supervisors?: { id: number; name: string; employee_code: string; order: number }[];
  manager_name: string | null;
  /** Whose payroll they are on — the roster can be read and filtered by it. */
  primary_company: number | null;
  primary_company_name: string | null;
  /** The chair and the work. Two fields because they move independently —
   *  see `Employee.corporate_post` in the backend. */
  corporate_post_name: string | null;
  corporate_role_name: string | null;
};

export type EmployeeDetail = {
  id: number;
  /**
   * The approval chain, in order.
   *
   * Distinct from `manager`: the manager draws the org chart, these are the
   * people a leave request goes to. The **last** one is the checker whose
   * approval is required; the rest are notified — see
   * `leave.services.effective_chain`.
   */
  supervisors: { id: number; name: string; employee_code: string; order: number }[];
  employee_code: string;
  full_name: string;
  /** Served by `EmployeeDetailSerializer` all along and simply absent here, so
   *  nothing could read it — the same shape of gap `PayrollRun` had. */
  photo: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string | null;
  gender: Gender;
  date_joined: string;
  employment_status: EmploymentStatus;
  department: number | null;
  designation: number | null;
  manager: number | null;
  probation_end_date?: string | null;
  created_at?: string;
  updated_at?: string;

  /**
   * Which of the group's companies this person belongs to.
   *
   * `primary_company` is who pays them — one, and it is what a payslip names.
   * `secondary_companies` is where else they work and carries no payroll. The
   * two are separate fields rather than one list because "who works at Sanjen?"
   * and "whose payroll does Sanjen run?" are different questions and both get
   * asked. See `companies/models.py`.
   */
  primary_company?: number | null;
  primary_company_name?: string | null;
  secondary_companies?: number[];
  secondary_company_names?: string[];

  /**
   * The establishment post somebody holds, and what they are responsible for.
   *
   * Two fields, because they move independently: two Deputy Managers hold
   * different roles, and somebody promoted out of Senior Engineer usually
   * keeps running the same site.
   */
  corporate_post?: number | null;
  corporate_post_name?: string | null;
  corporate_role?: number | null;
  corporate_role_name?: string | null;

  blood_group?: BloodGroup | "";
  /** The address on the citizenship certificate — where somebody is *from*,
   *  which is what statutory filings and formal letters use. */
  permanent_address?: string;
  /** Where they currently live, which changes when they are posted to a site. */
  temporary_address?: string;
  /** Issued by the company, revoked on the last day, listed in the directory. */
  office_phone?: string;
  office_email?: string;
  /** Theirs, and the only way to reach a leaver about a final settlement. */
  personal_phone?: string;
  personal_email?: string;

  /** In force right now, if anything is. Inlined so a "Suspended" chip can say
   *  why and until when rather than sending somebody to ask HR. */
  active_suspension?: {
    id: number;
    starts_on: string;
    ends_on: string | null;
    reason: string;
  } | null;

  /**
   * The statutory and banking record.
   *
   * **Every one of these is optional, and that is the API's answer, not
   * laziness.** `EmployeeDetailSerializer` strips them in `to_representation`
   * for anyone who is neither HR nor the person themselves, so the field is
   * genuinely absent rather than null. Typing them as required would make the
   * compiler promise something the server does not, and typing them as `| null`
   * would lose the distinction between "you may not see this" and "nobody has
   * filled it in" — which are different things to show a reader.
   *
   * They were missing from this type entirely, so nothing in the product could
   * render them even for an owner who was being sent them. Same shape of gap as
   * `photo` above.
   */
  legal_first_name?: string;
  legal_middle_name?: string;
  legal_last_name?: string;
  marital_status?: string;
  citizenship_number?: string;
  citizenship_front?: string | null;
  citizenship_back?: string | null;
  passport_number?: string;
  passport_expiry?: string | null;
  pan_number?: string;
  ssf_number?: string;
  pf_number?: string;
  cit_number?: string;
  bank_name?: string;
  bank_branch?: string;
  bank_account_name?: string;
  /** Masked server-side even for HR — a full number is only needed to build a
   *  payment file, which is a server-side job. */
  bank_account_number?: string;
  bank_account_type?: BankAccountType | "";
};

export type EmployeeFormValues = {
  first_name: string;
  /** Ordered ids for the chain above. */
  supervisor_ids: number[];
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  gender: Gender;
  date_joined: string;
  /**
   * When probation ends — blank for somebody who is not on it.
   *
   * Writable on the server and shown on the profile, but there was no control
   * for it anywhere, so a probation date could only ever be set by the seed or
   * by hand in the database.
   */
  probation_end_date: string;
  employment_status: EmploymentStatus;
  department: number | null;
  designation: number | null;
  manager: number | null;

  /**
   * Which company employs them, and where else they work.
   *
   * `primary_company` is required in practice — a person is employed *by*
   * somebody — but nullable here so the form can open empty rather than
   * pre-selecting an arbitrary company on the operator's behalf.
   */
  primary_company: number | null;
  secondary_companies: number[];

  corporate_post: number | null;
  corporate_role: number | null;
  blood_group: BloodGroup | "";
  permanent_address: string;
  temporary_address: string;
  office_phone: string;
  office_email: string;
  personal_phone: string;
  personal_email: string;

  /**
   * A newly chosen photo, if the form picked one.
   *
   * A `File` rather than a URL: the existing photo lives on the record and is
   * read from there, and this field only ever carries a *replacement*. Absent
   * means "leave the current one alone", which is what a save with no picture
   * chosen has to mean.
   */
  photo?: File | null;

  /**
   * Where this person's salary goes.
   *
   * `build_payment_batches` needs all three — bank, account number and account
   * *type* ("banks reject on this") — so all three are on the form. Without
   * them the only route into the record is the employee raising three change
   * requests against their own profile for HR to approve.
   *
   * Optional in the form: an employee is a real record before their bank
   * details are known, and blocking creation on them would stop somebody being
   * onboarded on their first morning.
   */
  bank_name?: string;
  bank_branch?: string;
  bank_account_name?: string;
  bank_account_number?: string;
  bank_account_type?: BankAccountType | "";

  /**
   * Who this person legally is, and what payroll files against.
   *
   * `citizenship_front` and `citizenship_back` are rendered as links on the
   * employment record and as "on file / not on file" on the person's own
   * profile; the employee form is the only place they are written, so without
   * them here every record reads "not on file" because every record is.
   *
   * The two scans are `File` rather than URLs for the same reason `photo` is:
   * the stored image is read off the record and this only ever carries a
   * replacement. Absent means "leave what is there alone".
   */
  legal_first_name?: string;
  legal_middle_name?: string;
  legal_last_name?: string;
  marital_status?: MaritalStatus | "";
  citizenship_number?: string;
  citizenship_front?: File | null;
  citizenship_back?: File | null;
  passport_number?: string;
  passport_expiry?: string;
  pan_number?: string;
  ssf_number?: string;
  pf_number?: string;
  cit_number?: string;
};

/** Matches `Employee.MaritalStatus`. It reaches tax: the married rate band is
 *  wider than the individual one, so this is not a demographic nicety. */
export type MaritalStatus = "single" | "married" | "divorced" | "widowed";

/** Salary / current / savings. A bank rejects an instruction naming the wrong
 *  one, which is why it is a constrained choice rather than free text. */
export type BankAccountType = "salary" | "current" | "savings";

export type EmployeeLogEntry = {
  id: number;
  field: "employment_status" | "department" | "designation" | "manager";
  from_value: string;
  to_value: string;
  actor_name: string | null;
  created_at: string;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

/**
 * A node in the reporting tree from `employees/org-chart`.
 *
 * Deliberately not `EmployeeListItem`: the chart endpoint returns the whole
 * company as a *nested* structure, unpaginated, with only the fields a card
 * shows. Rebuilding the tree from the paginated directory instead would
 * silently drop everyone past the page cap.
 */
export type OrgChartNode = {
  id: number;
  name: string;
  employee_code: string;
  designation: string | null;
  department: string | null;
  photo: string | null;
  manager: number | null;
  children: OrgChartNode[];
};


/* ── The chair and the work ──────────────────────────────────────────────── */

export type CorporatePost = {
  id: number;
  name: string;
  code: string;
  /** Seniority. **Lower is more senior** — rank 1 is the top of the company,
   *  matching `Designation.rank`, so a reader comparing the two lists does not
   *  have to remember which way each one counts. */
  rank: number;
  description: string;
  is_active: boolean;
  employee_count: number;
};

export type CorporateRole = {
  id: number;
  name: string;
  code: string;
  description: string;
  company: number | null;
  company_name: string | null;
  is_active: boolean;
  employee_count: number;
};

/* ── Suspension ──────────────────────────────────────────────────────────── */

export type SuspensionOutcome = "pending" | "reinstated" | "terminated" | "withdrawn";

export type Suspension = {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  starts_on: string;
  /** Null means indefinite — until somebody decides. A date means it lifts
   *  itself on the morning after. */
  ends_on: string | null;
  reason: string;
  is_active: boolean;
  outcome: SuspensionOutcome;
  outcome_display: string;
  outcome_note: string;
  lifted_on: string | null;
  lifted_by: number | null;
  lifted_by_name: string | null;
  created_at: string;
  updated_at: string;
};

/* ── Recognition, and its opposite ───────────────────────────────────────── */

export type AwardKind =
  | "performance"
  | "long_service"
  | "safety"
  | "innovation"
  | "teamwork"
  | "other";

export const AWARD_KINDS: { value: AwardKind; label: string }[] = [
  { value: "performance", label: "Performance" },
  { value: "long_service", label: "Long service" },
  { value: "safety", label: "Safety" },
  { value: "innovation", label: "Innovation" },
  { value: "teamwork", label: "Teamwork" },
  { value: "other", label: "Other" },
];

export type Award = {
  id: number;
  employee: number;
  employee_name: string;
  title: string;
  kind: AwardKind;
  kind_display: string;
  awarded_on: string;
  awarded_by: string;
  citation: string;
  reward: string;
  certificate: string | null;
  created_at: string;
  updated_at: string;
};

export type DisciplinarySeverity =
  | "verbal"
  | "written"
  | "final"
  | "suspension"
  | "demotion"
  | "dismissal";

export const DISCIPLINARY_SEVERITIES: { value: DisciplinarySeverity; label: string }[] = [
  { value: "verbal", label: "Verbal warning" },
  { value: "written", label: "Written warning" },
  { value: "final", label: "Final warning" },
  { value: "suspension", label: "Suspension" },
  { value: "demotion", label: "Demotion" },
  { value: "dismissal", label: "Dismissal" },
];

export type DisciplinaryStatus =
  | "open"
  | "under_review"
  | "upheld"
  | "overturned"
  | "closed";

export const DISCIPLINARY_STATUSES: { value: DisciplinaryStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "under_review", label: "Under review" },
  { value: "upheld", label: "Upheld" },
  { value: "overturned", label: "Overturned" },
  { value: "closed", label: "Closed" },
];

export type DisciplinaryAction = {
  id: number;
  employee: number;
  employee_name: string;
  subject: string;
  severity: DisciplinarySeverity;
  severity_display: string;
  status: DisciplinaryStatus;
  status_display: string;
  incident_date: string;
  issued_on: string;
  description: string;
  employee_response: string;
  action_taken: string;
  /** After this it no longer counts against them. A warning that never expires
   *  is a dismissal on the instalment plan. */
  expires_on: string | null;
  suspension: number | null;
  document: string | null;
  /** Whether it still counts today. Computed server-side, because the same
   *  date comparison feeds the reports and the two must not disagree. */
  is_current: boolean;
  created_at: string;
  updated_at: string;
};
