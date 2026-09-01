"use client";

/**
 * Named pay structures, and putting people on them.
 *
 * Separate from `useSalaryStructures` for the reason the models are separate: a
 * structure is the record of what somebody was actually paid from when and is
 * never edited, while a template is a starting point that has paid nobody and
 * is edited freely. Sharing a hook would blur exactly the line that matters.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";

const URL = "/api/proxy/payroll/salary-templates";

export type SalaryTemplateLine = {
  id?: number;
  component: number;
  component_code: string;
  component_name: string;
  component_type: "earning" | "deduction";
  calc_type: "flat" | "percentage_of" | "formula" | "slab_based";
  amount: string | null;
};

export type SalaryTemplate = {
  id: number;
  name: string;
  description: string;
  is_default: boolean;
  lines: SalaryTemplateLine[];
  applied_count: number;
};

export type UnassignedEmployees = {
  count: number;
  employees: { id: number; employee_code: string; name: string; department: string | null }[];
};

/**
 * What applying a template actually did, person by person.
 *
 * Served rather than inferred from a count. "97 created" leaves somebody
 * guessing which three were skipped and why, and the two kinds of skip need
 * different answers — one is a repeat click, the other is a real conflict.
 */
export type ApplyReport = {
  created: string[];
  already_dated: string[];
  already_on_pay: string[];
  created_count: number;
  skipped_count: number;
};

export function useSalaryTemplates() {
  return useQuery({
    queryKey: ["salary-templates"],
    queryFn: () => fetchJson<{ results: SalaryTemplate[] }>(URL).then((d) => d.results ?? []),
  });
}

export function useUnassignedEmployees() {
  return useQuery({
    queryKey: ["salary-templates", "unassigned"],
    queryFn: () => fetchJson<UnassignedEmployees>(`${URL}/unassigned`),
    // The number decides whether somebody runs a bulk action over their whole
    // workforce, so it has to describe the world now rather than the world
    // when the tab was opened.
    staleTime: 0,
  });
}

type TemplateInput = {
  name: string;
  description: string;
  is_default: boolean;
  lines: { component: number; amount: string | null }[];
};

export function useSaveSalaryTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: TemplateInput }) =>
      fetchJson<SalaryTemplate>(id ? `${URL}/${id}` : URL, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Template saved" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary-templates"] }),
  });
}

export function useDeleteSalaryTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${URL}/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Template removed" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary-templates"] }),
  });
}

export function useApplyTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      effective_from: string;
      employees?: number[];
      replace_existing?: boolean;
    }) =>
      fetchJson<ApplyReport>(`${URL}/${id}/apply`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-templates"] });
      // Structures changed, so anything that reads them is now stale — the
      // payroll dashboard's readiness among them.
      qc.invalidateQueries({ queryKey: ["salary-structures"] });
      qc.invalidateQueries({ queryKey: ["setup"] });
    },
  });
}
