"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedResponse } from "@/types/collaboration";
import { apiErrorMessage } from "@/lib/apiError";
import type {
  Candidate,
  CandidateNote,
  CandidateStage,
  EmploymentType,
  JobPosting,
  JobStatus,
  RecruitmentSummary,
} from "@/types/recruitment";

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

const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ["recruitment"] });

// --- Jobs -----------------------------------------------------------------

export function useJobs(
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
  // A role that has been filled is not a role you are hiring for.
  if (archived) params.set("archived", "1");
  return useQuery({
    queryKey: ["recruitment", "jobs", archived, opts],
    queryFn: () =>
      fetchJson<PaginatedResponse<JobPosting>>(
        `/api/proxy/recruitment/jobs?${params.toString()}`
      ),
    placeholderData: keepPreviousData,
  });
}

export function useJob(id: number | null) {
  return useQuery({
    queryKey: ["recruitment", "job", id],
    queryFn: () => fetchJson<JobPosting>(`/api/proxy/recruitment/jobs/${id}`),
    enabled: id != null,
  });
}

export function useRecruitmentSummary() {
  return useQuery({
    queryKey: ["recruitment", "summary"],
    queryFn: () => fetchJson<RecruitmentSummary>("/api/proxy/recruitment/jobs/summary"),
  });
}

type JobInput = {
  title: string;
  department?: number | null;
  location: string;
  employment_type: EmploymentType;
  status: JobStatus;
  description: string;
  openings: number;
  salary_min?: number | null;
  salary_max?: number | null;
};

export function useSaveJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: JobInput }) =>
      fetchJson<JobPosting>(id ? `/api/proxy/recruitment/jobs/${id}` : "/api/proxy/recruitment/jobs", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => invalidate(qc),
  });
}

// --- Candidates -----------------------------------------------------------

export function useCandidates(jobId: number | null) {
  return useQuery({
    queryKey: ["recruitment", "candidates", jobId],
    queryFn: async () => {
      const d = await fetchJson<PaginatedResponse<Candidate>>(
        `/api/proxy/recruitment/candidates?job=${jobId}&page_size=100`
      );
      return d.results;
    },
    enabled: jobId != null,
  });
}

export function useSaveCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<Candidate> & { job?: number } }) =>
      fetchJson<Candidate>(
        id ? `/api/proxy/recruitment/candidates/${id}` : "/api/proxy/recruitment/candidates",
        { method: id ? "PATCH" : "POST", body: JSON.stringify(values) }
      ),
    onSuccess: () => invalidate(qc),
  });
}

export function useMoveCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: CandidateStage }) =>
      fetchJson<Candidate>(`/api/proxy/recruitment/candidates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      }),
    onSuccess: () => invalidate(qc),
  });
}

export function useUploadCandidateResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const form = new FormData();
      form.append("resume", file);
      const res = await fetch(`/api/proxy/recruitment/candidates/${id}`, { method: "PATCH", body: form });
      if (!res.ok) throw new Error("Résumé upload failed");
      return res.json() as Promise<Candidate>;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useCandidateNotes(candidateId: number | null) {
  return useQuery({
    queryKey: ["recruitment", "notes", candidateId],
    queryFn: () => fetchJson<CandidateNote[]>(`/api/proxy/recruitment/candidates/${candidateId}/notes`),
    enabled: candidateId != null,
  });
}

export function useAddCandidateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ candidateId, body }: { candidateId: number; body: string }) =>
      fetchJson<CandidateNote>(`/api/proxy/recruitment/candidates/${candidateId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["recruitment", "notes", vars.candidateId] });
      invalidate(qc);
    },
  });
}

// --- Offers, and the bridge to an employee --------------------------------
//
// The pipeline could move a candidate to "offer" and "hired" and nothing
// happened beyond the label changing: no Offer row, no acceptance, no account,
// no onboarding checklist. The backend had all of it; the browser could not
// reach any of it, so the last two stages of hiring were decorative.

export type Offer = {
  id: number;
  candidate: number;
  candidate_name: string;
  status: "draft" | "sent" | "accepted" | "declined" | "expired";
  annual_salary: string | null;
  designation: number | null;
  department: number | null;
  start_date: string | null;
  expires_on: string | null;
  decline_reason: string;
  responded_at: string | null;
  is_open: boolean;
};

export function useOfferForCandidate(candidateId: number | null) {
  return useQuery({
    queryKey: ["recruitment", "offer", candidateId],
    queryFn: async () => {
      const page = await fetchJson<PaginatedResponse<Offer> | Offer[]>(
        `/api/proxy/recruitment/offers?candidate=${candidateId}`
      );
      const rows = Array.isArray(page) ? page : page.results;
      return rows[0] ?? null;
    },
    enabled: Boolean(candidateId),
  });
}

export function useSaveOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<Offer> & { id?: number }) =>
      fetchJson<Offer>(
        values.id ? `/api/proxy/recruitment/offers/${values.id}` : "/api/proxy/recruitment/offers",
        { method: values.id ? "PATCH" : "POST", body: JSON.stringify(values) }
      ),
    onSuccess: () => invalidate(qc),
  });
}

/** Send, accept or decline. One hook because they are the same shape and the
 *  difference is which verb the server was asked for. */
export function useOfferAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: number;
      action: "send" | "accept" | "decline";
      reason?: string;
    }) =>
      fetchJson<Offer>(`/api/proxy/recruitment/offers/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      }),
    onSuccess: () => invalidate(qc),
  });
}

export type ConversionResult = {
  employee_id: number;
  employee_code: string;
  username: string;
  email: string;
  onboarding_checklist_id: number | null;
  onboarding_tasks: number;
};

/** Turn a hired candidate into an employee with a login.
 *
 * Idempotent on the server — a second press returns the employee already
 * created rather than a duplicate person, which matters because this is the
 * button somebody double-taps when it feels slow. */
export function useConvertCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: number) =>
      fetchJson<ConversionResult>(
        `/api/proxy/recruitment/candidates/${candidateId}/convert-to-employee`,
        { method: "POST" }
      ),
    onSuccess: () => {
      invalidate(qc);
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}
