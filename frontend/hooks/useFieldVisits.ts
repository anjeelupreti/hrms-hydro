"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";
import type { PaginatedResponse } from "@/types/employees";

/**
 * Field visits — going to site, and what came of it.
 *
 * Deliberately not part of timesheets. A time entry is *hours on a project on a
 * day*; a visit is a journey with a destination, a purpose, companions, a
 * travel order approved **before** it happens, and a report afterwards. See
 * `backend/fieldvisits/models.py` for the full argument. A completed visit can
 * *generate* time entries, which is the integration worth having.
 */

export type VisitPurpose =
  | "inspection" | "supervision" | "survey" | "maintenance" | "emergency"
  | "meeting" | "community" | "audit" | "training" | "other";

export const VISIT_PURPOSES: { value: VisitPurpose; label: string }[] = [
  { value: "inspection", label: "Inspection" },
  { value: "supervision", label: "Construction supervision" },
  { value: "survey", label: "Survey / investigation" },
  { value: "maintenance", label: "Maintenance" },
  { value: "emergency", label: "Emergency response" },
  { value: "meeting", label: "Meeting" },
  { value: "community", label: "Community / stakeholder" },
  { value: "audit", label: "Audit / regulatory" },
  { value: "training", label: "Training" },
  { value: "other", label: "Other" },
];

export type VisitStatus =
  | "draft" | "requested" | "approved" | "rejected" | "completed" | "cancelled";

export const VISIT_STATUS_TONE: Record<string, "normal" | "caution" | "alarm" | "muted"> = {
  draft: "muted",
  requested: "caution",
  approved: "normal",
  rejected: "alarm",
  completed: "normal",
  cancelled: "muted",
};

export type FieldVisitParticipant = {
  id: number;
  visit: number;
  employee: number | null;
  name: string;
  organisation: string;
  role: string;
};

export type FieldVisitAttachment = {
  id: number;
  visit: number;
  file: string;
  file_url: string | null;
  caption: string;
  created_at: string;
};

export type FieldVisit = {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  company: number | null;
  company_name: string | null;
  project: number | null;
  project_name: string | null;
  purpose: VisitPurpose;
  purpose_display: string;
  title: string;
  destination: string;
  district: string;
  starts_on: string;
  ends_on: string;
  /** Inclusive of both ends — a one-day visit is one day, not zero. */
  days: number;
  description: string;
  report: string;
  transport: string;
  estimated_cost: string | null;
  status: VisitStatus;
  status_display: string;
  approver: number | null;
  approver_name: string | null;
  decided_at: string | null;
  decision_note: string;
  completed_at: string | null;
  expense_claim: number | null;
  participants: FieldVisitParticipant[];
  attachments: FieldVisitAttachment[];
  is_locked: boolean;
  created_at: string;
  updated_at: string;
};

export type FieldVisitFormValues = {
  company: number | null;
  project: number | null;
  purpose: VisitPurpose;
  title: string;
  destination: string;
  district: string;
  starts_on: string;
  ends_on: string;
  description: string;
  transport: string;
  estimated_cost: string;
  approver: number | null;
};

const BASE = "/api/proxy/field-visits/visits";

export type FieldVisitFilters = {
  search?: string;
  status?: string;
  purpose?: string;
  mine?: boolean;
  employee?: number;
};

export function useFieldVisits(filters: FieldVisitFilters = {}) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.purpose) params.set("purpose", filters.purpose);
  if (filters.mine) params.set("mine", "true");
  if (filters.employee) params.set("employee", String(filters.employee));
  const query = params.toString();
  return useQuery({
    queryKey: ["field-visits", query],
    queryFn: () => fetchJson<PaginatedResponse<FieldVisit>>(`${BASE}?${query}`),
  });
}

export function useFieldVisitStatusCounts(filters: FieldVisitFilters = {}) {
  // Derived from the same list rather than a second endpoint: the page loads
  // every visit anyway, and a separate count query is one more thing that can
  // disagree with the rows under it.
  const { data } = useFieldVisits(filters);
  const rows = data?.results ?? [];
  return {
    total: rows.length,
    draft: rows.filter((v) => v.status === "draft").length,
    requested: rows.filter((v) => v.status === "requested").length,
    approved: rows.filter((v) => v.status === "approved").length,
    completed: rows.filter((v) => v.status === "completed").length,
    rejected: rows.filter((v) => v.status === "rejected").length,
  };
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["field-visits"] });
    // An approved visit writes attendance, so the day view can change with it.
    queryClient.invalidateQueries({ queryKey: ["attendance"] });
  };
}

function normalise(values: Partial<FieldVisitFormValues>) {
  const out: Record<string, unknown> = { ...values };
  if (out.estimated_cost === "") out.estimated_cost = null;
  return out;
}

export function useSaveFieldVisit() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<FieldVisitFormValues> }) =>
      fetchJson<FieldVisit>(id ? `${BASE}/${id}` : BASE, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(normalise(values)),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteFieldVisit() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${BASE}/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

function transition<TBody extends object>(path: string) {
  return function useTransition() {
    const invalidate = useInvalidate();
    return useMutation({
      mutationFn: ({ id, ...body }: { id: number } & TBody) =>
        fetchJson<FieldVisit>(`${BASE}/${id}/${path}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      onSuccess: invalidate,
    });
  };
}

export const useRequestFieldVisit = transition<{ /* no body */ }>("request_order");
export const useApproveFieldVisit = transition<{ note?: string }>("approve");
export const useRejectFieldVisit = transition<{ note?: string }>("reject");
export const useCompleteFieldVisit = transition<{ report: string }>("complete");

/** Turn a completed visit into timesheet lines — the honest half of "can
 *  timesheets carry field visits". */
export function useGenerateTimesheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hours_per_day }: { id: number; hours_per_day?: string }) =>
      fetchJson<{ created: number; days: number }>(`${BASE}/${id}/generate-timesheet`, {
        method: "POST",
        body: JSON.stringify({ hours_per_day: hours_per_day ?? "8.00" }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["timesheets"] }),
  });
}

export function useAddVisitParticipant() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<FieldVisitParticipant>) =>
      fetchJson<FieldVisitParticipant>(`${BASE}/${id}/participants`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
}

export function useRemoveVisitParticipant() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, participantId }: { id: number; participantId: number }) =>
      fetchJson<void>(`${BASE}/${id}/participants/${participantId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
