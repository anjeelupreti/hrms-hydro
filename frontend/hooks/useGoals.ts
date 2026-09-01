"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

export type KeyResult = {
  id?: number;
  title: string;
  start_value: string | number;
  target_value: string | number;
  current_value: string | number;
  unit: string;
  order?: number;
  progress?: number;
};

export type Objective = {
  id: number;
  owner: number | null;
  owner_name: string;
  title: string;
  description: string;
  period: string;
  status: "active" | "completed" | "cancelled";
  key_results: KeyResult[];
  progress: number;
  created_at: string;
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

const B = "/api/proxy/goals/objectives";

export function useObjectives(filters: { status?: string; archived?: boolean } = {}) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.status) params.set("status", filters.status);
  // Last quarter's objectives are history, not clutter to delete.
  if (filters.archived) params.set("archived", "1");
  return useQuery({
    queryKey: ["goals", filters],
    queryFn: () => fetchJson<Paginated<Objective>>(`${B}/?${params.toString()}`),
  });
}

export function useSaveObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<Objective> & { key_results: KeyResult[] } }) =>
      fetchJson<Objective>(id ? `${B}/${id}/` : `${B}/`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Objective saved" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useDeleteObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${B}/${id}/`, { method: "DELETE" }),
    meta: { successMessage: "Objective deleted" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useCheckinKeyResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ objectiveId, key_result, current_value }: { objectiveId: number; key_result: number; current_value: number }) =>
      fetchJson<Objective>(`${B}/${objectiveId}/checkin/`, {
        method: "POST",
        body: JSON.stringify({ key_result, current_value }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}
