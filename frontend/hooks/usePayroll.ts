"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

import type {
  Loan,
  PaginatedResponse,
  PayrollRun,
  Payslip,
  PayslipStatusCounts,
  SalaryComponent,
  ContributionReport,
  ContributionSummary,
  TaxProjection,
  SalaryStructure,
  SchemeEnrolment,
  StatutoryRate,
  TaxSlab,
} from "@/types/payroll";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, response.status));
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

// --- Salary Components ---------------------------------------------------

export function useSalaryComponents() {
  return useQuery({
    queryKey: ["payroll", "components"],
    queryFn: () => fetchJson<PaginatedResponse<SalaryComponent>>("/api/proxy/payroll/components?page_size=100"),
  });
}

export function useCreateSalaryComponent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<SalaryComponent>) =>
      fetchJson<SalaryComponent>("/api/proxy/payroll/components", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "components"] }),
  });
}

export function useUpdateSalaryComponent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<SalaryComponent> }) =>
      fetchJson<SalaryComponent>(`/api/proxy/payroll/components/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "components"] }),
  });
}

/**
 * Delete a component, or retire it when it is in use.
 *
 * Structure lines reference components with PROTECT, so the API answers 409
 * with the count that blocks it. `fetchJson` turns `detail` into the thrown
 * message and the global mutation handler toasts it, so the refusal explains
 * itself without this hook doing anything special.
 */
export function useDeleteSalaryComponent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`/api/proxy/payroll/components/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Component deleted" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "components"] }),
  });
}

/** The way out when deleting is refused: stop offering it, keep the history. */
export function useSetSalaryComponentActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      fetchJson<SalaryComponent>(
        `/api/proxy/payroll/components/${id}/${active ? "reactivate" : "deactivate"}`,
        { method: "POST" }
      ),
    meta: { successMessage: "Component updated" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "components"] }),
  });
}

// --- Tax Slabs -------------------------------------------------------------

export function useTaxSlabs(fiscalYear?: number) {
  const params = fiscalYear ? `&fiscal_year=${fiscalYear}` : "";
  return useQuery({
    queryKey: ["payroll", "tax-slabs", fiscalYear],
    queryFn: () => fetchJson<PaginatedResponse<TaxSlab>>(`/api/proxy/payroll/tax-slabs?page_size=100${params}`),
  });
}

/**
 * The fields a caller actually supplies.
 *
 * Not `Omit<TaxSlab, "id">`: the record carries derived and server-owned fields
 * — the fiscal-year label, and the whole verification set, which is deliberately
 * settable only by its own action. Requiring them here would force a caller to
 * invent values for things it must not decide.
 */
export type TaxSlabInput = Pick<
  TaxSlab,
  "fiscal_year" | "order" | "min_amount" | "max_amount" | "rate"
> &
  Partial<Pick<TaxSlab, "taxpayer" | "waived_if_retirement_contributor">>;

export function useCreateTaxSlab() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: TaxSlabInput) =>
      fetchJson<TaxSlab>("/api/proxy/payroll/tax-slabs", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "tax-slabs"] }),
  });
}

