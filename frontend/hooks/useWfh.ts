"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedResponse } from "@/types/collaboration";
import type { WFHRequest, WFHSummary, WorkLocation } from "@/types/wfh";
import { apiErrorMessage } from "@/lib/apiError";

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

const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ["wfh"] });

export function useWfhRequests(
  filters: { status?: string; search?: string; page?: number; pageSize?: number } = {}
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
  if (filters.status) params.set("status", filters.status);
  return useQuery({
    queryKey: ["wfh", "requests", filters],
    // The whole page, not just `results`. Unwrapping here threw away `count`,
    // which is the only number that can say how many requests there are beyond
    // the ones on screen.
    queryFn: () =>
      fetchJson<PaginatedResponse<WFHRequest>>(`/api/proxy/wfh/requests?${params.toString()}`),
    // Hold the current page on screen while the next one loads, so paging
    // does not flash an empty table between clicks.
    placeholderData: keepPreviousData,
  });
}

export function useWfhSummary() {
  return useQuery({
    queryKey: ["wfh", "summary"],
    queryFn: () => fetchJson<WFHSummary>("/api/proxy/wfh/requests/summary"),
  });
}

export function useCreateWfh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      start_date: string;
      end_date: string;
      work_location: WorkLocation;
      location_note?: string;
      reason?: string;
    }) => fetchJson<WFHRequest>("/api/proxy/wfh/requests", { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Request updated" },
    onSuccess: () => invalidate(qc),
  });
}

export function useWfhAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "reject" | "cancel" }) =>
      fetchJson<WFHRequest>(`/api/proxy/wfh/requests/${id}/${action}`, { method: "POST" }),
    meta: { successMessage: "Request updated" },
    onSuccess: () => invalidate(qc),
  });
}

export type WfhStatus = "pending" | "approved" | "rejected" | "cancelled";

export type WfhStatusCounts = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
};

/** Requests per state, counted in SQL rather than over one clamped page. */
export function useWfhStatusCounts() {
  return useQuery({
    queryKey: ["wfh", "status-counts"],
    queryFn: () => fetchJson<WfhStatusCounts>("/api/proxy/wfh/requests/status-counts"),
    // Hold the current page on screen while the next one loads, so paging
    // does not flash an empty table between clicks.
    placeholderData: keepPreviousData,
  });
}
