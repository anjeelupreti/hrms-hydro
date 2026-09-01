"use client";

/**
 * Departments and job titles.
 *
 * **These had no hooks at all.** Both could be *picked* on an employee form and
 * created only by a seed or the API, so a new deployment was told by the setup
 * checklist to add their departments and given nowhere to do it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/apiError";
import type { PaginatedResponse } from "@/types/crm";

export type Department = { id: number; name: string; code: string };
export type Designation = {
  id: number;
  title: string;
  department: number | null;
  department_name: string | null;
};

const BASE = "/api/proxy/employees";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, res.status));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["org-structure"] });
    // The setup checklist counts these, so a new department can move the
    // readiness percentage — it must not keep showing the old one.
    qc.invalidateQueries({ queryKey: ["setup"] });
  };
}

export function useDepartments() {
  return useQuery({
    queryKey: ["org-structure", "departments"],
    queryFn: () =>
      fetchJson<PaginatedResponse<Department>>(`${BASE}/departments/?page_size=200`),
  });
}

export function useDesignations() {
  return useQuery({
    queryKey: ["org-structure", "designations"],
    queryFn: () =>
      fetchJson<PaginatedResponse<Designation>>(`${BASE}/designations/?page_size=200`),
  });
}

export function useCreateDepartment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (values: { name: string; code?: string }) =>
      fetchJson<Department>(`${BASE}/departments/`, {
        method: "POST",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Department added" },
    onSuccess: invalidate,
  });
}

export function useCreateDesignation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (values: { title: string; department?: number | null }) =>
      fetchJson<Designation>(`${BASE}/designations/`, {
        method: "POST",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Job title added" },
    onSuccess: invalidate,
  });
}

/**
 * Removal is refused while anybody is still filed under it.
 *
 * The server answers with a 409 naming what blocks it (`SafeDestroyMixin`), and
 * that message is shown as-is — "cannot delete" on its own sends somebody
 * hunting through 95 employee records.
 */
/**
 * Rename a department, or change its code.
 *
 * Renaming a department in place. Correcting a typo by deleting the row is
 * refused by the server while anybody is in it, and would sever every
 * employee's link to it if it were not.
 */
export function useUpdateDepartment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: { name?: string; code?: string } }) =>
      fetchJson<Department>(`${BASE}/departments/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Saved" },
    onSuccess: invalidate,
  });
}

export function useUpdateDesignation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: number;
      values: { title?: string; department?: number | null };
    }) =>
      fetchJson<Designation>(`${BASE}/designations/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Saved" },
    onSuccess: invalidate,
  });
}

export function useDeleteDepartment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`${BASE}/departments/${id}/`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useDeleteDesignation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`${BASE}/designations/${id}/`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
