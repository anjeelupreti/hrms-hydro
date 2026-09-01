"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/apiError";

export type Todo = {
  id: number;
  title: string;
  notes: string;
  due_date: string | null;
  done_at: string | null;
  archived_at: string | null;
  order: number;
  is_done: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

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

const B = "/api/proxy/personal/todos";

function rows(data: Paginated<Todo> | Todo[]) {
  return Array.isArray(data) ? data : data.results;
}

export function useTodos(archived = false) {
  return useQuery({
    queryKey: ["todos", archived ? "archived" : "live"],
    queryFn: async () => rows(await fetchJson<Paginated<Todo> | Todo[]>(`${B}/${archived ? "?archived=1" : ""}`)),
  });
}

/**
 * Every write invalidates both lists, never just the one on screen.
 *
 * Archiving moves a row *between* the two, so refreshing only the live list
 * leaves a stale archive behind — and the archive is exactly where somebody
 * looks straight after archiving something, to check it landed.
 */
function useTodoMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useCreateTodo() {
  return useTodoMutation((body: { title: string; notes?: string; due_date?: string | null }) =>
    fetchJson<Todo>(`${B}/`, { method: "POST", body: JSON.stringify(body) }),
  );
}

export function useUpdateTodo() {
  return useTodoMutation(({ id, ...body }: { id: number } & Partial<Todo>) =>
    fetchJson<Todo>(`${B}/${id}/`, { method: "PATCH", body: JSON.stringify(body) }),
  );
}

export function useToggleTodo() {
  return useTodoMutation((id: number) => fetchJson<Todo>(`${B}/${id}/toggle/`, { method: "POST" }));
}

export function useArchiveTodo() {
  return useTodoMutation((id: number) => fetchJson<Todo>(`${B}/${id}/archive/`, { method: "POST" }));
}

export function useRestoreTodo() {
  return useTodoMutation((id: number) => fetchJson<Todo>(`${B}/${id}/restore/`, { method: "POST" }));
}

export function useDeleteTodo() {
  return useTodoMutation((id: number) => fetchJson<void>(`${B}/${id}/`, { method: "DELETE" }));
}