export function useDeleteTaxSlab() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`/api/proxy/payroll/tax-slabs/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "tax-slabs"] }),
  });
}

// --- Salary Structures -----------------------------------------------------

export function useSalaryStructures(employeeId: number | null) {
  return useQuery({
    queryKey: ["payroll", "structures", employeeId],
    queryFn: () =>
      fetchJson<PaginatedResponse<SalaryStructure>>(
        `/api/proxy/payroll/structures?employee=${employeeId}&page_size=50`
      ),
    enabled: employeeId !== null,
  });
}

export function useCreateSalaryStructure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      employee: number;
      effective_from: string;
      notes: string;
      assignments: { component: number; amount: string | null }[];
    }) =>
      fetchJson<SalaryStructure>("/api/proxy/payroll/structures", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["payroll", "structures", variables.employee] }),
  });
}

// --- Payroll Runs ------------------------------------------------------------

export function usePayrollRuns() {
  return useQuery({
    queryKey: ["payroll", "runs"],
    queryFn: () => fetchJson<PaginatedResponse<PayrollRun>>("/api/proxy/payroll/runs?page_size=50"),
  });
}

export function usePayrollRun(id: number | null) {
  return useQuery({
    queryKey: ["payroll", "runs", id],
    queryFn: () => fetchJson<PayrollRun>(`/api/proxy/payroll/runs/${id}`),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 3000 : false),
  });
}

export function useRunPayslips(id: number | null) {
  return useQuery({
    queryKey: ["payroll", "runs", id, "payslips"],
    queryFn: () => fetchJson<Payslip[]>(`/api/proxy/payroll/runs/${id}/payslips`),
    enabled: id !== null,
    // Payslips don't change after a run computes; the run-status query polls
    // while "processing" and invalidates this on completion. No blind 5s poll.
  });
}

export function useCreatePayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      // Sent explicitly rather than left to the server's default: the
      // form showed the user a period in a particular calendar, and the
      // run must be created in the one they were looking at (D-06).
      period_calendar?: "AD" | "BS";
      period_year: number;
      period_month: number;
      notes?: string;
    }) =>
      fetchJson<PayrollRun>("/api/proxy/payroll/runs", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "runs"] }),
  });
}

export function useStartPayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<PayrollRun>(`/api/proxy/payroll/runs/${id}/run`, { method: "POST" }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "runs"] });
      queryClient.invalidateQueries({ queryKey: ["payroll", "runs", id] });
    },
  });
}

export function useFinalizePayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<PayrollRun>(`/api/proxy/payroll/runs/${id}/finalize`, { method: "POST" }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "runs"] });
      queryClient.invalidateQueries({ queryKey: ["payroll", "runs", id] });
      queryClient.invalidateQueries({ queryKey: ["payroll", "runs", id, "payslips"] });
    },
  });
}

// --- Payslips ----------------------------------------------------------------

export function usePayslips(
  filters: {
    payroll_run?: number;
    employee?: number;
    /** Matches employee code, first name and last name — server-side, because
     *  a run of 93 payslips does not fit the page and filtering the page
     *  filters the wrong set. */
    search?: string;
    status?: string;
    ordering?: string;
  } = {}
) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.payroll_run) params.set("payroll_run", String(filters.payroll_run));
  if (filters.employee) params.set("employee", String(filters.employee));
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.ordering) params.set("ordering", filters.ordering);

  return useQuery({
    queryKey: ["payroll", "payslips", filters],
    queryFn: () => fetchJson<PaginatedResponse<Payslip>>(`/api/proxy/payroll/payslips?${params.toString()}`),
    // Keeps the previous rows on screen while a new search runs, so the list
    // does not blank out on every keystroke.
    placeholderData: (previous) => previous,
  });
}

/** How many payslips sit in each status, and what each bucket is worth.
 *
 * Counted in SQL rather than from `results`: the list is capped at one page,
 * so a tally of the rows on screen undercounts exactly the runs big enough to
 * need the number. */
export function usePayslipStatusCounts(payrollRun?: number) {
  const params = new URLSearchParams();
  if (payrollRun) params.set("payroll_run", String(payrollRun));

  return useQuery({
    queryKey: ["payroll", "payslip-status-counts", payrollRun],
    queryFn: () =>
      fetchJson<PayslipStatusCounts>(
        `/api/proxy/payroll/payslips/status-counts?${params.toString()}`
      ),
    enabled: payrollRun !== undefined,
  });
}

type LineItemInput = {
  component_code?: string;
  component_name: string;
  component_type: "earning" | "deduction";
  amount: string;
};

/** Invalidate every cached view that shows payslip figures for a run. */
function invalidatePayslips(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["payroll", "payslips"] });
  queryClient.invalidateQueries({ queryKey: ["payroll", "runs"] });
}

export function useMarkAllPayslipsPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      runId,
      disbursement_method,
      disbursement_reference,
    }: {
      runId: number;
      disbursement_method: string;
      disbursement_reference: string;
    }) =>
      fetchJson<{ marked_paid: number }>(`/api/proxy/payroll/runs/${runId}/mark-all-paid`, {
        method: "POST",
        body: JSON.stringify({ disbursement_method, disbursement_reference }),
      }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "runs"] });
      queryClient.invalidateQueries({ queryKey: ["payroll", "runs", vars.runId, "payslips"] });
    },
  });
}

export function useEditPayslipLineItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, line_items }: { id: number; line_items: LineItemInput[] }) =>
      fetchJson<Payslip>(`/api/proxy/payroll/payslips/${id}/line-items`, {
        method: "PUT",
        body: JSON.stringify({ line_items }),
      }),
    onSuccess: () => invalidatePayslips(queryClient),
  });
}

export function useRecomputePayslip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<Payslip>(`/api/proxy/payroll/payslips/${id}/recompute`, { method: "POST" }),
    onSuccess: () => invalidatePayslips(queryClient),
  });
}

export function useFinalizePayslip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<Payslip>(`/api/proxy/payroll/payslips/${id}/finalize`, { method: "POST" }),
    onSuccess: () => invalidatePayslips(queryClient),
  });
}

export function useMarkPayslipPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      disbursement_method,
      disbursement_reference,
    }: {
      id: number;
      disbursement_method: string;
      disbursement_reference: string;
    }) =>
      fetchJson<Payslip>(`/api/proxy/payroll/payslips/${id}/mark_paid`, {
        method: "POST",
        body: JSON.stringify({ disbursement_method, disbursement_reference }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "payslips"] }),
  });
}

// --- Loans ---------------------------------------------------------------

export function useLoans(filters: { employee?: number } = {}) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.employee) params.set("employee", String(filters.employee));

  return useQuery({
    queryKey: ["payroll", "loans", filters],
    queryFn: () => fetchJson<PaginatedResponse<Loan>>(`/api/proxy/payroll/loans?${params.toString()}`),
  });
}

/**
 * Loan totals across the whole book, not the page on screen.
 *
 * Money, not just counts: "2 active" says nothing a finance team can act on,
 * and "575,000 still out" does. Summed in SQL by `StatusCountsMixin` — a list
 * page here caps at 100 rows, so a total added up from `results` would quietly
 * understate the book on exactly the companys where it matters (§2.6).
 */
export type LoanBucket = { count: number; amount: string };
export type LoanCounts = {
  total: number;
  requested: LoanBucket;
  approved: LoanBucket;
  active: LoanBucket;
  closed: LoanBucket;
  rejected: LoanBucket;
};

export function useLoanCounts() {
  return useQuery({
    queryKey: ["payroll", "loans", "counts"],
    queryFn: () => fetchJson<LoanCounts>("/api/proxy/payroll/loans/status-counts"),
  });
}

export function useCreateLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { loan_type: string; principal_amount: string; monthly_deduction: string; reason: string }) =>
      fetchJson<Loan>("/api/proxy/payroll/loans", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "loans"] }),
  });
}

export function useApproveLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<Loan>(`/api/proxy/payroll/loans/${id}/approve`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "loans"] }),
  });
}

export function useRejectLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<Loan>(`/api/proxy/payroll/loans/${id}/reject`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "loans"] }),
  });
}

/**
 * Delete a payroll run — drafts only.
 *
 * Creating a run for the wrong month is an easy mistake, so a draft can be
 * undone. Once processed, its payslips are the record of what people were
 * paid, and the API refuses with 409.
 */
export function useDeletePayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`/api/proxy/payroll/runs/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Draft run deleted" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

