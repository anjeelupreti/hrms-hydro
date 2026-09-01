"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/apiError";

/**
 * The client desk — customers' concerns, in CRM.
 *
 * The backend has had all of this since 17 August: declared status flow, two
 * SLA clocks, breach reported while it is still happening, client-visible
 * versus internal timeline entries, and a board endpoint. **The browser had
 * none of it** — no types, no hooks, no page — which is why the phase scored
 * 4/7 while its tests passed.
 */

/** The values, not the labels. The column reads "Waiting on customer" and the
 *  value is `waiting` — writing the label here would have produced a type that
 *  never matches anything the server sends. */
export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed";

export type ClientTicket = {
  id: number;
  /** Quotable in an email — "about CT-0042" has to mean something to both sides. */
  reference: string;
  client: number;
  client_name: string;
  contact: number | null;
  contact_name: string | null;
  subject: string;
  description: string;
  priority: "low" | "normal" | "high" | "urgent";
  channel: string;
  status: TicketStatus;
  assignee: number | null;
  assignee_name: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  response_due_at: string | null;
  resolution_due_at: string | null;
  /** Breach while it is *still happening* — what a queue is scanned for. */
  response_breached: boolean;
  resolution_breached: boolean;
  /** A queue is read by age far more than by date: "open four days" is what
   *  makes somebody act. */
  age_hours: number;
  created_at: string;
};

export type TicketBoard = {
  columns: {
    value: TicketStatus;
    label: string;
    is_terminal: boolean;
    count: number;
    cards: ClientTicket[];
  }[];
  /** Legal moves, so the board refuses a drag before asking the server. */
  transitions: Record<string, string[]>;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(body, response.status));
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export type TicketFilters = {
  status?: string;
  priority?: string;
  client?: number;
  assignee?: number;
  search?: string;
};

function query(filters: TicketFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== null) params.set(key, String(value));
  }
  return params.toString();
}

export function useTicketBoard(filters: TicketFilters = {}) {
  return useQuery({
    queryKey: ["tickets", "board", filters],
    queryFn: () => json<TicketBoard>(`/api/proxy/crm/tickets/board?${query(filters)}`),
  });
}

export function useTickets(filters: TicketFilters = {}) {
  return useQuery({
    queryKey: ["tickets", "list", filters],
    queryFn: async () => {
      const page = await json<{ results?: ClientTicket[] } | ClientTicket[]>(
        `/api/proxy/crm/tickets?${query(filters)}`
      );
      return Array.isArray(page) ? page : (page.results ?? []);
    },
  });
}

export function useRaiseTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<ClientTicket>) =>
      json<ClientTicket>("/api/proxy/crm/tickets", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

/**
 * Move a ticket between columns.
 *
 * A refused move returns 409 with the rule that refused it, which the board
 * surfaces rather than snapping the card back in silence.
 */
export function useMoveTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: string; note?: string }) =>
      json<ClientTicket>(`/api/proxy/crm/tickets/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ status, note: note ?? "" }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useAssignTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, assignee }: { id: number; assignee: number | null }) =>
      json<ClientTicket>(`/api/proxy/crm/tickets/${id}/assign`, {
        method: "POST",
        body: JSON.stringify({ assignee }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export type TimelineEntry = {
  id: number;
  kind: string;
  body: string;
  /** The one boundary that cannot be got wrong: `internal` must never be
   *  rendered as something a customer has seen.
   *
   *  The value is `customer`, not `client` — I wrote `client` from the label
   *  and it type-checked happily, because a union that never matches is still
   *  a valid union. Third label-for-value slip today; the others were
   *  `waiting_on_customer` for `waiting` and the same class of guess. */
  visibility: "internal" | "customer";
  from_value: string;
  to_value: string;
  who: string;
  created_at: string;
};

export function useTicketTimeline(ticketId: number | null) {
  return useQuery({
    queryKey: ["tickets", "timeline", ticketId],
    queryFn: () => json<TimelineEntry[]>(`/api/proxy/crm/tickets/${ticketId}/timeline`),
    enabled: Boolean(ticketId),
  });
}

/**
 * A reply stops the response clock; an internal note deliberately does not.
 * One hook, because the difference is which the caller asked for — and getting
 * that boundary wrong leaks an internal comment to a customer.
 */
export function useTicketReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
      internal,
    }: {
      id: number;
      body: string;
      internal: boolean;
    }) =>
      json<TimelineEntry>(
        `/api/proxy/crm/tickets/${id}/${internal ? "note" : "reply"}`,
        { method: "POST", body: JSON.stringify({ body }) }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export type ClientDeskSummary = {
  live: number;
  awaiting_first_reply: number;
  /** Live tickets nobody has replied to whose promised reply time has passed. */
  response_breaches: number;
  resolution_breaches: number;
  unassigned: number;
  oldest_open_days: number | null;
};

/**
 * The desk measured against its promises, not its volume.
 *
 * A client ticket snapshots two due times when it is raised, so "late" is a
 * fact here rather than an opinion. Breaches are counted in SQL: the model
 * expresses them as Python properties, and asking those row by row would read
 * the whole table to produce one number (§2.6).
 */
export function useClientDeskSummary() {
  return useQuery({
    queryKey: ["crm", "tickets", "desk-summary"],
    queryFn: () => json<ClientDeskSummary>("/api/proxy/crm/tickets/desk-summary/"),
    placeholderData: (previous) => previous,
  });
}
