"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";

export type Signature = {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  /** Absolute, rewritten by the proxy to a path the browser can reach. */
  image_url: string | null;
  status: "pending" | "approved" | "rejected" | "superseded";
  /** Why it was turned down. Empty otherwise. */
  note: string;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
};

/** DRF's page envelope. Declared locally, like every other `types/*` file
 *  in this project does — there is no shared one to import. */
type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

const BASE = "/api/proxy/employees/signatures";

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["signatures"] });
    // A signature becoming usable changes what a memorandum prints, so the
    // letter has to be re-read rather than left showing an empty rule.
    queryClient.invalidateQueries({ queryKey: ["memoranda"] });
  };
}

/** This person's own signatures, newest first. */
export function useMySignatures() {
  return useQuery({
    queryKey: ["signatures", "mine"],
    queryFn: () => fetchJson<Signature[]>(`${BASE}/mine`),
  });
}

/**
 * Everybody's, for the approval queue.
 *
 * The endpoint scopes this itself — somebody without `people.manage` gets only
 * their own rows back, whatever they ask for — so this is safe to call from a
 * page that is merely *usually* an HR page.
 */
export function useSignatures(status?: Signature["status"]) {
  return useQuery({
    queryKey: ["signatures", "all", status ?? "any"],
    queryFn: () =>
      fetchJson<Page<Signature>>(
        `${BASE}${status ? `?status=${status}` : ""}`
      ),
  });
}

export function useUploadSignature() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (file: File) => {
      // Multipart, not JSON — an image cannot travel as JSON. `fetchJson`
      // recognises a `FormData` body and lets the browser set the boundary.
      const body = new FormData();
      body.append("image", file);
      return fetchJson<Signature>(BASE, { method: "POST", body });
    },
    onSuccess: invalidate,
  });
}

export function useDecideSignature() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      approved,
      note = "",
    }: {
      id: number;
      approved: boolean;
      note?: string;
    }) =>
      fetchJson<Signature>(`${BASE}/${id}/${approved ? "approve" : "reject"}`, {
        method: "POST",
        body: JSON.stringify({ note }),
      }),
    onSuccess: invalidate,
  });
}
