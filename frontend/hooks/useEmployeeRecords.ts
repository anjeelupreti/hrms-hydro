"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";
import type {
  Award,
  CorporatePost,
  CorporateRole,
  DisciplinaryAction,
  PaginatedResponse,
  Suspension,
  SuspensionOutcome,
} from "@/types/employees";

/**
 * The records the company keeps *about* somebody — awards, disciplinary
 * actions, suspensions — and the two lookups behind post and role.
 *
 * Kept out of `useEmployees.ts`, which is already the directory, the org chart,
 * the importer and the status counts. These are per-person side records with
 * one shape between them, and they invalidate together.
 */

const BASE = "/api/proxy/employees";

/** Everything that changes a person's record invalidates the same keys: the
 *  list it belongs to, and the employee itself, whose status or chips may have
 *  moved with it. */
function useInvalidate(keys: string[]) {
  const queryClient = useQueryClient();
  return (employeeId?: number) => {
    for (const key of keys) queryClient.invalidateQueries({ queryKey: [key] });
    queryClient.invalidateQueries({ queryKey: ["employees"] });
    if (employeeId != null) {
      queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employee-profile", employeeId] });
    }
  };
}

/* ── Awards ──────────────────────────────────────────────────────────────── */

export function useAwards(employeeId: number | null) {
  return useQuery({
    queryKey: ["awards", employeeId],
    queryFn: () =>
      fetchJson<PaginatedResponse<Award>>(`${BASE}/awards?employee=${employeeId}&page_size=100`),
    enabled: employeeId != null,
  });
}

export type AwardInput = Omit<
  Award,
  "id" | "employee_name" | "kind_display" | "created_at" | "updated_at" | "certificate"
> & { certificate?: File | null };

/** Multipart, always. An award usually carries a scanned certificate, and a
 *  form that posts JSON when there is no file and multipart when there is has
 *  two code paths where one will do. */
function toFormData(values: Record<string, unknown>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    form.append(key, value instanceof File ? value : String(value));
  }
  return form;
}

export function useSaveAward() {
  const invalidate = useInvalidate(["awards"]);
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<AwardInput> }) =>
      fetchJson<Award>(id ? `${BASE}/awards/${id}` : `${BASE}/awards`, {
        method: id ? "PATCH" : "POST",
        body: toFormData(values as Record<string, unknown>),
      }),
    onSuccess: (award) => invalidate(award.employee),
  });
}

export function useDeleteAward() {
  const invalidate = useInvalidate(["awards"]);
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`${BASE}/awards/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
  });
}

/* ── Disciplinary actions ────────────────────────────────────────────────── */

export function useDisciplinaryActions(employeeId: number | null) {
  return useQuery({
    queryKey: ["disciplinary-actions", employeeId],
    queryFn: () =>
      fetchJson<PaginatedResponse<DisciplinaryAction>>(
        `${BASE}/disciplinary-actions?employee=${employeeId}&page_size=100`
      ),
    enabled: employeeId != null,
  });
}

export type DisciplinaryInput = Omit<
  DisciplinaryAction,
  | "id"
  | "employee_name"
  | "severity_display"
  | "status_display"
  | "is_current"
  | "created_at"
  | "updated_at"
  | "document"
> & { document?: File | null };

export function useSaveDisciplinaryAction() {
  const invalidate = useInvalidate(["disciplinary-actions"]);
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<DisciplinaryInput> }) =>
      fetchJson<DisciplinaryAction>(
        id ? `${BASE}/disciplinary-actions/${id}` : `${BASE}/disciplinary-actions`,
        { method: id ? "PATCH" : "POST", body: toFormData(values as Record<string, unknown>) }
      ),
    onSuccess: (action) => invalidate(action.employee),
  });
}

export function useDeleteDisciplinaryAction() {
  const invalidate = useInvalidate(["disciplinary-actions"]);
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`${BASE}/disciplinary-actions/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
  });
}

/* ── Suspension ──────────────────────────────────────────────────────────── */

export function useSuspensions(employeeId: number | null) {
  return useQuery({
    queryKey: ["suspensions", employeeId],
    queryFn: () =>
      fetchJson<PaginatedResponse<Suspension>>(
        `${BASE}/suspensions?employee=${employeeId}&page_size=100`
      ),
    enabled: employeeId != null,
  });
}

export function useSuspend() {
  const invalidate = useInvalidate(["suspensions"]);
  return useMutation({
    mutationFn: (values: {
      employee: number;
      starts_on: string;
      ends_on?: string | null;
      reason: string;
    }) =>
      fetchJson<Suspension>(`${BASE}/suspensions`, {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: (suspension) => invalidate(suspension.employee),
  });
}

/**
 * End one, and say how.
 *
 * A separate mutation rather than a PATCH because the outcome is required:
 * "the suspension is over" and "the suspension became a dismissal" are
 * different facts, and a nullable field on an update lets the second be
 * recorded as the first by omission.
 */
export function useLiftSuspension() {
  const invalidate = useInvalidate(["suspensions"]);
  return useMutation({
    mutationFn: ({
      id,
      outcome,
      note,
    }: {
      id: number;
      outcome: Exclude<SuspensionOutcome, "pending">;
      note?: string;
    }) =>
      fetchJson<Suspension>(`${BASE}/suspensions/${id}/lift`, {
        method: "POST",
        body: JSON.stringify({ outcome, note: note ?? "" }),
      }),
    onSuccess: (suspension) => invalidate(suspension.employee),
  });
}

/* ── The chair and the work ──────────────────────────────────────────────── */

export function useCorporatePosts() {
  return useQuery({
    queryKey: ["corporate-posts"],
    queryFn: () =>
      fetchJson<PaginatedResponse<CorporatePost>>(`${BASE}/corporate-posts?page_size=200`),
  });
}

export function useCorporateRoles() {
  return useQuery({
    queryKey: ["corporate-roles"],
    queryFn: () =>
      fetchJson<PaginatedResponse<CorporateRole>>(`${BASE}/corporate-roles?page_size=200`),
  });
}

export function useSaveCorporatePost() {
  const invalidate = useInvalidate(["corporate-posts"]);
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<CorporatePost> }) =>
      fetchJson<CorporatePost>(
        id ? `${BASE}/corporate-posts/${id}` : `${BASE}/corporate-posts`,
        { method: id ? "PATCH" : "POST", body: JSON.stringify(values) }
      ),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCorporatePost() {
  const invalidate = useInvalidate(["corporate-posts"]);
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`${BASE}/corporate-posts/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
  });
}

export function useSaveCorporateRole() {
  const invalidate = useInvalidate(["corporate-roles"]);
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<CorporateRole> }) =>
      fetchJson<CorporateRole>(
        id ? `${BASE}/corporate-roles/${id}` : `${BASE}/corporate-roles`,
        { method: id ? "PATCH" : "POST", body: JSON.stringify(values) }
      ),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCorporateRole() {
  const invalidate = useInvalidate(["corporate-roles"]);
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`${BASE}/corporate-roles/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
  });
}
