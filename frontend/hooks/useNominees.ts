"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/apiError";

/**
 * Who receives a fund if the employee dies.
 *
 * Reads `employees/nominees`. `Nominee` models four separate legal instruments,
 * so four separate nominee lists rather than one; its serializer validates
 * shares against over-allocation, and its viewset is scoped so one person's
 * next of kin cannot leak to the system.
 */

export const SCHEMES = [
  { value: "ssf", label: "Social Security Fund" },
  { value: "pf", label: "Provident Fund" },
  { value: "cit", label: "Citizen Investment Trust" },
  { value: "gratuity", label: "Gratuity" },
  { value: "insurance", label: "Life insurance" },
] as const;

export type SchemeValue = (typeof SCHEMES)[number]["value"];

export type Nominee = {
  id: number;
  employee: number;
  scheme: SchemeValue;
  scheme_display: string;
  name: string;
  relationship: string;
  date_of_birth: string | null;
  citizenship_number: string;
  /** Serialised as a decimal string by DRF. */
  share_percent: string | number;
};

export type NomineeInput = {
  scheme: SchemeValue;
  name: string;
  relationship: string;
  date_of_birth?: string | null;
  citizenship_number?: string;
  share_percent: number;
};

type Paginated<T> = { count: number; results: T[] };

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

const B = "/api/proxy/employees/nominees";

export function useNominees(employeeId?: number) {
  return useQuery({
    queryKey: ["nominees", employeeId ?? "me"],
    queryFn: async () => {
      // No `?employee=` means "mine" — the viewset defaults to the caller's own
      // record, so the common case needs no id and cannot be pointed elsewhere
      // by fiddling with the URL.
      const query = employeeId ? `?employee=${employeeId}&page_size=100` : "?page_size=100";
      const data = await fetchJson<Paginated<Nominee> | Nominee[]>(`${B}/${query}`);
      return Array.isArray(data) ? data : data.results;
    },
  });
}

function useNomineeMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: ["nominees"] }),
  });
}

export function useCreateNominee(employeeId?: number) {
  return useNomineeMutation((body: NomineeInput) =>
    fetchJson<Nominee>(`${B}/`, {
      method: "POST",
      body: JSON.stringify(employeeId ? { ...body, employee: employeeId } : body),
    }),
  );
}

export function useUpdateNominee() {
  return useNomineeMutation(({ id, ...body }: { id: number } & Partial<NomineeInput>) =>
    fetchJson<Nominee>(`${B}/${id}/`, { method: "PATCH", body: JSON.stringify(body) }),
  );
}

export function useDeleteNominee() {
  return useNomineeMutation((id: number) => fetchJson<void>(`${B}/${id}/`, { method: "DELETE" }));
}