/** Withdraw a loan request that has not been paid out yet. */
export function useCancelLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<Loan>(`/api/proxy/payroll/loans/${id}/cancel`, { method: "POST" }),
    meta: { successMessage: "Loan request withdrawn" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll", "loans"] }),
  });
}


// --- Statutory rates -----------------------------------------------------
//
// The eleven legislated figures. This table had no API at all until 25 Aug,
// which made "every statutory figure is configuration" true of the design and
// false of the product.

const RATES = "/api/proxy/payroll/statutory-rates";

export function useStatutoryRates(fiscalYear?: number) {
  const qs = fiscalYear ? `?fiscal_year=${fiscalYear}&page_size=100` : "?page_size=100";
  return useQuery({
    queryKey: ["statutory-rates", fiscalYear ?? "all"],
    queryFn: () => fetchJson<PaginatedResponse<StatutoryRate>>(`${RATES}/${qs}`),
  });
}

export function useUpdateStatutoryRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) =>
      fetchJson<StatutoryRate>(`${RATES}/${id}/`, {
        method: "PATCH",
        body: JSON.stringify({ value }),
      }),
    meta: { successMessage: "Saved" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["statutory-rates"] }),
  });
}

/**
 * Mark a figure checked, or withdraw that.
 *
 * Its own call rather than a field on the update, because a verification set
 * in the same request that changes the value is somebody marking their own
 * edit as verified.
 */
