"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";

/**
 * The correspondence register — the chalani and darta books.
 *
 * Separate from `useMail`, which reads the synced mailbox. A register entry is
 * not a message: it has a reference the office assigned, a company, people to
 * notify inside, and it exists whether or not an email was ever sent.
 */

export type LetterAttachment = {
  id: number;
  file_url: string;
  filename: string;
  caption: string;
  uploaded_at: string;
};

export type OutgoingLetter = {
  id: number;
  ref: string;
  company: number | null;
  company_name: string | null;
  letter_date: string;
  subject: string;
  body: string;
  addressed_to: string;
  recipients: string[];
  cc: string[];
  /** `draft` until sent. `not_emailed` is a letter that went by hand — a
   *  record, not a failure. `failed` carries `error` and can be sent again. */
  status: "draft" | "sent" | "failed" | "not_emailed";
  sent_at: string | null;
  error: string;
  attachments: LetterAttachment[];
  reply_count: number;
  created_at: string;
};

export type IncomingLetter = {
  id: number;
  ref: string;
  company: number | null;
  company_name: string | null;
  /** The date on the letter, which is not the date it arrived. */
  letter_date: string | null;
  received_on: string;
  received_via: "post" | "email" | "hand" | "other";
  subject: string;
  from_office: string;
  from_person: string;
  from_email: string;
  notify: number[];
  notify_names: { id: number; name: string; employee_code: string }[];
  note: string;
  in_reply_to: number | null;
  in_reply_to_ref: string | null;
  attachments: LetterAttachment[];
  created_at: string;
};

type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

const OUT = "/api/proxy/mail/outgoing";
const IN = "/api/proxy/mail/incoming";

function useInvalidate(key: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [key] });
}

function listParams(filters: { search?: string; company?: number | null; status?: string }) {
  const query = new URLSearchParams({ page_size: "100" });
  if (filters.search) query.set("search", filters.search);
  if (filters.company) query.set("company", String(filters.company));
  if (filters.status) query.set("status", filters.status);
  return query.toString();
}

// ── Outgoing ───────────────────────────────────────────────────────────

export function useOutgoingLetters(filters: { search?: string; company?: number | null; status?: string } = {}) {
  const suffix = listParams(filters);
  return useQuery({
    queryKey: ["outgoing-letters", suffix],
    queryFn: () => fetchJson<Page<OutgoingLetter>>(`${OUT}?${suffix}`),
  });
}

/**
 * A suggestion, not an allocation — nothing is reserved.
 *
 * Two people opening the form at once are offered the same number and the
 * second is told it is taken, which is exactly what the paper register does.
 */
export function useNextOutgoingRef(company: number | null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["outgoing-letters", "next-ref", company],
    queryFn: () =>
      fetchJson<{ suggestion: string }>(`${OUT}/next-ref${company ? `?company=${company}` : ""}`),
  });
}

export function useSaveOutgoingLetter() {
  const invalidate = useInvalidate("outgoing-letters");
  return useMutation({
    mutationFn: ({ id, values }: { id: number | null; values: Partial<OutgoingLetter> }) =>
      fetchJson<OutgoingLetter>(id ? `${OUT}/${id}/` : `${OUT}/`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: invalidate,
  });
}

/**
 * Post it.
 *
 * Separate from saving because attachments need a row to belong to, and
 * because a letter going by hand belongs in the register without anybody
 * pretending an email was tried.
 */
export function useSendOutgoingLetter() {
  const invalidate = useInvalidate("outgoing-letters");
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<OutgoingLetter>(`${OUT}/${id}/send/`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

/**
 * Discard a draft that was never sent.
 *
 * **Drafts only, and nothing else in either register.** A register you can
 * delete rows from is not a register — that is the whole reason the office
 * keeps one. But a letter typed by mistake and never posted is not a record of
 * anything, and leaving it would block its reference number for good.
 */
export function useDeleteOutgoingLetter() {
  const invalidate = useInvalidate("outgoing-letters");
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${OUT}/${id}/`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

// ── Incoming ───────────────────────────────────────────────────────────

export function useIncomingLetters(filters: { search?: string; company?: number | null } = {}) {
  const suffix = listParams(filters);
  return useQuery({
    queryKey: ["incoming-letters", suffix],
    queryFn: () => fetchJson<Page<IncomingLetter>>(`${IN}?${suffix}`),
  });
}

export function useNextIncomingRef(company: number | null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["incoming-letters", "next-ref", company],
    queryFn: () =>
      fetchJson<{ suggestion: string }>(`${IN}/next-ref${company ? `?company=${company}` : ""}`),
  });
}

export function useSaveIncomingLetter() {
  const invalidate = useInvalidate("incoming-letters");
  return useMutation({
    mutationFn: ({ id, values }: { id: number | null; values: Partial<IncomingLetter> }) =>
      fetchJson<IncomingLetter>(id ? `${IN}/${id}/` : `${IN}/`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: invalidate,
  });
}

// ── Attachments, either direction ──────────────────────────────────────

export function useAddLetterAttachment(direction: "outgoing" | "incoming") {
  const invalidate = useInvalidate(`${direction}-letters`);
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return fetchJson<LetterAttachment>(
        `${direction === "outgoing" ? OUT : IN}/${id}/attachments/`,
        { method: "POST", body: form }
      );
    },
    onSuccess: invalidate,
  });
}

export function useRemoveLetterAttachment(direction: "outgoing" | "incoming") {
  const invalidate = useInvalidate(`${direction}-letters`);
  return useMutation({
    mutationFn: ({ id, attachmentId }: { id: number; attachmentId: number }) =>
      fetchJson<void>(
        `${direction === "outgoing" ? OUT : IN}/${id}/attachments/${attachmentId}/`,
        { method: "DELETE" }
      ),
    onSuccess: invalidate,
  });
}
