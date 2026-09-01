export type CompanyProfile = {
  id: number;
  name: string;
  logo: string | null;
  address: string;
  timezone: string;
  /**
   * Which calendar this company's fiscal year runs on. Decides what "this
   * year" means for a leave entitlement, which fiscal year a payslip belongs
   * to, and which statutory rates apply — so it is a setup decision, not a
   * display preference.
   */
  calendar: "BS" | "AD";
  /**
   * Which month of that calendar the financial year opens on, or `null` for
   * the calendar's own year — Shrawan for Bikram Sambat, January for Gregorian.
   *
   * Null is the answer for every Nepali company. It exists because a financial
   * year is a *country's* rule rather than a calendar's: India and the UK run
   * April–March on the same Gregorian calendar the US federal year opens in
   * October.
   */
  fiscal_year_start_month: number | null;
  /** The above with the default already applied, so no screen re-derives it. */
  fiscal_year_start_month_effective: number;
  /** The months of *this* calendar, in order — "Shrawan", not "month 4". */
  calendar_months: { value: number; label: string }[];
  /** What the current financial year is called under these settings. */
  fiscal_year_label: string | null;

  /**
   * Which retirement fund this company is enrolled in, or `""` for none.
   *
   * **One field rather than two flags, so "both" cannot be represented.** SSF
   * and PF deduct from the same basic, so running them together takes 21% from
   * somebody who owes 11% — and the payslip looks entirely ordinary.
   *
   * Never defaulted or seeded: which fund a company is on is the owner's
   * decision, and a default would start taking money out of pay on a basis
   * nobody chose.
   */
  retirement_scheme: "" | "ssf" | "pf";
  /**
   * Contributions stopped, **without forgetting which fund**.
   *
   * Paused and never-enrolled are different facts: clearing the scheme would
   * lose the programme and orphan the year-to-date history it sits under.
   */
  retirement_paused: boolean;
  /** CIT is a voluntary employee saving — the company only decides if it is offered. */
  offers_cit: boolean;
  /** Employer-funded, and not applicable on SSF, which already covers it. */
  provides_gratuity: boolean;

  working_days: number[];
  /** When the office opens and closes. Null where the system has not set them —
   *  the model allows that, and a screen must cope rather than assume 9-to-5. */
  office_start_time: string | null;
  office_end_time: string | null;
  /** What one day of pay is worth when absence is deducted — see
   *  `CompanyProfile.pay_basis`. Calendar divides by days in the month;
   *  working days divides by the days this company works. */
  pay_basis: "calendar" | "working_days";
  payroll_prorate: boolean;
  overtime_multiplier: string;
};

export type CompanyEmailSettings = {
  id: number;
  host: string;
  port: number;
  username: string;
  password_is_set: boolean;
  from_email: string;
  use_tls: boolean;
  is_active: boolean;
  imap_host: string;
  imap_port: number;
  imap_use_ssl: boolean;
};

export type ReviewCycleStatus = "draft" | "active" | "closed";

export type ReviewCycle = {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: ReviewCycleStatus;
};

export type ReviewStatus = "pending_self" | "pending_manager" | "completed";

export type Review = {
  id: number;
  cycle: number;
  cycle_name: string;
  employee: number;
  employee_code: string;
  employee_name: string;
  reviewer: number | null;
  reviewer_name: string | null;
  status: ReviewStatus;
  self_assessment: string;
  self_rating: number | null;
  self_submitted_at: string | null;
  manager_assessment: string;
  manager_rating: number | null;
  manager_submitted_at: string | null;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
