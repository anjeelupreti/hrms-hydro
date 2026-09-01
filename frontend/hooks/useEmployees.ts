"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";

import type {
  Department,
  Designation,
  EmployeeDetail,
  EmployeeFormValues,
  EmployeeListItem,
  EmployeeLogEntry,
  OrgChartNode,
  PaginatedResponse,
} from "@/types/employees";


export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: () =>
      fetchJson<PaginatedResponse<Department>>("/api/proxy/employees/departments?page_size=100"),
  });
}

export function useDesignations() {
  return useQuery({
    queryKey: ["designations"],
    queryFn: () =>
      fetchJson<PaginatedResponse<Designation>>("/api/proxy/employees/designations?page_size=100"),
  });
}

export type EmployeeFilters = {
  page: number; // 1-indexed, matches DRF
  pageSize: number;
  search?: string;
  department?: number;
  designation?: number;
  /** Everyone who works at this company — on its payroll *or* seconded to it.
   *  Neither `primary_company` nor `secondary_companies` answers that alone. */
  company?: number;
  employment_status?: string;
  /** Show the people who have left instead of the ones who are here. */
  past?: boolean;
};

export function useEmployees(filters: EmployeeFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    page_size: String(filters.pageSize),
  });
  if (filters.search) params.set("search", filters.search);
  if (filters.department) params.set("department", String(filters.department));
  if (filters.designation) params.set("designation", String(filters.designation));
  if (filters.company) params.set("company", String(filters.company));
  if (filters.employment_status) params.set("employment_status", filters.employment_status);
  // The vault: people who have left. The directory shows the roster by default
  // — a company with years of turnover should not open on a list where the
  // leavers outnumber the staff.
  if (filters.past) params.set("past", "1");

  return useQuery({
    queryKey: ["employees", filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<EmployeeListItem>>(
        `/api/proxy/employees/employees?${params.toString()}`
      ),
    placeholderData: (previous) => previous,
  });
}

export function useEmployeeDetail(id: number | null) {
  return useQuery({
    queryKey: ["employees", "detail", id],
    queryFn: () => fetchJson<EmployeeDetail>(`/api/proxy/employees/employees/${id}`),
    enabled: id !== null,
  });
}

export type ActivityEvent = {
  date: string;
  kind: "leave" | "timesheet" | "expense" | "training" | "task" | "lifecycle";
  text: string;
};

/**
 * What somebody has been doing, across the modules they use.
 *
 * Distinct from `useEmployeeLogs`, which is the audit trail of edits *to* their
 * record. Nobody opens a profile to find out which of their fields an
 * administrator touched; they open it to see their work.
 */
export function useEmployeeActivity(id: number | null) {
  return useQuery({
    queryKey: ["employees", "activity", id],
    queryFn: () => fetchJson<ActivityEvent[]>(`/api/proxy/employees/employees/${id}/activity`),
    enabled: id != null,
  });
}

export function useEmployeeLogs(id: number | null) {
  return useQuery({
    queryKey: ["employees", "logs", id],
    queryFn: () => fetchJson<EmployeeLogEntry[]>(`/api/proxy/employees/employees/${id}/logs`),
    enabled: id !== null,
  });
}

/**
 * The form keys that carry a `File`.
 *
 * Listed rather than detected by type, because for these keys *absent* and
 * *null* have to mean the same thing, and for everything else they do not: a
 * null `manager` clears the manager, while a null `photo` means "no new
 * picture" and the stored one stays. Filtering the JSON body by
 * `instanceof File` alone would let `photo: null` through after somebody
 * opened the picker and thought better of it, and silently delete the picture
 * already on the record.
 */
const FILE_FIELDS = ["photo", "citizenship_front", "citizenship_back"] as const;

/**
 * Turn a form into a request body, choosing the encoding by what is in it.
 *
 * A file cannot travel as JSON, and sending *everything* as multipart would
 * turn `null` into the four-character string "null" for every empty picker on
 * the form. So: plain JSON unless there is a file, and multipart only then,
 * with nulls dropped rather than stringified.
 *
 * **This handled exactly one file, by name.** Fine while a photo was the only
 * one a person's record could carry; wrong the moment the identity scans
 * became enterable, because `JSON.stringify` renders a `File` as `{}` — the
 * save would have returned 200 with nothing attached, which is the same
 * failure the write serializer's own comment describes one layer down.
 */
function employeeBody(values: Partial<EmployeeFormValues>): BodyInit {
  const entries = Object.entries(values);
  const hasFile = entries.some(([, value]) => value instanceof File);

  if (!hasFile) {
    return JSON.stringify(
      Object.fromEntries(
        entries.filter(([key]) => !(FILE_FIELDS as readonly string[]).includes(key))
      )
    );
  }

  const form = new FormData();
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    if (value instanceof File) form.append(key, value);
    else form.append(key, String(value));
  }
  return form;
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: EmployeeFormValues) =>
      fetchJson<EmployeeDetail>("/api/proxy/employees/employees", {
        method: "POST",
        body: employeeBody(values),
      }),
    meta: { successMessage: "Employee saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });
}

