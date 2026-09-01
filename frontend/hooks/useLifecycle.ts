"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { LifecycleApprovalAction, LifecycleEvent, PaginatedResponse } from "@/types/lifecycle";
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

export function useLifecycleEvents(filters: { employee?: number } = {}) {
  const params = new URLSearchParams({ page_size: "50" });
  if (filters.employee) params.set("employee", String(filters.employee));

  return useQuery({
    queryKey: ["lifecycle-events", filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<LifecycleEvent>>(`/api/proxy/employees/lifecycle-events?${params.toString()}`),
  });
}

export function usePendingLifecycleApprovals() {
  return useQuery({
    queryKey: ["lifecycle-events", "pending-approval"],
    queryFn: () => fetchJson<LifecycleEvent[]>("/api/proxy/employees/lifecycle-events/pending-approval"),
  });
}

export function useLifecycleActions(eventId: number | null) {
  return useQuery({
    queryKey: ["lifecycle-events", eventId, "actions"],
    queryFn: () => fetchJson<LifecycleApprovalAction[]>(`/api/proxy/employees/lifecycle-events/${eventId}/actions`),
    enabled: eventId !== null,
  });
}

export function useCreateLifecycleEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      fetchJson<LifecycleEvent>("/api/proxy/employees/lifecycle-events", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lifecycle-events"] }),
  });
}

export function useApproveLifecycleEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: number; comment?: string }) =>
      fetchJson<LifecycleEvent>(`/api/proxy/employees/lifecycle-events/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ comment: comment ?? "" }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lifecycle-events"] }),
  });
}

export function useRejectLifecycleEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: number; comment?: string }) =>
      fetchJson<LifecycleEvent>(`/api/proxy/employees/lifecycle-events/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ comment: comment ?? "" }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lifecycle-events"] }),
  });
}

export function useCancelLifecycleEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<LifecycleEvent>(`/api/proxy/employees/lifecycle-events/${id}/cancel`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lifecycle-events"] }),
  });
}
