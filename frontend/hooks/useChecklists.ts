"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

import type {
  Checklist,
  ChecklistTemplate,
  ChecklistTemplateItem,
  MyChecklistTask,
} from "@/types/checklists";

type Paginated<T> = { count: number; results: T[] };

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

const B = "/api/proxy/checklists";

export function useChecklists(
  filters: {
    kind?: string;
    status?: string;
    archived?: boolean;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
) {
  const params = new URLSearchParams({
    page: String(filters.page ?? 1),
    page_size: String(filters.pageSize ?? 25),
  });
  if (filters.search) params.set("search", filters.search);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.status) params.set("status", filters.status);
  // A finished onboarding run is not wrong, not cancelled and not deletable —
  // it is simply over, and it should stop crowding the ones that are not.
  if (filters.archived) params.set("archived", "1");
  return useQuery({
    queryKey: ["checklists", filters],
    queryFn: () => fetchJson<Paginated<Checklist>>(`${B}/?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useChecklistTemplates() {
  return useQuery({
    queryKey: ["checklist-templates"],
    queryFn: () => fetchJson<Paginated<ChecklistTemplate>>(`${B}/templates/?page_size=100`),
  });
}

export function useMyChecklistTasks() {
  return useQuery({
    queryKey: ["checklist-tasks", "mine"],
    queryFn: () => fetchJson<MyChecklistTask[]>(`${B}/tasks/mine/`),
  });
}

export function useCreateChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { employee: number; template?: number; title?: string; kind?: string }) =>
      fetchJson<Checklist>(`${B}/`, { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Checklist started" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["checklists"] }),
  });
}

export function useUpdateChecklistTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; status?: string; assignee?: number | null; due_date?: string | null }) =>
      fetchJson(`${B}/tasks/${id}/`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checklists"] });
      qc.invalidateQueries({ queryKey: ["checklist-tasks"] });
    },
  });
}

export function useCancelChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson(`${B}/${id}/cancel/`, { method: "POST" }),
    meta: { successMessage: "Checklist cancelled" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["checklists"] }),
  });
}

export function useSaveChecklistTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<ChecklistTemplate> & { items: ChecklistTemplateItem[] } }) =>
      fetchJson<ChecklistTemplate>(id ? `${B}/templates/${id}/` : `${B}/templates/`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Template saved" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["checklist-templates"] }),
  });
}

export function useDeleteChecklistTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${B}/templates/${id}/`, { method: "DELETE" }),
    meta: { successMessage: "Template deleted" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["checklist-templates"] }),
  });
}
