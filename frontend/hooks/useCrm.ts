"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

import type {
  Activity,
  Client,
  Contact,
  Deal,
  Invoice,
  InvoiceLineItem,
  PaginatedResponse,
} from "@/types/crm";

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

// --- Clients ---------------------------------------------------------------

export function useClients(search?: string) {
  const params = new URLSearchParams({ page_size: "100" });
  if (search) params.set("search", search);

  return useQuery({
    queryKey: ["crm", "clients", search],
    queryFn: () => fetchJson<PaginatedResponse<Client>>(`/api/proxy/crm/clients?${params.toString()}`),
  });
}

export function useClient(id: number | null) {
  return useQuery({
    queryKey: ["crm", "clients", "detail", id],
    queryFn: () => fetchJson<Client>(`/api/proxy/crm/clients/${id}`),
    enabled: id !== null,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Omit<Client, "id">) =>
      fetchJson<Client>("/api/proxy/crm/clients", { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "clients"] }),
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<Client> }) =>
      fetchJson<Client>(`/api/proxy/crm/clients/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "clients"] }),
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`/api/proxy/crm/clients/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "clients"] }),
  });
}

// --- Contacts ----------------------------------------------------------------

export function useContacts(clientId?: number) {
  const params = new URLSearchParams({ page_size: "100" });
  if (clientId) params.set("client", String(clientId));

  return useQuery({
    queryKey: ["crm", "contacts", clientId],
    queryFn: () => fetchJson<PaginatedResponse<Contact>>(`/api/proxy/crm/contacts?${params.toString()}`),
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Omit<Contact, "id" | "client_name">) =>
      fetchJson<Contact>("/api/proxy/crm/contacts", { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "contacts"] }),
  });
}

// --- Deals -------------------------------------------------------------------

/** One bucket: how many, and what they are worth. */
export type CrmBucket = { count: number; amount: string };

export type DealStageCounts = {
  total: number;
  lead: CrmBucket;
  qualified: CrmBucket;
  proposal: CrmBucket;
  won: CrmBucket;
  lost: CrmBucket;
};

/**
 * How much is sitting in each stage of the pipeline.
 *
 * Counted in SQL, and summed by value rather than by row: "6 in Proposal" is
 * not what anybody wants to know about a pipeline — "6 in Proposal worth
 * 11,959,456" is. Tallying the loaded page would also stop at 100 deals.
 */
export function useDealStageCounts(filters: { client?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.client) params.set("client", String(filters.client));

  return useQuery({
    queryKey: ["crm", "deal-stage-counts", filters],
    queryFn: () =>
      fetchJson<DealStageCounts>(`/api/proxy/crm/deals/status-counts?${params.toString()}`),
    placeholderData: (previous) => previous,
  });
}

export function useDeals(filters: { client?: number; stage?: string } = {}) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.client) params.set("client", String(filters.client));
  if (filters.stage) params.set("stage", filters.stage);

  return useQuery({
    queryKey: ["crm", "deals", filters],
    queryFn: () => fetchJson<PaginatedResponse<Deal>>(`/api/proxy/crm/deals?${params.toString()}`),
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { client: number; title: string; stage: string; value: string; expected_close_date?: string | null }) =>
      fetchJson<Deal>("/api/proxy/crm/deals", { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "deals"] }),
  });
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<Deal> }) =>
      fetchJson<Deal>(`/api/proxy/crm/deals/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "deals"] }),
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`/api/proxy/crm/deals/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "deals"] }),
  });
}

// --- Invoices --------------------------------------------------------------

/**
 * Invoice totals by state, in money as well as count.
 *
 * "Overdue: 4" means nothing without "worth 812,000" — which is why the
 * viewset sums the line items per bucket rather than only counting rows.
 * Summed in SQL, over every invoice rather than the page on screen (§2.6).
 */
export type InvoiceBucket = { count: number; amount: string };
export type InvoiceCounts = {
  total: number;
  draft: InvoiceBucket;
  sent: InvoiceBucket;
  paid: InvoiceBucket;
  void: InvoiceBucket;
};

export function useInvoiceCounts() {
  return useQuery({
    queryKey: ["crm", "invoices", "counts"],
    queryFn: () => fetchJson<InvoiceCounts>("/api/proxy/crm/invoices/status-counts"),
  });
}

export function useInvoices(filters: { client?: number; status?: string } = {}) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.client) params.set("client", String(filters.client));
  if (filters.status) params.set("status", filters.status);
  return useQuery({
    queryKey: ["crm", "invoices", filters],
    queryFn: () => fetchJson<PaginatedResponse<Invoice>>(`/api/proxy/crm/invoices?${params.toString()}`),
  });
}

export function useInvoice(id: number | null) {
  return useQuery({
    queryKey: ["crm", "invoice", id],
    queryFn: () => fetchJson<Invoice>(`/api/proxy/crm/invoices/${id}`),
    enabled: id != null,
  });
}

type InvoiceInput = {
  client: number;
  project?: number | null;
  issue_date: string;
  due_date?: string | null;
  currency?: string;
  notes?: string;
  line_items: InvoiceLineItem[];
};

export function useSaveInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: InvoiceInput }) =>
      fetchJson<Invoice>(id ? `/api/proxy/crm/invoices/${id}` : "/api/proxy/crm/invoices", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "invoices"] }),
  });
}

export function useInvoiceAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: "mark-sent" | "mark-paid" | "void" }) =>
      fetchJson<Invoice>(`/api/proxy/crm/invoices/${id}/${action}`, { method: "POST" }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "invoices"] }),
  });
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`/api/proxy/crm/invoices/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "invoices"] }),
  });
}

// --- Activities ------------------------------------------------------------

export function useActivities(filters: { client?: number; contact?: number; deal?: number }) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.client) params.set("client", String(filters.client));
  if (filters.contact) params.set("contact", String(filters.contact));
  if (filters.deal) params.set("deal", String(filters.deal));

  return useQuery({
    queryKey: ["crm", "activities", filters],
    queryFn: () => fetchJson<PaginatedResponse<Activity>>(`/api/proxy/crm/activities?${params.toString()}`),
  });
}

export function useLogActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      activity_type: string;
      notes: string;
      occurred_at: string;
      client?: number;
      contact?: number;
      deal?: number;
    }) => fetchJson<Activity>("/api/proxy/crm/activities", { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "activities"] }),
  });
}

export type ClientBookSummary = {
  clients_total: number;
  clients_active: number;
  won_value: string;
  open_value: string;
  open_deals: number;
  outstanding: string;
  overdue: string;
  overdue_invoices: number;
  clients_with_open_tickets: number;
};

/**
 * What the client list is worth, and what is owed on it.
 *
 * The value of a client is not in the `Client` row — it is in the deals and
 * invoices hanging off it, which is why a list of names and industries could
 * never say which of them matter. Summed on the server: the invoice figure
 * comes from line items, and doing that in the browser over one page of clients
 * would understate it on exactly the companys with enough clients to care (§2.6).
 */
export function useClientBookSummary() {
  return useQuery({
    queryKey: ["crm", "clients", "book-summary"],
    queryFn: () => fetchJson<ClientBookSummary>("/api/proxy/crm/clients/book-summary"),
    placeholderData: (previous) => previous,
  });
}
