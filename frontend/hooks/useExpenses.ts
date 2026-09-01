"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ExpenseTrend } from "@/types/dashboard";
import type { ExpenseClaim, PaginatedResponse } from "@/types/expenses";
import { fetchJson } from "@/lib/query/fetchJson";


export function useExpenseClaims(
  filters: {
    status?: string;
    employee?: number;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
) {
  // Paged rather than clamped. This used to ask for `page_size=100`, which the
  // server caps at 100 anyway — so the screen showed a hundred claims and
  // offered no way to reach the rest, while the status chips (counted in SQL by
  // `useExpenseStatusCounts`) correctly said there were more. A list that
  // disagrees with the number above it is worse than a short list.
  const params = new URLSearchParams({
    page: String(filters.page ?? 1),
    page_size: String(filters.pageSize ?? 25),
  });
  if (filters.status) params.set("status", filters.status);
  if (filters.employee) params.set("employee", String(filters.employee));
  if (filters.search) params.set("search", filters.search);
  return useQuery({
    queryKey: ["expenses", filters],
    queryFn: () => fetchJson<PaginatedResponse<ExpenseClaim>>(`/api/proxy/expenses/claims?${params.toString()}`),
    // Hold the current page on screen while the next one loads, so paging
    // does not flash an empty table between clicks.
    placeholderData: keepPreviousData,
  });
}

export function useCreateExpenseClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    // Multipart so the optional receipt rides along; never set Content-Type.
    mutationFn: (form: FormData) =>
      fetchJson<ExpenseClaim>("/api/proxy/expenses/claims", { method: "POST", body: form }),
    meta: { successMessage: "Expense saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export function useExpenseAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      note,
      reference,
    }: {
      id: number;
      action: "approve" | "reject" | "reimburse" | "cancel";
      note?: string;
      reference?: string;
    }) =>
      fetchJson<ExpenseClaim>(`/api/proxy/expenses/claims/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ note: note ?? "", reference: reference ?? "" }),
      }),
    meta: { successMessage: "Expense saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export type ExpenseStatusBucket = { count: number; amount: string };
export type ExpenseStatusCounts = {
  total: number;
  pending: ExpenseStatusBucket;
  approved: ExpenseStatusBucket;
  rejected: ExpenseStatusBucket;
  reimbursed: ExpenseStatusBucket;
  cancelled: ExpenseStatusBucket;
};

/**
 * Claim counts and money per status.
 *
 * Counted in SQL, not from `results`. A page is clamped at 100, so a tally of
 * the rows on screen undercounts past that — and "pending" is the figure
 * somebody acts on.
 */
export function useExpenseStatusCounts() {
  return useQuery({
    queryKey: ["expenses", "status-counts"],
    queryFn: () => fetchJson<ExpenseStatusCounts>("/api/proxy/expenses/claims/status-counts"),
    // Hold the current page on screen while the next one loads, so paging
    // does not flash an empty table between clicks.
    placeholderData: keepPreviousData,
  });
}

/** What was spent per month and on what — see `useLeaveTrend` on why it is
 *  a separate query from the filtered list. */
export function useExpenseTrend() {
  return useQuery({
    queryKey: ["expenses", "trend"],
    queryFn: () => fetchJson<ExpenseTrend>("/api/proxy/expenses/claims/trend"),
  });
}
