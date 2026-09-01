"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

export type TicketComment = { id: number; body: string; author_name: string | null; created_at: string };

export type Ticket = {
  id: number;
  subject: string;
  description: string;
  category: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "resolved" | "closed";
  requester: number | null;
  requester_name: string | null;
  assignee: number | null;
  assignee_name: string | null;
  comments: TicketComment[];
  resolved_at: string | null;
  created_at: string;
};

type Paginated<T> = { count: number; results: T[] };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, res.status));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const B = "/api/proxy/helpdesk/tickets";

export function useTickets(filters: { status?: string; category?: string; priority?: string } = {}) {
  const params = new URLSearchParams({ page_size: "100" });
  Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
  return useQuery({
    queryKey: ["tickets", filters],
    queryFn: () => fetchJson<Paginated<Ticket>>(`${B}/?${params.toString()}`),
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { subject: string; description?: string; category: string; priority: string }) =>
      fetchJson<Ticket>(`${B}/`, { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Ticket opened" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; status?: string; assignee?: number | null; priority?: string; category?: string }) =>
      fetchJson<Ticket>(`${B}/${id}/`, { method: "PATCH", body: JSON.stringify(body) }),
    meta: { successMessage: "Ticket updated" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useCommentTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      fetchJson<Ticket>(`${B}/${id}/comment/`, { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export type TicketStatusCounts = {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
};

/** Tickets per state, counted in SQL — the list itself stops at 100 rows. */
export function useTicketStatusCounts() {
  return useQuery({
    queryKey: ["tickets", "status-counts"],
    queryFn: () => fetchJson<TicketStatusCounts>(`${B}/status-counts`),
    placeholderData: (previous) => previous,
  });
}

export type TicketQueueSummary = {
  unresolved: number;
  unassigned: number;
  urgent: number;
  /** Whole days the oldest unresolved request has waited. Null when none are open. */
  oldest_open_days: number | null;
  resolved_this_week: number;
};

/**
 * How the queue is doing, as opposed to what is in it.
 *
 * The status counts beside this answer "how many are open"; these answer the
 * two questions a help desk is actually judged on — is anything rotting, and
 * does everything have somebody's name on it. Both are invisible in a list
 * capped at a page, and both are counted over the caller's own scope: someone
 * who can only see their own tickets gets a reading of their own tickets.
 */
export function useTicketQueueSummary() {
  return useQuery({
    queryKey: ["tickets", "queue-summary"],
    queryFn: () => fetchJson<TicketQueueSummary>(`${B}/queue-summary/`),
    placeholderData: (previous) => previous,
  });
}
