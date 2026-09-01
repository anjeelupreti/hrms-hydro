export type ComponentType = "earning" | "deduction";
export type CalcType = "flat" | "percentage_of" | "formula" | "slab_based";

export type SalaryComponent = {
  id: number;
  code: string;
  name: string;
  component_type: ComponentType;
  calc_type: CalcType;
  amount: string;
  percentage_of: number | null;
  formula: string;
  taxable: boolean;
  is_active: boolean;
  order: number;
};

/**
 * One band of the income-tax table.
 *
 * **The amounts are ANNUAL, as published.** The engine annualises the period's
 * pay before applying them, so what is stored matches the Finance Act line for
 * line and can be checked against it. Storing them pre-divided by twelve would
 * mean nobody could verify a band without doing arithmetic first.
 */
export type TaxSlab = {
  id: number;
  fiscal_year: number;
  fiscal_year_label: string;
  /** Two rate tables, not one — a couple electing joint assessment differs. */
  taxpayer: "individual" | "couple";
  order: number;
  min_amount: string;
  max_amount: string | null;
  rate: string;
  /** The lowest band is a social security tax, not charged to fund members. */
  waived_if_retirement_contributor: boolean;
  is_verified: boolean;
  verified_by_name: string | null;
  verified_at: string | null;
  source: string;
};

/**
 * A legislated figure for one fiscal year.
 *
 * **`is_verified` is the honest part of the design.** Every figure ships as an
 * unchecked default so the product is usable on day one — and the flag is what
 * stops a placeholder looking like something an accountant confirmed. It is set
 * by its own action, never by editing the value, or whoever changed a number
 * could mark their own change as checked.
 */
export type StatutoryRate = {
  id: number;
  code: string;
  fiscal_year: number;
  fiscal_year_label: string;
  label: string;
  note: string;
  value: string;
  unit: "percent" | "amount" | "multiplier";
  is_verified: boolean;
  verified_by_name: string | null;
  verified_at: string | null;
  source: string;
};

export type SalaryStructureAssignment = {
  id: number;
  component: number;
  component_code: string;
  component_name: string;
  amount: string | null;
};

export type SalaryStructure = {
  id: number;
  employee: number;
  effective_from: string;
  notes: string;
  assignments: SalaryStructureAssignment[];
};

export type PayrollRunStatus = "draft" | "processing" | "completed" | "failed";

export type PayrollRun = {
  id: number;
  /** Which calendar the two numbers below are in - D-06. Runs created
   *  before 18 Aug 2026 are "AD" because that is the period they were
   *  computed over; relabelling them would claim money was paid for days
   *  it was not. */
  period_calendar: "AD" | "BS";
  period_year: number;
  period_month: number;
  /** "Shrawan 2083". Named by the server, because naming a month is a
   *  calendar question and the browser does not own a conversion table. */
  period_label: string;
  /** The Gregorian days the run actually covers. "Shrawan 2083" tells a
   *  reader nothing about which days were paid, and the whole defect was a
   *  label that agreed with the law while the window underneath did not. */
  period_start: string;
  period_end: string;
  status: PayrollRunStatus;
  notes: string;
  payslip_count: number;
  /** The run's own totals, denormalised on the row. These were served by
   *  `PayrollRunSerializer` all along and simply absent from this type, so any
   *  code touching them failed to compile and nothing did. */
  total_gross: string;
  total_deductions: string;
  total_net: string;
  /** Unresolved errors. Named `error_count` on the wire; the queryset calls its
   *  annotation `unresolved_error_count`, which is not what is sent. */
  error_count: number;
  locked_at: string | null;
};

export type PayslipStatus = "draft" | "finalized" | "paid";
export type DisbursementMethod = "bank_transfer" | "cash" | "wallet";

export type PayslipLineItem = {
  id: number;
  component_code: string;
  component_name: string;
  component_type: ComponentType;
  amount: string;
};