export function useVerifyStatutoryRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, source }: { id: number; source?: string }) =>
      fetchJson<StatutoryRate>(`${RATES}/${id}/${source ? "verify" : "unverify"}/`, {
        method: "POST",
        body: JSON.stringify(source ? { source } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["statutory-rates"] }),
  });
}

/** Fill in any missing figures for a year. Never overwrites what is there. */
export function useSeedStatutoryRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fiscalYear: number) =>
      fetchJson<{ detail: string }>(`${RATES}/seed/`, {
        method: "POST",
        body: JSON.stringify({ fiscal_year: fiscalYear }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["statutory-rates"] });
      qc.invalidateQueries({ queryKey: ["tax-slabs"] });
    },
  });
}


// --- Scheme enrolment & contributions ------------------------------------

const ENROL = "/api/proxy/payroll/scheme-enrolments";

/** Who differs from the company scheme. Absence of a row means "follow it". */
export function useSchemeEnrolments(employeeId?: number | null) {
  const qs = employeeId != null ? `?employee=${employeeId}` : "";
  return useQuery({
    queryKey: ["scheme-enrolments", employeeId ?? "all"],
    queryFn: () => fetchJson<PaginatedResponse<SchemeEnrolment>>(`${ENROL}/${qs}`),
    enabled: employeeId != null,
  });
}

export function useSaveSchemeEnrolment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...values }: Partial<SchemeEnrolment> & { id?: number }) =>
      fetchJson<SchemeEnrolment>(id ? `${ENROL}/${id}/` : `${ENROL}/`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Saved" },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheme-enrolments"] });
      qc.invalidateQueries({ queryKey: ["contributions"] });
    },
  });
}

/**
 * Removing the row means "follow the company again" — a return to normal
 * rather than a loss of history. What actually happened to somebody's pay
 * lives in the contribution record, which is never deleted.
 */
export function useDeleteSchemeEnrolment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`${ENROL}/${id}/`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheme-enrolments"] }),
  });
}

/** Totals per scheme — served, never summed here (§2.6). */
export function useContributionTotals(employeeId?: number | null, fiscalYear?: number) {
  const params = new URLSearchParams();
  if (employeeId != null) params.set("employee", String(employeeId));
  if (fiscalYear) params.set("fiscal_year", String(fiscalYear));
  const qs = params.toString();
  return useQuery({
    queryKey: ["contributions", employeeId ?? "me", fiscalYear ?? "current"],
    queryFn: () =>
      fetchJson<ContributionSummary>(
        `/api/proxy/payroll/contributions/${qs ? `?${qs}` : ""}`
      ),
  });
}


/** Everybody's, for filing and reconciling. Payroll-gated in both directions. */
export function useContributionReport(fiscalYear?: number) {
  const qs = fiscalYear ? `?fiscal_year=${fiscalYear}` : "";
  return useQuery({
    queryKey: ["contribution-report", fiscalYear ?? "current"],
    queryFn: () =>
      fetchJson<ContributionReport>(`/api/proxy/payroll/contribution-report/${qs}`),
  });
}


/** Your own projection. The endpoint takes no employee id — see the view. */
export function useTaxPlanner(extraCit = 0) {
  return useQuery({
    queryKey: ["tax-planner", extraCit],
    queryFn: () =>
      fetchJson<TaxProjection>(`/api/proxy/payroll/tax-planner/?extra_cit=${extraCit}`),
    // Keeps the previous numbers on screen while the slider settles, rather
    // than blanking the figures somebody is reading.
    placeholderData: (prev) => prev,
  });
}
