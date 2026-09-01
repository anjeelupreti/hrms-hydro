"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Holiday, PaginatedResponse } from "@/types/holidays";
import { apiErrorMessage } from "@/lib/apiError";

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

export function useHolidays() {
  return useQuery({
    queryKey: ["holidays"],
    queryFn: () => fetchJson<PaginatedResponse<Holiday>>("/api/proxy/notifications/holidays?page_size=100"),
  });
}

export function useCreateHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Omit<Holiday, "id">) =>
      fetchJson<Holiday>("/api/proxy/notifications/holidays", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

/**
 * Correct a holiday — its name or its date.
 *
 * Correcting a holiday rather than deleting and re-adding it. Holidays are read
 * by the attendance sweep and the leave day-count, so a row recreated is not
 * the same row corrected.
 */
export function useUpdateHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<Omit<Holiday, "id">> }) =>
      fetchJson<Holiday>(`/api/proxy/notifications/holidays/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

export function useDeleteHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`/api/proxy/notifications/holidays/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["holidays"] }),
  });
}
