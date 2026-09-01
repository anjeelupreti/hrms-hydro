"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

import type { LeaveTrend } from "@/types/dashboard";
import type {
  ApprovalActionEntry,
  LeaveBalance,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  PaginatedResponse,
} from "@/types/leave";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, response.status));
  }
  return response.json();
}

export function useLeaveTypes() {
  return useQuery({
    queryKey: ["leave-types"],
    queryFn: () => fetchJson<PaginatedResponse<LeaveType>>("/api/proxy/leave/types?page_size=100"),
  });
}

export function useCreateLeaveType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Omit<LeaveType, "id" | "is_active"> & { is_active?: boolean }) =>
      fetchJson<LeaveType>("/api/proxy/leave/types", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Leave request updated" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-types"] }),
  });
}

export function useMyLeaveBalances(employeeId: number | undefined) {
  return useQuery({
    queryKey: ["leave-balances", employeeId],
    queryFn: () =>
      fetchJson<PaginatedResponse<LeaveBalance>>(
        `/api/proxy/leave/balances?employee=${employeeId}&page_size=50`
      ),
    enabled: employeeId !== undefined,
  });
}

export type LeaveRequestFilters = {
  page: number;
  pageSize: number;
  status?: LeaveStatus;
  employee?: number;
  /** Free text, matched server-side against employee, leave type and reason. */
  search?: string;
};

/**
 * @param enabled Hold the request until the caller knows what to ask for.
 *   There is no "match nothing" filter value to fall back on: Django's
 *   filterset validates `employee` against real ids and answers **400** for a
 *   sentinel like `-1`, not an empty page. A caller still waiting on
 *   permissions must not ask at all.
 */
export function useLeaveRequests(filters: LeaveRequestFilters, enabled = true) {
  const params = new URLSearchParams({
    page: String(filters.page),
    page_size: String(filters.pageSize),
  });
  if (filters.status) params.set("status", filters.status);
  if (filters.employee) params.set("employee", String(filters.employee));
  if (filters.search) params.set("search", filters.search);

  return useQuery({
    queryKey: ["leave-requests", filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<LeaveRequest>>(`/api/proxy/leave/requests?${params.toString()}`),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function usePendingMyAction() {
  return useQuery({
    queryKey: ["leave-requests", "pending-my-action"],
    queryFn: () => fetchJson<LeaveRequest[]>("/api/proxy/leave/requests/pending-my-action"),
  });
}

export function useLeaveRequestActions(id: number | null) {
  return useQuery({
    queryKey: ["leave-requests", "actions", id],
    queryFn: () => fetchJson<ApprovalActionEntry[]>(`/api/proxy/leave/requests/${id}/actions`),
    enabled: id !== null,
  });
}

/**
 * What a date range would actually cost, asked of the server.
 *
 * **Not counted in the browser.** Weekends and public holidays are not charged,
 * and which days those are comes from the company's working week and its holiday
 * table. Reimplementing that here would be a second answer to the same
 * question, and the two would drift the first time the company changed either —
 * leaving somebody told they were spending four days while their balance
 * dropped by two.
 */
export function useLeaveDayCount(start: string, end: string, halfDay: boolean) {
  const valid = Boolean(start && end && end >= start);
  return useQuery({
    queryKey: ["leave-requests", "day-count", start, end, halfDay],
    queryFn: () =>
      fetchJson<{ days: string; calendar_days: number }>(
        `/api/proxy/leave/requests/day-count?start=${start}&end=${end}&half_day=${halfDay}`
      ),
    enabled: valid,
    // The working week and the holiday table do not move while a form is open.
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      leave_type: number;
      start_date: string;
      end_date: string;
      half_day: boolean;
      reason: string;
    }) =>
      fetchJson<LeaveRequest>("/api/proxy/leave/requests", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Leave request updated" },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
    },
  });
}

function useDecisionMutation(action: "approve" | "reject" | "cancel") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: number; comment?: string }) =>
      fetchJson<LeaveRequest>(`/api/proxy/leave/requests/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ comment: comment ?? "" }),
      }),
    meta: { successMessage: "Leave request updated" },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
    },
  });
}

export function useApproveLeaveRequest() {
  return useDecisionMutation("approve");
}

export function useRejectLeaveRequest() {
  return useDecisionMutation("reject");
}

export function useCancelLeaveRequest() {
  return useDecisionMutation("cancel");
}

/**
 * Delete a leave type, or retire it when it carries history.
 *
 * Requests reference a type with PROTECT and balances cascade, so the API
 * answers 409 rather than quietly taking the history with it.
 */
export function useDeleteLeaveType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`/api/proxy/leave/types/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Leave type deleted" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-types"] }),
  });
}

export function useSetLeaveTypeActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      fetchJson<LeaveType>(
        `/api/proxy/leave/types/${id}/${active ? "reactivate" : "deactivate"}`,
        { method: "POST" }
      ),
    meta: { successMessage: "Leave type updated" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-types"] }),
  });
}

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type LeaveStatusCounts = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
};

/**
 * Leave requests per state, counted in SQL.
 *
 * "How many are waiting on me" is the question this page exists to answer, and
 * a grid capped at 100 rows cannot answer it — the tally would stop at the page
 * boundary on exactly the systems where the number matters.
 */
export function useLeaveStatusCounts() {
  return useQuery({
    queryKey: ["leave-requests", "status-counts"],
    queryFn: () => fetchJson<LeaveStatusCounts>("/api/proxy/leave/requests/status-counts"),
    placeholderData: (previous) => previous,
  });
}

/**
 * The twelve-month shape of leave, for the chart on the leave screen.
 *
 * Its own query rather than part of the list: the list is filtered and
 * paginated by whatever the user is looking at, and a trend that moved every
 * time somebody searched would be describing the search, not the company.
 */
export function useLeaveTrend() {
  return useQuery({
    queryKey: ["leave", "trend"],
    queryFn: () => fetchJson<LeaveTrend>("/api/proxy/leave/requests/trend"),
  });
}