export type Payslip = {
  id: number;
  payroll_run: number;
  employee: number;
  employee_code: string;
  employee_photo: string | null;
  employee_name: string;
  period_year: number;
  period_month: number;
  /** The run's period, named its way. A payslip's period is its run's. */
  period_calendar: "AD" | "BS";
  period_label: string;
  gross_earnings: string;
  total_deductions: string;
  net_pay: string;
  period_days: number;
  /** Attendance as it stood when this payslip was computed. Snapshotted, not
   *  derived on read: a regularisation approved next week must not change the
   *  hours shown against a payslip that was finalised on the old figures.
   *
   *  None of these price anything. Pay moves on absence, unpaid leave and half
   *  days; these are here so somebody can see their own month. */
  days_attended: number;
  hours_worked: string;
  /** Across days attended, not across the period — eight hours on each of four
   *  days is an average of eight, not one. */
  average_hours: string;
  payable_days: number;
  /** The absence arithmetic, snapshotted when the payslip was computed — the
   *  setting can move, an issued payslip cannot. */
  pay_basis?: "calendar" | "working_days" | "";
  /** The divisor: days in the month, or working days. */
  basis_days?: number;
  unpaid_days?: string;
  day_value?: string;
  absence_deduction?: string;
  status: PayslipStatus;
  disbursement_method: DisbursementMethod | "";
  disbursement_reference: string;
  paid_at: string | null;
  line_items: PayslipLineItem[];
};

export type LoanType = "office" | "personal";
export type LoanStatus = "requested" | "approved" | "rejected" | "active" | "closed";

export type Loan = {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  loan_type: LoanType;
  principal_amount: string;
  monthly_deduction: string;
  outstanding_balance: string;
  reason: string;
  status: LoanStatus;
  start_date: string | null;
  closed_at: string | null;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

/** One bucket of `status-counts`: how many, and what they are worth. */
export type StatusBucket = { count: number; amount: string };

export type PayslipStatusCounts = {
  total: number;
  draft: StatusBucket;
  finalized: StatusBucket;
  paid: StatusBucket;
};


/**
 * What has been paid into one scheme so far this fiscal year.
 *
 * **Both sides, kept apart.** The employee's own contribution is what they
 * need at filing time; the employer's never left their pay. Summing them
 * overstates what somebody contributed, which is the figure people check.
 */
export type ContributionTotal = {
  scheme: string;
  label: string;
  employee_total: string;
  employer_total: string;
  total: string;
};

export type ContributionSummary = {
  employee?: number;
  fiscal_year: number | null;
  schemes: ContributionTotal[];
};

/** One person's deviation from the company scheme — see the model. */
export type SchemeEnrolment = {
  id: number;
  employee: number;
  employee_name: string;
  scheme: string;
  scheme_label: string;
  /** False means "outside the scheme", which is not the same as no row at all. */
  is_active: boolean;
  /** Overrides the statutory percentage for this person only. */
  employee_rate: string | null;
  /** CIT only — a chosen amount, not a percentage. */
  monthly_amount: string | null;
  reference: string;
};


/** One person's line on the reconciliation sheet. */
export type ContributionReportRow = {
  employee: number;
  employee_code: string;
  employee_name: string;
  scheme: string;
  label: string;
  employee_total: string;
  employer_total: string;
};

export type ContributionReport = {
  fiscal_year: number;
  /** Per scheme. `total` is both sides added — what left the *company*. */
  totals: (ContributionTotal & { total: string })[];
  people: ContributionReportRow[];
};


/**
 * A projected year's tax, with and without extra saving.
 *
 * **A projection, not a settlement** — every figure is one month repeated, so
 * `based_on` names the month it came from and the screen has to say so.
 */
export type TaxProjectionSide = {
  monthly_contribution: string;
  annual_contribution: string;
  relief: string;
  monthly_tax: string;
  annual_tax: string;
};

export type TaxProjection =
  | { available: false; reason?: string }
  | {
      available: true;
      fiscal_year: number;
      based_on: { period_year: number; period_month: number; is_draft: boolean };
      monthly_taxable: string;
      annual_taxable: string;
      offers_cit: boolean;
      current: TaxProjectionSide;
      proposed: TaxProjectionSide;
      annual_tax_saved: string;
      /**
       * The most somebody can usefully add per month before relief runs out.
       * Past this, more contribution reduces take-home pay and saves no tax —
       * the one number that changes a decision.
       */
      optimum_monthly_cit: string | null;
    };
