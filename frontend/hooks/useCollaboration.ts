"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";

import type { Announcement, PaginatedResponse } from "@/types/collaboration";


export function useAnnouncements(activeOnly = false, archived = false) {
  const params = new URLSearchParams({ page_size: "50" });
  if (activeOnly) params.set("active", "true");
  // The archive is hidden by default and reachable by asking — never silently
  // dropped, or somebody hunts for a notice that is sitting in it.
  if (archived) params.set("archived", "1");

  return useQuery({
    queryKey: ["announcements", activeOnly, archived],
    queryFn: () =>
      fetchJson<PaginatedResponse<Announcement>>(`/api/proxy/notifications/announcements?${params.toString()}`),
  });
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      title: string;
      body: string;
      department?: number | null;
      /** Named people, when a department is the wrong shape — the four
       *  running a shutdown are in four different departments. */
      recipients?: number[];
      /** Ask them to say they have read it. Off by default: asking a hundred
       *  people to click on every notice is how the button stops meaning
       *  anything. */
      require_acknowledgement?: boolean;
      pinned?: boolean;
      expires_at?: string | null;
    }) =>
      fetchJson<Announcement>("/api/proxy/notifications/announcements", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["announcements"] }),
  });
}

export function useDeleteAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`/api/proxy/notifications/announcements/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["announcements"] }),
  });
}


/**
 * File something away, or bring it back.
 *
 * One hook for every archivable list — announcements, checklists, surveys,
 * objectives, projects, job postings, training sessions all expose the same
 * two actions at the same shape, because they all got them from one mixin.
 * A hook per module would be seven copies of two lines and seven chances for
 * one of them to invalidate the wrong cache.
 */
export function useArchive(resource: string, queryKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      fetchJson<unknown>(
        `/api/proxy/${resource}/${id}/${archived ? "unarchive" : "archive"}`,
        { method: "POST" }
      ),
    meta: { successMessage: "Moved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [queryKey] }),
  });
}


// ── Reading a notice, and saying so ────────────────────────────────────

export type AnnouncementReceipt = {
  employee: number;
  employee_name: string;
  employee_code: string;
  seen_at: string | null;
  acknowledged_at: string | null;
};

function useAnnouncementInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["announcements"] });
}

/**
 * Record that this person opened it.
 *
 * Observed rather than asserted — called on render. Deliberately distinct from
 * acknowledging: a rendered page is not somebody having taken a safety
 * instruction in.
 */
export function useMarkAnnouncementSeen() {
  const invalidate = useAnnouncementInvalidate();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<Announcement>(`/api/proxy/notifications/announcements/${id}/seen`, {
        method: "POST",
      }),
    onSuccess: invalidate,
  });
}

export function useAcknowledgeAnnouncement() {
  const invalidate = useAnnouncementInvalidate();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<Announcement>(`/api/proxy/notifications/announcements/${id}/acknowledge`, {
        method: "POST",
      }),
    onSuccess: invalidate,
  });
}

/** Who has read it and who has not — the author's own view. */
export function useAnnouncementReceipts(id: number | null) {
  return useQuery({
    queryKey: ["announcements", id, "receipts"],
    queryFn: () =>
      fetchJson<AnnouncementReceipt[]>(`/api/proxy/notifications/announcements/${id}/receipts`),
    enabled: id !== null,
  });
}
