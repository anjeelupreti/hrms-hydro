"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedResponse, RepositoryDocument } from "@/types/documents";


export function useRepositoryDocuments(filters: { category?: string; visibility?: string } = {}) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.category) params.set("category", filters.category);
  if (filters.visibility) params.set("visibility", filters.visibility);
  return useQuery({
    queryKey: ["documents", filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<RepositoryDocument>>(`/api/proxy/documents/repository?${params.toString()}`),
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) =>
      fetchJson<RepositoryDocument>("/api/proxy/documents/repository", { method: "POST", body: form }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`/api/proxy/documents/repository/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
}

// --- E-signature (documents/signatures + repository/<id>/request-signatures) ---
import type { MySignature, SignatureRequest } from "@/types/documents";
import { fetchJson } from "@/lib/query/fetchJson";

export function useMySignatures() {
  return useQuery({
    queryKey: ["signatures", "mine"],
    queryFn: () => fetchJson<PaginatedResponse<MySignature>>("/api/proxy/documents/signatures"),
  });
}

export function useDocumentSignatures(documentId: number | null) {
  return useQuery({
    queryKey: ["signatures", "doc", documentId],
    queryFn: () => fetchJson<SignatureRequest[]>(`/api/proxy/documents/repository/${documentId}/signatures/`),
    enabled: documentId != null,
  });
}

export function useRequestSignatures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, signer_ids, message }: { documentId: number; signer_ids: number[]; message?: string }) =>
      fetchJson<SignatureRequest>(`/api/proxy/documents/repository/${documentId}/request-signatures/`, {
        method: "POST",
        body: JSON.stringify({ signer_ids, message }),
      }),
    meta: { successMessage: "Signature request sent" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signatures"] }),
  });
}

export function useSignDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, signed_name }: { id: number; signed_name: string }) =>
      fetchJson<MySignature>(`/api/proxy/documents/signatures/${id}/sign/`, {
        method: "POST",
        body: JSON.stringify({ signed_name }),
      }),
    meta: { successMessage: "Signed" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signatures"] }),
  });
}

export function useDeclineSignature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      fetchJson<MySignature>(`/api/proxy/documents/signatures/${id}/decline/`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    meta: { successMessage: "Declined" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signatures"] }),
  });
}
