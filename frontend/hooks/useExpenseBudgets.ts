"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";
import type { PaginatedResponse } from "@/types/employees";

/**
 * What may be spent, and the most one claim may be.
 *
 * A **cap** is per claim, checked when it is submitted. A **budget** is a pool
 * over a period, breached by a running total. They live on one row because they
 * are always decided together — see `expenses/budgets.py` for the matching rule
 * and why "most specific wins".
 */

export type BudgetPeriod = "fiscal_year" | "monthly";
export type BudgetEnforcement = "block" | "warn";

export const BUDGET_PERIODS: { value: BudgetPeriod; label: string }[] = [
  { value: "fiscal_year", label: "Fiscal year" },
  { value: "monthly", label: "Month" },
];

export const BUDGET_ENFORCEMENTS: { value: BudgetEnforcement; label: string }[] = [
  { value: "block", label: "Refuse the claim" },
  { value: "warn", label: "Allow, but flag it" },
];

export type ExpenseBudget = {
  id: number;
  name: string;
  /** Empty means every category. */
  category: string;
  category_display: string;
  department: number | null;
  department_name: string | null;
  employee: number | null;
  employee_name: string | null;
  period: BudgetPeriod;
  period_display: string;
  /** The pool. "0.00" means there is no pool — the row carries a cap only. */
  amount: string;
  per_claim_cap: string | null;
  warn_at_percent: number;
  enforcement: BudgetEnforcement;
  is_active: boolean;
  note: string;
  /** Built from the scope, so a refusal says *why this rule applies to you*. */
  scope_label: string;
  spent: string;
  remaining: string | null;
  used_percent: number | null;
  created_at: string;
  updated_at: string;
};

export type BudgetFormValues = {
  name: string;
  category: string;
  department: number | null;
  employee: number | null;
  period: BudgetPeriod;
  amount: string;
  per_claim_cap: string;
  warn_at_percent: number;
  enforcement: BudgetEnforcement;
  is_active: boolean;
  note: string;
};

const BASE = "/api/proxy/expenses/budgets";

export function useExpenseBudgets() {
  return useQuery({
    queryKey: ["expense-budgets"],
    queryFn: () => fetchJson<PaginatedResponse<ExpenseBudget>>(`${BASE}?page_size=100`),
  });
}

/**
 * Empty strings out of the optional numeric fields.
 *
 * A form posts every field it holds, so an untouched cap arrives as `""`, which
 * DRF's `DecimalField` rejects outright — a field error about a box nobody
 * typed in.
 */
function normalise(values: Partial<BudgetFormValues>) {
  const out: Record<string, unknown> = { ...values };
  if (out.per_claim_cap === "") out.per_claim_cap = null;
  if (out.amount === "") out.amount = "0";
  return out;
}

export function useSaveBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<BudgetFormValues> }) =>
      fetchJson<ExpenseBudget>(id ? `${BASE}/${id}` : BASE, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(normalise(values)),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expense-budgets"] }),
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${BASE}/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expense-budgets"] }),
  });
}

/**
 * What a claim *would* run into, before the form is filled in.
 *
 * Called as the amount and category change, so the ceiling is visible while
 * somebody is deciding what to claim rather than after they have pressed
 * Submit — which is when a budget checked only at approval time tells them.
 */
export function useCheckBudget() {
  return useMutation({
    mutationFn: (body: { category: string; amount: string; expense_date: string }) =>
      fetchJson<{
        allowed: boolean;
        warn: boolean;
        message: string;
        remaining: string | null;
        budget: string | null;
      }>("/api/proxy/expenses/claims/check-budget", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}