/** One row as the workbook describes it, before anything is created. */
export type ImportPreviewRow = {
  row: number;
  name: string;
  email: string;
  department: string;
  designation: string;
  /** `ready` alone can be imported; the rest are shown, not hidden. */
  status: "ready" | "duplicate" | "invalid";
  note: string;
};

export type ImportPreview = {
  rows: ImportPreviewRow[];
};

/**
 * Read a workbook and describe what it *would* do. Creates nothing.
 *
 * Without a preview, importing is a leap in the dark: you press the button and
 * find out afterwards which rows were refused and why — with half a
 * spreadsheet already created.
 */
export function usePreviewImport() {
  return useMutation({
    mutationFn: async (file: File): Promise<ImportPreview> => {
      const form = new FormData();
      form.append("file", file);
      return fetchJson<ImportPreview>("/api/proxy/employees/employees/import-preview", {
        method: "POST",
        body: form,
      });
    },
  });
}

export type ImportSummary = {
  created: number;
  skipped: number;
  errors: { row: number; email: string; error: string }[];
};

export function useImportEmployees() {
  const queryClient = useQueryClient();
  return useMutation({
    // Multipart — must NOT set Content-Type (browser adds the boundary).
    mutationFn: async ({ file, rows }: { file: File; rows?: number[] }): Promise<ImportSummary> => {
      const form = new FormData();
      form.append("file", file);
      // Which rows somebody chose in the preview. Comma-separated because the
      // file rides in the same multipart request and JSON cannot.
      if (rows?.length) form.append("rows", rows.join(","));
      const res = await fetch("/api/proxy/employees/employees/import-employees", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `Import failed (${res.status})`);
      }
      return res.json();
    },
    meta: { successMessage: "Employee saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<EmployeeFormValues> }) =>
      fetchJson<EmployeeDetail>(`/api/proxy/employees/employees/${id}`, {
        method: "PATCH",
        body: employeeBody(values),
      }),
    meta: { successMessage: "Employee saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });
}

/**
 * The reporting tree, whole.
 *
 * Its own endpoint rather than a large `useEmployees` page: `max_page_size` is
 * 100, so a `pageSize: 1000` request was silently clamped and the chart drew a
 * partial company as though it were the whole one. A tree is only correct as a
 * complete set — a missing manager orphans their entire branch.
 */
export function useOrgChart() {
  return useQuery({
    queryKey: ["employees", "org-chart"],
    queryFn: () => fetchJson<OrgChartNode[]>("/api/proxy/employees/employees/org-chart"),
  });
}

export type EmployeeStatusCounts = {
  total: number;
  active: number;
  on_leave: number;
  resigned: number;
  terminated: number;
};

/**
 * Headcount per employment status, for the directory's filter chips.
 *
 * Server-side because a browser-side tally can only ever describe the page in
 * hand — past the 100-row page cap the chips would confidently show the wrong
 * totals, which is worse than showing none. Shares the department /
 * designation / search filters so the chips agree with the rows beneath them.
 */
export function useEmployeeStatusCounts(filters: {
  search?: string;
  department?: number | "";
  designation?: number | "";
  company?: number | "";
}) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.department) params.set("department", String(filters.department));
  if (filters.designation) params.set("designation", String(filters.designation));
  if (filters.company) params.set("company", String(filters.company));

  return useQuery({
    queryKey: ["employees", "status-counts", filters],
    queryFn: () =>
      fetchJson<EmployeeStatusCounts>(
        `/api/proxy/employees/employees/status-counts?${params.toString()}`
      ),
    placeholderData: (previous) => previous,
  });
}


/**
 * What is still open between somebody and the company on the way out.
 *
 * **Assembled live on every read, never snapshotted.** A statement taken at
 * resignation goes stale the moment a laptop comes back — and a stale exit
 * statement is worse than none, because it gets acted on.
 */
export type OffboardingSummary = {
  assets_out: { id: number; name: string; asset_tag: string }[];
  loans_outstanding: { id: number; loan_type: string; outstanding_balance: string }[];
  loan_total: string;
  unpaid_expenses: { id: number; title: string; amount: string }[];
  expense_total: string;
  leave_remaining: { leave_type: string; remaining: string }[];
  /** Is anything still open, either way — the one number an exit interview runs from. */
  is_clear: boolean;
};

export function useOffboardingSummary(employeeId: number | null) {
  return useQuery({
    queryKey: ["employees", employeeId, "offboarding"],
    queryFn: () =>
      fetchJson<OffboardingSummary>(
        `/api/proxy/employees/employees/${employeeId}/offboarding-summary`
      ),
    enabled: employeeId != null,
    // Live, not cached: the whole point is that it reflects the laptop that
    // came back this morning.
    staleTime: 0,
  });
}
