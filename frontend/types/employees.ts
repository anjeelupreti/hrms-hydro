export type EmploymentStatus = "active" | "on_leave" | "resigned" | "terminated";
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
  manager_name: string | null;
  /** Whose payroll they are on — the roster can be read and filtered by it. */
  primary_company: number | null;
  primary_company_name: string | null;
};

export type EmployeeDetail = {
  id: number;
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
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  gender: Gender;
  date_joined: string;
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
