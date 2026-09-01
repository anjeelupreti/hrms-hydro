"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedResponse } from "@/types/collaboration";
import { apiErrorMessage } from "@/lib/apiError";
import type {
  DeliveryMode,
  Enrollment,
  EnrollmentStatus,
  TrainingProgram,
  TrainingSession,
} from "@/types/training";

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

function invalidateTraining(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["training"] });
}

// --- Programs -------------------------------------------------------------

export function usePrograms(
  opts: { search?: string; page?: number; pageSize?: number } = {}
) {
  // Paged and searched on the server rather than clamped at the cap. See
  // `usePagedList` — a hundred rows with nothing beyond them is records the
  // reader cannot reach, and a browser-side filter cannot match a row it never
  // fetched.
  const params = new URLSearchParams({
    page: String(opts.page ?? 1),
    page_size: String(opts.pageSize ?? 25),
  });
  if (opts.search) params.set("search", opts.search);
  return useQuery({
    queryKey: ["training", "programs", opts],
    queryFn: () =>
      fetchJson<PaginatedResponse<TrainingProgram>>(
        `/api/proxy/training/programs?${params.toString()}`
      ),
    placeholderData: keepPreviousData,
  });
}

export function useProgram(id: number | null) {
  return useQuery({
    queryKey: ["training", "program", id],
    queryFn: () => fetchJson<TrainingProgram>(`/api/proxy/training/programs/${id}`),
    enabled: id != null,
  });
}

type ProgramInput = {
  title: string;
  description: string;
  category: string;
  delivery_mode: DeliveryMode;
  is_active: boolean;
};

export function useSaveProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: ProgramInput }) =>
      fetchJson<TrainingProgram>(
        id ? `/api/proxy/training/programs/${id}` : "/api/proxy/training/programs",
        { method: id ? "PATCH" : "POST", body: JSON.stringify(values) }
      ),
    meta: { successMessage: "Updated" },
    onSuccess: () => invalidateTraining(queryClient),
  });
}

// --- Sessions -------------------------------------------------------------

export function useSessions(programId: number | null, archived = false) {
  // A *session* is a run that finishes, so it archives. The **program** above
  // it is a reusable definition — a course you no longer offer is deactivated,
  // not archived — which is why the archive lives here and not on the program
  // list.
  const suffix = archived ? "&archived=1" : "";
  return useQuery({
    queryKey: ["training", "sessions", programId, archived],
    queryFn: async () => {
      const data = await fetchJson<PaginatedResponse<TrainingSession>>(
        `/api/proxy/training/sessions?program=${programId}&page_size=100${suffix}`
      );
      return data.results;
    },
    enabled: programId != null,
  });
}

type SessionInput = {
  program: number;
  start_datetime: string;
  end_datetime: string;
  location: string;
  capacity: number;
  trainer?: number | null;
};

export function useSaveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: SessionInput }) =>
      fetchJson<TrainingSession>(
        id ? `/api/proxy/training/sessions/${id}` : "/api/proxy/training/sessions",
        { method: id ? "PATCH" : "POST", body: JSON.stringify(values) }
      ),
    meta: { successMessage: "Updated" },
    onSuccess: () => invalidateTraining(queryClient),
  });
}

export function useAssignEmployees() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, employeeIds }: { sessionId: number; employeeIds: number[] }) =>
      fetchJson<TrainingSession>(`/api/proxy/training/sessions/${sessionId}/assign`, {
        method: "POST",
        body: JSON.stringify({ employee_ids: employeeIds }),
      }),
    meta: { successMessage: "Updated" },
    onSuccess: () => invalidateTraining(queryClient),
  });
}

// --- Enrollments ----------------------------------------------------------

export function useEnrollments(filters: { session?: number; employee?: number } = {}) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.session) params.set("session", String(filters.session));
  if (filters.employee) params.set("employee", String(filters.employee));

  return useQuery({
    queryKey: ["training", "enrollments", filters],
    queryFn: async () => {
      const data = await fetchJson<PaginatedResponse<Enrollment>>(
        `/api/proxy/training/enrollments?${params.toString()}`
      );
      return data.results;
    },
    // Employee filter needs a resolved id; session-only / all still run.
    enabled: filters.employee !== undefined ? filters.employee != null : true,
  });
}

export function useRequestEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: number) =>
      fetchJson<Enrollment>("/api/proxy/training/enrollments", {
        method: "POST",
        body: JSON.stringify({ session: sessionId }),
      }),
    meta: { successMessage: "Updated" },
    onSuccess: () => invalidateTraining(queryClient),
  });
}

/** approve | decline | cancel — the no-body enrollment actions. */
export function useEnrollmentAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "decline" | "cancel" }) =>
      fetchJson<Enrollment>(`/api/proxy/training/enrollments/${id}/${action}`, { method: "POST" }),
    meta: { successMessage: "Updated" },
    onSuccess: () => invalidateTraining(queryClient),
  });
}

export function useEnrollment(id: number | null) {
  return useQuery({
    queryKey: ["training", "enrollment", id],
    queryFn: () => fetchJson<Enrollment>(`/api/proxy/training/enrollments/${id}`),
    enabled: id != null,
  });
}

export function useIssueCertificate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<Enrollment>(`/api/proxy/training/enrollments/${id}/issue-certificate`, { method: "POST" }),
    meta: { successMessage: "Updated" },
    onSuccess: () => invalidateTraining(queryClient),
  });
}

export function useCompleteEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      score,
      feedback,
    }: {
      id: number;
      status: Extract<EnrollmentStatus, "completed" | "no_show">;
      score?: number | null;
      feedback?: string;
    }) =>
      fetchJson<Enrollment>(`/api/proxy/training/enrollments/${id}/complete`, {
        method: "POST",
        body: JSON.stringify({ status, score, feedback }),
      }),
    meta: { successMessage: "Updated" },
    onSuccess: () => invalidateTraining(queryClient),
  });
}
