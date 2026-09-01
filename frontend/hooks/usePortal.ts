"use client";

import { useQuery } from "@tanstack/react-query";

export type PortalBalance = {
  leave_type: string;
  allocated: string;
  carried_forward: string;
  used: string;
  remaining: string;
};

export type PortalSummary = {
  fiscal_year: { year: number; label: string; start: string; end: string };
  me: {
    employee_code: string;
    name: string;
    email: string;
    designation: string | null;
    department: string | null;
    manager: string | null;
    date_joined: string;
    tenure_years: number;
    tenure_days: number;
    employment_status: string;
    on_probation: boolean;
  };
  attendance: {
    present: number;
    late: number;
    absent: number;
    half_day: number;
    days_logged: number;
    /** Null, not zero, when nothing is logged — see the note below. */
    attendance_rate: number | null;
    punctuality_rate: number | null;
  };
  leave: {
    balances: PortalBalance[];
    taken_paid_days: string;
    taken_unpaid_days: string;
    pending_requests: number;
    total_remaining: string;
  };
  pay: {
    latest: {
      period: string;
      net_pay: string;
      status: string;
      is_held: boolean;
      paid_at: string | null;
    } | null;
    payslip_count: number;
    gross_earned: string;
    net_earned: string;
    deductions: string;
  };
  work: {
    open_checklist_tasks: number;
    my_onboarding_tasks: number;
    open_project_tasks: number;
  };
  requests: {
    pending: Record<string, number>;
    total_pending: number;
  };
};

/**
 * Everything about the signed-in employee, in one request.
 *
 * **No employee id.** The subject is whoever is calling — the endpoint takes no
 * parameter for it, which is what keeps a self-service surface self-service.
 *
 * `fiscalYear` is optional and defaults to the company's current one
 * (Shrawan→Ashad here, not January→December).
 *
 * **A null rate is not zero.** `attendance_rate` comes back null when nothing
 * has been logged, because "no records" and "never turned up" are different
 * facts and rendering the second for the first accuses somebody.
 */
export function usePortalSummary(fiscalYear?: number) {
  return useQuery<PortalSummary>({
    queryKey: ["portal-summary", fiscalYear ?? "current"],
    queryFn: async () => {
      const query = fiscalYear ? `?fiscal_year=${fiscalYear}` : "";
      const res = await fetch(`/api/proxy/accounts/portal/summary${query}`);
      if (res.status === 404) {
        // This account has no employee record — an HR admin who is not
        // themselves an employee. A real configuration, not an error.
        throw new Error("no_employee_record");
      }
      if (!res.ok) throw new Error("Could not load your portal.");
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });
}
