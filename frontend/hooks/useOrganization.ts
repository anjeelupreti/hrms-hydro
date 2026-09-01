"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";

import type {
  CompanyProfile,
  PaginatedResponse,
  Review,
  ReviewCycle,
  CompanyEmailSettings,
} from "@/types/organization";


// --- Company profile -------------------------------------------------------

export function useCompanyProfile() {
  return useQuery({
    queryKey: ["organization", "company-profile"],
    queryFn: () => fetchJson<CompanyProfile>("/api/proxy/organization/company-profile"),
  });
}

export function useUpdateCompanyProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      fetchJson<CompanyProfile>("/api/proxy/organization/company-profile", {
        method: "PATCH",
        body: formData,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization", "company-profile"] }),
  });
}

// --- Email settings ----------------------------------------------------------

export function useEmailSettings(enabled = true) {
  return useQuery({
    queryKey: ["organization", "email-settings"],
    queryFn: () => fetchJson<CompanyEmailSettings>("/api/proxy/organization/email-settings"),
    // Gated by the caller: this endpoint needs `settings.manage`, and asking
    // for it on behalf of somebody who does not hold it produces a 403 in the
    // console on a page that is otherwise working.
    enabled,
  });
}

export function useUpdateEmailSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<CompanyEmailSettings> & { password?: string }) =>
      fetchJson<CompanyEmailSettings>("/api/proxy/organization/email-settings", {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization", "email-settings"] }),
  });
}

export function useTestEmailConnection() {
  return useMutation({
    mutationFn: (values: {
      host: string;
      port: number;
      username: string;
      password: string;
      use_tls: boolean;
    }) =>
      fetchJson<{ detail: string }>("/api/proxy/organization/email-settings/test-connection", {
        method: "POST",
        body: JSON.stringify(values),
      }),
  });
}

export function useTestImapConnection() {
  return useMutation({
    mutationFn: (values: {
      imap_host: string;
      imap_port: number;
      username: string;
      password?: string;
      imap_use_ssl: boolean;
    }) =>
      fetchJson<{ detail: string }>("/api/proxy/organization/email-settings/test-imap", {
        method: "POST",
        body: JSON.stringify(values),
      }),
  });
}

// --- Reviews -------------------------------------------------------------

export function useReviewCycles() {
  return useQuery({
    queryKey: ["organization", "review-cycles"],
    queryFn: () =>
      fetchJson<PaginatedResponse<ReviewCycle>>("/api/proxy/organization/review-cycles?page_size=50"),
  });
}

export function useCreateReviewCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { name: string; start_date: string; end_date: string }) =>
      fetchJson<ReviewCycle>("/api/proxy/organization/review-cycles", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization", "review-cycles"] }),
  });
}

export function useStartReviewCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<{ detail: string }>(`/api/proxy/organization/review-cycles/${id}/start`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization", "review-cycles"] });
      queryClient.invalidateQueries({ queryKey: ["organization", "reviews"] });
    },
  });
}

export function useReviews(
  filters: { cycle?: number; search?: string; page?: number; pageSize?: number } = {}
) {
  // Paged and searched on the server; see `usePagedList`.
  const params = new URLSearchParams({
    page: String(filters.page ?? 1),
    page_size: String(filters.pageSize ?? 25),
  });
  if (filters.cycle) params.set("cycle", String(filters.cycle));
  if (filters.search) params.set("search", filters.search);

  return useQuery({
    queryKey: ["organization", "reviews", filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<Review>>(`/api/proxy/organization/reviews?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useSubmitSelfAssessment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, self_assessment, self_rating }: { id: number; self_assessment: string; self_rating: number }) =>
      fetchJson<Review>(`/api/proxy/organization/reviews/${id}/submit-self`, {
        method: "POST",
        body: JSON.stringify({ self_assessment, self_rating }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization", "reviews"] }),
  });
}

export function useSubmitManagerAssessment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      manager_assessment,
      manager_rating,
    }: {
      id: number;
      manager_assessment: string;
      manager_rating: number;
    }) =>
      fetchJson<Review>(`/api/proxy/organization/reviews/${id}/submit-manager`, {
        method: "POST",
        body: JSON.stringify({ manager_assessment, manager_rating }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization", "reviews"] }),
  });
}
