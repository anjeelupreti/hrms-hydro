"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AttendanceCalendarResponse, CompanyEvent, PaginatedResponse } from "@/types/calendar";
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
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function useAttendanceCalendar(start: string, end: string, employee?: number) {
  const params = new URLSearchParams({ start, end });
  if (employee) params.set("employee", String(employee));

  return useQuery({
    queryKey: ["attendance-calendar", start, end, employee],
    queryFn: () => fetchJson<AttendanceCalendarResponse>(`/api/proxy/attendance/calendar?${params.toString()}`),
  });
}

export function useCompanyEvents(start?: string, end?: string) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);

  return useQuery({
    queryKey: ["company-events", start, end],
    queryFn: () =>
      fetchJson<PaginatedResponse<CompanyEvent>>(`/api/proxy/notifications/company-events?${params.toString()}`),
  });
}

export function useCreateCompanyEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Omit<CompanyEvent, "id" | "attendees">) =>
      fetchJson<CompanyEvent>("/api/proxy/notifications/company-events", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company-events"] }),
  });
}

export function useUpdateCompanyEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<Omit<CompanyEvent, "id" | "attendees">> }) =>
      fetchJson<CompanyEvent>(`/api/proxy/notifications/company-events/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company-events"] }),
  });
}

export function useDeleteCompanyEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`/api/proxy/notifications/company-events/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company-events"] }),
  });
}

// --- Meetings (CompanyEvent rows with event_type=meeting + attendees) ------

/**
 * The meetings this reader may see, narrowed server-side.
 *
 * `state` and `role` are filtered by the API rather than in the browser, so
 * the answer does not depend on how many rows happened to be fetched — "my
 * cancelled meetings" has to mean all of them, not all of the first hundred.
 */
export function useMeetings(filters: { state?: string; role?: string } = {}) {
  const query = new URLSearchParams({ page_size: "100" });
  if (filters.state) query.set("state", filters.state);
  if (filters.role) query.set("role", filters.role);
  const suffix = query.toString();
  return useQuery({
    queryKey: ["meetings", suffix],
    queryFn: () =>
      fetchJson<PaginatedResponse<CompanyEvent>>(`/api/proxy/notifications/meetings?${suffix}`),
  });
}

/** Call it off, with a reason, and tell everybody invited. */
export function useCancelMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      fetchJson<CompanyEvent>(`/api/proxy/notifications/meetings/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["company-events"] });
    },
  });
}

/** Put it back on, keeping the agenda it already had. */
export function useReinstateMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<CompanyEvent>(`/api/proxy/notifications/meetings/${id}/reinstate`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["company-events"] });
    },
  });
}

export function useCreateMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      title: string;
      description?: string;
      start_datetime: string;
      end_datetime: string;
      location?: string;
      attendee_ids: number[];
    }) => fetchJson<CompanyEvent>("/api/proxy/notifications/meetings", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["company-events"] });
    },
  });
}

export function useRsvpMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rsvp_status }: { id: number; rsvp_status: string }) =>
      fetchJson<CompanyEvent>(`/api/proxy/notifications/meetings/${id}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ rsvp_status }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meetings"] }),
  });
}
