"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";
import type { PaginatedResponse } from "@/types/employees";
import type {
  Memorandum,
  MemorandumAction,
  MemorandumAttachment,
  MemorandumDesk,
  MemorandumFormValues,
  MemorandumListItem,
} from "@/types/memoranda";

const BASE = "/api/proxy/memoranda/memoranda";
const ACTIONS = "/api/proxy/memoranda/actions";

/** Everything that moves a memorandum touches the same three lists and the
 *  memorandum itself, so one invalidator rather than one per mutation. */
function useInvalidate() {
  const queryClient = useQueryClient();
  return (id?: number) => {
    queryClient.invalidateQueries({ queryKey: ["memoranda"] });
    if (id != null) queryClient.invalidateQueries({ queryKey: ["memorandum", id] });
  };
}

/* ── The vocabulary ──────────────────────────────────────────────────────── */

export function useMemorandumActions() {
  return useQuery({
    queryKey: ["memorandum-actions"],
    queryFn: () =>
      fetchJson<PaginatedResponse<MemorandumAction>>(`${ACTIONS}?page_size=100`),
    // Configuration, not data. It changes when somebody edits the settings
    // page, not while a memorandum is being handled.
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveMemorandumAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<MemorandumAction> }) =>
      fetchJson<MemorandumAction>(id ? `${ACTIONS}/${id}` : ACTIONS, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memorandum-actions"] }),
  });
}

export function useDeleteMemorandumAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${ACTIONS}/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memorandum-actions"] }),
  });
}

/* ── The three lists ─────────────────────────────────────────────────────── */

/**
 * What needs me, what I raised, and what I have already handled.
 *
 * One request rather than three, because the page shows all three at once and
 * three round trips would let them disagree about the same memorandum — one
 * still showing it as waiting while another has it as done.
 */
export function useMemorandumDesk() {
  return useQuery({
    queryKey: ["memoranda", "desk"],
    queryFn: () => fetchJson<MemorandumDesk>(`${BASE}/my-desk`),
  });
}

export type MemorandumFilters = {
  search?: string;
  status?: string;
  company?: number;
  page?: number;
  pageSize?: number;
};

export function useMemoranda(filters: MemorandumFilters = {}) {
  const params = new URLSearchParams();
  params.set("page", String(filters.page ?? 1));
  params.set("page_size", String(filters.pageSize ?? 50));
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.company) params.set("company", String(filters.company));
  const query = params.toString();
  return useQuery({
    queryKey: ["memoranda", "list", query],
    queryFn: () => fetchJson<PaginatedResponse<MemorandumListItem>>(`${BASE}?${query}`),
  });
}

export function useMemorandum(id: number | null) {
  return useQuery({
    queryKey: ["memorandum", id],
    queryFn: () => fetchJson<Memorandum>(`${BASE}/${id}`),
    enabled: id != null,
  });
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

export function useSaveMemorandum() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<MemorandumFormValues> }) =>
      fetchJson<Memorandum>(id ? `${BASE}/${id}` : BASE, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: (memo) => invalidate(memo.id),
  });
}

export function useDeleteMemorandum() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${BASE}/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
  });
}

/* ── Transitions ─────────────────────────────────────────────────────────── */

/**
 * Every move is a POST to a named action, never a PATCH of `status`.
 *
 * The workflow owns those fields — see `memoranda/workflow.py` — and a browser
 * that could set them would be a second way to move a memorandum, only one of
 * which writes a line in the log.
 */
function transition<TBody extends object>(path: string) {
  return function useTransition() {
    const invalidate = useInvalidate();
    return useMutation({
      mutationFn: ({ id, ...body }: { id: number } & TBody) =>
        fetchJson<Memorandum>(`${BASE}/${id}/${path}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      onSuccess: (memo) => invalidate(memo.id),
    });
  };
}

/** Takes nothing but the id — the empty object is what "no body" looks like
 *  to the generic above. */
export const useSubmitMemorandum = transition<{ /* no body */ }>("submit");
export const useProceedMemorandum = transition<{ action: number; comment?: string }>("proceed");
export const useSendBackMemorandum = transition<{
  to: number;
  action?: number | null;
  comment?: string;
}>("send-back");
export const useResubmitMemorandum = transition<{ comment?: string }>("resubmit");
/**
 * Move it past whoever is holding it.
 *
 * The initiator's release valve when a recommender is on leave or off site:
 * the chain has no timeout and the holder is the only one who can act, so
 * without this a memorandum stops dead on an empty desk. Logged as a skip, not
 * as a recommendation — see `workflow.skip`.
 */
export const useSkipMemorandum = transition<{ comment?: string }>("skip");
/**
 * Put your own signature on it, take it off, or move it.
 *
 * Three calls rather than one because they are three different acts, and the
 * middle one is a DELETE — `transition` only sends POST.
 */
export function useSignMemorandum() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, sign }: { id: number; sign: boolean }) =>
      fetchJson<Memorandum>(`${BASE}/${id}/sign`, { method: sign ? "POST" : "DELETE" }),
    onSuccess: (memo) => invalidate(memo.id),
  });
}

export function usePlaceSignature() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, x, y, page }: { id: number; x: number; y: number; page: number }) =>
      fetchJson<Memorandum>(`${BASE}/${id}/sign/place`, {
        method: "PATCH",
        body: JSON.stringify({ x, y, page }),
      }),
    onSuccess: (memo) => invalidate(memo.id),
  });
}

export const useApproveMemorandum = transition<{ comment?: string }>("approve");
export const useRejectMemorandum = transition<{ comment?: string }>("reject");
/**
 * A comment, optionally naming people and carrying files.
 *
 * Not built on `transition` because that helper sends JSON, and a file cannot
 * travel as JSON. Sent as multipart whenever there is something to upload and
 * as plain JSON otherwise, so an ordinary remark stays an ordinary request.
 */
export function useCommentOnMemorandum() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      comment,
      mentionIds = [],
      files = [],
    }: {
      id: number;
      comment: string;
      mentionIds?: number[];
      files?: File[];
    }) => {
      if (files.length === 0 && mentionIds.length === 0) {
        return fetchJson<Memorandum>(`${BASE}/${id}/comment`, {
          method: "POST",
          body: JSON.stringify({ comment }),
        });
      }
      const form = new FormData();
      form.append("comment", comment);
      for (const employeeId of mentionIds) form.append("mention_ids", String(employeeId));
      for (const file of files) form.append("files", file);
      return fetchJson<Memorandum>(`${BASE}/${id}/comment`, { method: "POST", body: form });
    },
    onSuccess: (memo) => invalidate(memo.id),
  });
}

/* ── Attachments ─────────────────────────────────────────────────────────── */

export function useAddMemorandumAttachment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, file, caption }: { id: number; file: File; caption: string }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", caption);
      return fetchJson<MemorandumAttachment>(`${BASE}/${id}/attachments`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (_row, variables) => invalidate(variables.id),
  });
}

export function useRemoveMemorandumAttachment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, attachmentId }: { id: number; attachmentId: number }) =>
      fetchJson<void>(`${BASE}/${id}/attachments/${attachmentId}`, { method: "DELETE" }),
    onSuccess: (_row, variables) => invalidate(variables.id),
  });
}
