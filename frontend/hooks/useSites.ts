"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";

export type Site = {
  id: number;
  name: string;
  /** Short form for a dropdown or a report column. Not an identifier. */
  code: string;
  company: number | null;
  company_name: string | null;
  district: string;
  province: string;
  address: string;
  description: string;
  supervisors: number[];
  supervisor_names: { id: number; name: string; employee_code: string }[];
  is_active: boolean;
  /** How many trips have been made here — what tells a live site from a row
   *  somebody created once. */
  visit_count: number;
};

export type SiteFormValues = {
  name: string;
  code: string;
  company: number | null;
  district: string;
  province: string;
  address: string;
  description: string;
  supervisors: number[];
  is_active: boolean;
};

/** Somebody who may be asked to approve a trip — the site's people or yours. */
export type EligibleApprover = { id: number; name: string; employee_code: string };

type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

const BASE = "/api/proxy/field-visits/sites";

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["sites"] });
    // A site's supervisors decide who may approve a trip to it, so the picker
    // on any open travel order is now stale.
    queryClient.invalidateQueries({ queryKey: ["eligible-approvers"] });
  };
}

export function useSites(params: { search?: string; active?: boolean } = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.active !== undefined) query.set("is_active", String(params.active));
  const suffix = query.toString();
  return useQuery({
    queryKey: ["sites", suffix],
    queryFn: () => fetchJson<Page<Site>>(`${BASE}${suffix ? `?${suffix}` : ""}`),
  });
}

export function useSaveSite() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, values }: { id: number | null; values: SiteFormValues }) =>
      fetchJson<Site>(id ? `${BASE}/${id}` : BASE, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: invalidate,
  });
}

/** Retires the site rather than deleting it — see the viewset's `destroy`. */
export function useRetireSite() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => fetchJson<Site>(`${BASE}/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

/**
 * Who the signed-in person may ask to approve a trip.
 *
 * **Answered by the server, not assembled here.** The same list is what
 * `request_order` validates against; two copies of that rule is how a form
 * comes to offer somebody the API then refuses.
 */
export function useEligibleApprovers(siteId: number | null) {
  return useQuery({
    queryKey: ["eligible-approvers", siteId],
    queryFn: () =>
      fetchJson<EligibleApprover[]>(
        `/api/proxy/field-visits/visits/eligible-approvers${siteId ? `?site=${siteId}` : ""}`
      ),
  });
}
