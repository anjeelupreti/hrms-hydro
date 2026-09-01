import type { EmployeeListItem } from "@/types/employees";
import type { LeaveRequest } from "@/types/leave";

export type AttendanceTrendPoint = {
  date: string;
  /** Everyone who turned up, late included — somebody late was still at work. */
  present: number;
  /** Of those, how many were late. Optional because a client on an older
   *  backend will not send it, and a missing figure should read as "not
   *  measured" rather than crash the strip. */
  late?: number;
  absent: number;
};

export type LeaveBreakdownEntry = {
  leave_type: string;
  count: number;
};

export type DepartmentDistributionEntry = {
  department: string;
  count: number;
};

export type OnLeaveEntry = {
  employee: string;
  employee_id: number;
  leave_type: string;
  end_date: string;
};

export type UpcomingBirthday = {
  employee: string;
  employee_id: number;
  date: string;
  days_until: number;
};

export type RecentCheckin = {
  employee: string;
  employee_id: number;
  time: string;
  status: string;
};

export type AttendanceMonth = {
  present: number;
  late: number;
  absent: number;
  half_day: number;
};

export type PayrollSummary = {
  draft_count: number;
  latest: {
    period_year: number;
    period_month: number;
    /** "Shrawan 2083" — named by the server, in the run's own calendar.
     *  The card composed it from a hardcoded English month list, which
     *  is the wrong name for a period that is not a Gregorian month. */
    period_label: string;
    status: string;
    payslip_count: number;
    net_total: number;
  } | null;
  /**
   * The last six runs, oldest first.
   *
   * One month's net total is a number with nothing to compare it to. Payroll
   * moves for reasons somebody should notice — a joiner, a leaver, a bonus
   * month — and the shape of the last half-year is what makes an unusual month
   * look unusual.
   */
  history: { period_label: string; net_total: number }[];
} | null;

export type DashboardSummary = {
  total_employees: number;
  /**
   * Whether the company is open today, by its own working week and holidays.
   *
   * Lets the hero tell "nobody came in" from "nobody was supposed to". Without
   * it the largest element on the page reads "0 present of 95" every weekend —
   * correct, and saying nothing.
   */
  today_is_working: boolean;
  present_today: number;
  absent_today: number;
  on_leave_today: number;
  pending_my_approval: number;
  todays_birthdays: EmployeeListItem[];
  upcoming_leaves: LeaveRequest[];
  recent_employees: EmployeeListItem[];
  attendance_trend: AttendanceTrendPoint[];
  attendance_heatmap: AttendanceHeatmap;
  workforce_tenure: WorkforceTenureBand[];
  leave_usage: LeaveUsageRow[];
  leave_breakdown: LeaveBreakdownEntry[];
  department_distribution: DepartmentDistributionEntry[];
  on_leave_today_list: OnLeaveEntry[];
  upcoming_birthdays: UpcomingBirthday[];
  recent_checkins: RecentCheckin[];
  attendance_month: AttendanceMonth;
  payroll_summary: PayrollSummary;
};

/** Attendance rate per department per day, over a fortnight. */
export type AttendanceHeatmap = {
  /** `YYYY-MM-DD`, oldest first. */
  days: string[];
  rows: {
    department: string;
    /** Percent present, or `null` where nothing was logged — a weekend or a
     *  holiday. Zero would be a false alarm; absence of data is not absence
     *  of people. */
    cells: (number | null)[];
  }[];
};

/** Headcount in one tenure band, split by gender. */
export type WorkforceTenureBand = {
  band: string;
  male: number;
  female: number;
  /** Anything not recorded as male or female, including blank. Counted rather
   *  than dropped — omitting them would misstate the headcount. */
  other: number;
};

/** Leave taken against leave allowed, for one department. */
export type LeaveUsageRow = {
  department: string;
  /** Allocated plus carried forward — carried days are genuinely takeable, and
   *  measuring against allocation alone reports people as over when they are
   *  not. */
  allowed: number;
  used: number;
};

/**
 * Leave taken per month, by type, over the last twelve months.
 *
 * The screen's other figures are all counts as of today. This is the one that
 * answers *when* — and leave is seasonal here in a way that is not a guess.
 */
export type LeaveTrend = {
  types: string[];
  /** Oldest first. Each row carries `month`, `total`, and a key per type. */
  months: ({ month: string; total: number } & Record<string, number | string>)[];
};

/** What was spent per month and on what, over the last twelve months. */
export type ExpenseTrend = {
  /** Biggest first, so a series keeps its colour between renders. */
  categories: { name: string; total: number }[];
  months: ({ month: string; total: number } & Record<string, number | string>)[];
};

/**
 * When people actually arrive, across the day.
 *
 * Not a lateness percentage — that is a number for a report. This is the shape:
 * where arrivals sit relative to the start time the system publishes.
 */
export type ArrivalDistribution = {
  /** Half-hour buckets across the span people actually arrive in. */
  slots: { minute: number; label: string; count: number }[];
  /** Minutes past midnight, or null where the system has not set one. */
  office_start: number | null;
  /** The typical arrival — a median, not a mean, which one 4am fix would drag. */
  median: number | null;
  total: number;
  after_start: number | null;
};
