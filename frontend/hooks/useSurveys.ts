"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

export type QuestionKind = "nps" | "scale5" | "text" | "choice";

export type SurveyQuestion = {
  id?: number;
  text: string;
  kind: QuestionKind;
  choices: string[];
  order?: number;
};

export type Survey = {
  id: number;
  title: string;
  description: string;
  status: "draft" | "active" | "closed";
  anonymous: boolean;
  questions: SurveyQuestion[];
  response_count: number;
  created_at: string;
};

export type ResultQuestion = {
  id: number;
  text: string;
  kind: QuestionKind;
  count: number;
  nps?: number;
  promoters?: number;
  passives?: number;
  detractors?: number;
  average?: number;
  counts?: Record<string, number>;
  answers?: string[];
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

const B = "/api/proxy/surveys";

export function useSurveys(
  archived = false,
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
  // A survey that closed in March is finished, not cancelled. The archive is
  // hidden by default and reachable by asking.
  if (archived) params.set("archived", "1");
  return useQuery({
    queryKey: ["surveys", archived, opts],
    queryFn: () => fetchJson<Paginated<Survey>>(`${B}/?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useSurveyResults(id: number | null) {
  return useQuery({
    queryKey: ["surveys", "results", id],
    queryFn: () => fetchJson<{ response_count: number; questions: ResultQuestion[] }>(`${B}/${id}/results/`),
    enabled: id != null,
  });
}

export function useSaveSurvey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<Survey> & { questions: SurveyQuestion[] } }) =>
      fetchJson<Survey>(id ? `${B}/${id}/` : `${B}/`, { method: id ? "PATCH" : "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Survey saved" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["surveys"] }),
  });
}

export function useDeleteSurvey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${B}/${id}/`, { method: "DELETE" }),
    meta: { successMessage: "Survey deleted" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["surveys"] }),
  });
}

export function useSurveyStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: "publish" | "close" }) =>
      fetchJson<Survey>(`${B}/${id}/${action}/`, { method: "POST" }),
    meta: { successMessage: "Survey updated" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["surveys"] }),
  });
}

export function useRespondSurvey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, answers }: { id: number; answers: { question: number; numeric_value?: number; text_value?: string }[] }) =>
      fetchJson(`${B}/${id}/respond/`, { method: "POST", body: JSON.stringify({ answers }) }),
    meta: { successMessage: "Response submitted" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["surveys"] }),
  });
}
