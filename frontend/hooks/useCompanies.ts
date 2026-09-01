"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";
import type { Company, CompanyFormValues, CompanyOption } from "@/types/companies";
import type { PaginatedResponse } from "@/types/employees";

const BASE = "/api/proxy/companies/companies";

export type CompanyFilters = {
  page?: number; // 1-indexed, matches DRF
  pageSize?: number;
  search?: string;
  kind?: string;
  project_stage?: string;
  is_active?: boolean;
};

function toQuery(filters: CompanyFilters) {
  const params = new URLSearchParams();
  params.set("page", String(filters.page ?? 1));
  params.set("page_size", String(filters.pageSize ?? 25));
  if (filters.search) params.set("search", filters.search);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.project_stage) params.set("project_stage", filters.project_stage);
  if (filters.is_active !== undefined) params.set("is_active", String(filters.is_active));
  return params.toString();
}

export function useCompanies(filters: CompanyFilters = {}) {
  const query = toQuery(filters);
  return useQuery({
    queryKey: ["companies", query],
    queryFn: () => fetchJson<PaginatedResponse<Company>>(`${BASE}?${query}`),
  });
}

export function useCompany(id: number | null) {
  return useQuery({
    queryKey: ["company", id],
    queryFn: () => fetchJson<Company>(`${BASE}/${id}`),
    enabled: id != null,
  });
}

/**
 * Every active company, in the shape a dropdown needs.
 *
 * A separate endpoint from the list because the list carries the licence
 * number, the postal address and the headcount of every row — none of which
 * belongs in a `<select>`, and all of which would be fetched twice on an
 * employee form that offers companies in two fields.
 */
export function useCompanyOptions(enabled = true) {
  return useQuery({
    queryKey: ["company-options"],
    queryFn: () => fetchJson<CompanyOption[]>(`${BASE}/options`),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** Everything that writes invalidates the same two keys — a company's name
 *  appears on employee records and in every picker. */
function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["companies"] });
    queryClient.invalidateQueries({ queryKey: ["company-options"] });
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  };
}

export function useCreateCompany() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (values: CompanyFormValues) =>
      fetchJson<Company>(BASE, { method: "POST", body: JSON.stringify(normalise(values)) }),
    onSuccess: invalidate,
  });
}

export function useUpdateCompany() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<CompanyFormValues> }) =>
      fetchJson<Company>(`${BASE}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(normalise(values)),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteCompany() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${BASE}/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

/**
 * Empty strings out of the optional numeric and date fields.
 *
 * A form posts every field it holds, so an untouched capacity or date arrives
 * as `""` — which DRF's `DecimalField` and `DateField` reject outright, with a
 * field error about a box nobody typed in.
 */
function normalise(values: Partial<CompanyFormValues>) {
  const out: Record<string, unknown> = { ...values };
  for (const key of ["installed_capacity_mw", "established_on"] as const) {
    if (out[key] === "") out[key] = null;
  }
  return out;
}
