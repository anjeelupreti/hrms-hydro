"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/apiError";
import type { PaginatedResponse } from "@/types/crm";
import type { EmployeeChangeRequest, RequestableField } from "@/types/changeRequests";

const BASE = "/api/proxy/employees/change-requests";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, res.status));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Requests, scoped server-side: your own, or everybody's if you manage people. */
export function useChangeRequests(
  filters: {
    status?: string;
    employee?: number;
    /** Everything that is no longer waiting, decided server-side. */
    decided?: boolean;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
) {
  // Paged and searched on the server. `page_size=100` was the server's own cap,
  // so the screen held at most a hundred rows and offered no way to the rest —
  // while the status chips, counted in SQL, correctly reported more. Search was
  // the same shape of problem: filtering the loaded rows in the browser cannot
  // match a record it never fetched.
  const params = new URLSearchParams({
    page: String(filters.page ?? 1),
    page_size: String(filters.pageSize ?? 25),
  });
  if (filters.search) params.set("search", filters.search);
  if (filters.decided) params.set("decided", "1");
  if (filters.status) params.set("status", filters.status);
  if (filters.employee != null) params.set("employee", String(filters.employee));
  return useQuery({
    queryKey: ["change-requests", filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<EmployeeChangeRequest>>(`${BASE}/?${params}`),
    // Hold the current page on screen while the next one loads, so paging
    // does not flash an empty table between clicks.
    placeholderData: keepPreviousData,
  });
}

/**
 * What may be asked about, and what each field says now.
 *
 * Read from the server rather than listed here — the allow-list is a security
 * rule, and a copy in the client is one that can drift.
 */
/**
 * How the approval queue stands, counted server-side.
 *
 * A queue's health is not how many rows it has — it is whether anybody is
 * working it. The count is what this serves; the *age* of the oldest waiting
 * request is derived on the page from the rows, which is safe because a
 * pending queue that outgrows one page is itself the finding.
 */
export type ChangeRequestCounts = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  withdrawn: number;
  superseded: number;
};

export function useChangeRequestCounts() {
  return useQuery({
    queryKey: ["change-requests", "counts"],
    queryFn: () =>
      fetchJson<ChangeRequestCounts>("/api/proxy/employees/change-requests/status-counts"),
  });
}

export function useRequestableFields(employeeId?: number | null) {
  const suffix = employeeId != null ? `?employee=${employeeId}` : "";
  return useQuery({
    queryKey: ["change-requests", "fields", employeeId ?? "me"],
    queryFn: () => fetchJson<RequestableField[]>(`${BASE}/fields/${suffix}`),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["change-requests"] });
    // An approved request writes to the employee record, so anything showing
    // that record is now stale too.
    qc.invalidateQueries({ queryKey: ["employees"] });
  };
}

export function useSubmitChangeRequest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (values: {
      field: string;
      new_value: string;
      reason?: string;
      employee?: number;
    }) => fetchJson<EmployeeChangeRequest>(`${BASE}/`, {
      method: "POST",
      body: JSON.stringify(values),
    }),
    meta: { successMessage: "Sent to HR" },
    onSuccess: invalidate,
  });
}

/** approve · reject · withdraw — every one a service call, never a field write. */
export function useDecideChangeRequest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      action,
      note,
    }: {
      id: number;
      action: "approve" | "reject" | "withdraw";
      note?: string;
    }) =>
      fetchJson<EmployeeChangeRequest>(`${BASE}/${id}/${action}/`, {
        method: "POST",
        body: JSON.stringify({ note: note ?? "" }),
      }),
    onSuccess: invalidate,
  });
}
