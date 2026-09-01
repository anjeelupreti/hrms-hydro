"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type AttendancePolicy = {
  id: number;
  allow_web: boolean;
  allow_biometric: boolean;
  /** What the toggles add up to, named by the server so the screen does not
   *  have to know the source names. */
  permitted_sources: string[];
  /**
   * D‑05 — whether lateness costs money.
   *
   * **Off unless a company chooses it.** A shift's grace period has always
   * decided who is late, but turning that into a deduction by default would
   * dock pay under a rule nobody agreed to.
   */
  lateness_deduction_enabled: boolean;
  /** How many late days cost one day's pay. Whole days, rounded down. */
  late_days_per_deduction: number;
};

export type AttendanceMethod = {
  id: number;
  employee: number;
  employee_name: string;
  /** Null means "no opinion" — fall back to the company rule. `false` is a
   *  deliberate no, and the two are different answers. */
  allow_web: boolean | null;
  allow_biometric: boolean | null;
  note: string;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `Request failed (${response.status})`);
  }
  return response.json();
}

export function useAttendancePolicy() {
  return useQuery({
    queryKey: ["attendance", "policy"],
    queryFn: () => json<AttendancePolicy>("/api/proxy/attendance/policy"),
  });
}

export function useUpdateAttendancePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<AttendancePolicy>) =>
      json<AttendancePolicy>("/api/proxy/attendance/policy", {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance", "policy"] }),
  });
}

export function useAttendanceMethods() {
  return useQuery({
    queryKey: ["attendance", "methods"],
    queryFn: async () => {
      const page = await json<{ results?: AttendanceMethod[] } | AttendanceMethod[]>(
        "/api/proxy/attendance/attendance-methods"
      );
      return Array.isArray(page) ? page : (page.results ?? []);
    },
  });
}

export function useSaveAttendanceMethod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<AttendanceMethod> & { id?: number }) =>
      json<AttendanceMethod>(
        values.id
          ? `/api/proxy/attendance/attendance-methods/${values.id}`
          : "/api/proxy/attendance/attendance-methods",
        { method: values.id ? "PATCH" : "POST", body: JSON.stringify(values) }
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance", "methods"] }),
  });
}

export function useDeleteAttendanceMethod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/proxy/attendance/attendance-methods/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance", "methods"] }),
  });
}
