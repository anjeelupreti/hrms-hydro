"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";
import type {
  CompanyEvent,
  EventAttachment,
  EventFormValues,
  EventListItem,
  EventStakeholder,
  EventTimeline,
} from "@/types/events";
import type { PaginatedResponse } from "@/types/employees";

const BASE = "/api/proxy/events/events";

export type EventFilters = {
  search?: string;
  kind?: string;
  status?: string;
  when?: "upcoming" | "past";
  from_date?: string;
  to_date?: string;
  page?: number;
  pageSize?: number;
};

function toQuery(filters: EventFilters) {
  const params = new URLSearchParams();
  params.set("page", String(filters.page ?? 1));
  params.set("page_size", String(filters.pageSize ?? 50));
  if (filters.search) params.set("search", filters.search);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.status) params.set("status", filters.status);
  if (filters.when) params.set("when", filters.when);
  if (filters.from_date) params.set("from_date", filters.from_date);
  if (filters.to_date) params.set("to_date", filters.to_date);
  return params.toString();
}

export function useEvents(filters: EventFilters = {}) {
  const query = toQuery(filters);
  return useQuery({
    queryKey: ["events", query],
    queryFn: () => fetchJson<PaginatedResponse<EventListItem>>(`${BASE}?${query}`),
  });
}

/**
 * Upcoming and past in one payload, each already in reading order.
 *
 * The server splits them rather than returning one sorted run, because the page
 * reads outward from now in both directions — sorting one list and cutting it
 * in the browser puts the *furthest* future event first, which is the least
 * interesting row on the page.
 */
export function useEventTimeline(filters: EventFilters = {}) {
  const query = toQuery(filters);
  return useQuery({
    queryKey: ["events", "timeline", query],
    queryFn: () => fetchJson<EventTimeline>(`${BASE}/timeline?${query}`),
  });
}

export function useEvent(id: number | null) {
  return useQuery({
    queryKey: ["event", id],
    queryFn: () => fetchJson<CompanyEvent>(`${BASE}/${id}`),
    enabled: id != null,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return (id?: number) => {
    queryClient.invalidateQueries({ queryKey: ["events"] });
    if (id != null) queryClient.invalidateQueries({ queryKey: ["event", id] });
  };
}

/**
 * Empty strings out of the optional datetime and foreign-key fields.
 *
 * A form posts every field it holds, so an untouched end time arrives as `""`,
 * which DRF's `DateTimeField` rejects outright — a field error about a box
 * nobody typed in.
 */
function normalise(values: Partial<EventFormValues>) {
  const out: Record<string, unknown> = { ...values };
  for (const key of ["ends_at", "company", "organiser"] as const) {
    if (out[key] === "" ) out[key] = null;
  }
  return out;
}

export function useSaveEvent() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<EventFormValues> }) =>
      fetchJson<CompanyEvent>(id ? `${BASE}/${id}` : BASE, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(normalise(values)),
      }),
    onSuccess: (event) => invalidate(event.id),
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${BASE}/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
  });
}

/* ── Stakeholders ────────────────────────────────────────────────────────── */

export function useAddStakeholder() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      eventId,
      ...body
    }: { eventId: number } & Partial<EventStakeholder>) =>
      fetchJson<EventStakeholder>(`${BASE}/${eventId}/stakeholders`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_row, variables) => invalidate(variables.eventId),
  });
}

export function useUpdateStakeholder() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      eventId,
      id,
      ...body
    }: { eventId: number; id: number } & Partial<EventStakeholder>) =>
      fetchJson<EventStakeholder>(`${BASE}/${eventId}/stakeholders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (_row, variables) => invalidate(variables.eventId),
  });
}

export function useRemoveStakeholder() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ eventId, id }: { eventId: number; id: number }) =>
      fetchJson<void>(`${BASE}/${eventId}/stakeholders/${id}`, { method: "DELETE" }),
    onSuccess: (_row, variables) => invalidate(variables.eventId),
  });
}

/* ── Attachments ─────────────────────────────────────────────────────────── */

export function useAddAttachment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ eventId, file, caption }: { eventId: number; file: File; caption: string }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", caption);
      return fetchJson<EventAttachment>(`${BASE}/${eventId}/attachments`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (_row, variables) => invalidate(variables.eventId),
  });
}

export function useRemoveAttachment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ eventId, id }: { eventId: number; id: number }) =>
      fetchJson<void>(`${BASE}/${eventId}/attachments/${id}`, { method: "DELETE" }),
    onSuccess: (_row, variables) => invalidate(variables.eventId),
  });
}
