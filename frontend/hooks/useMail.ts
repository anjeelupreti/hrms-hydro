"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { EmailDetail, EmailFolder, EmailListItem } from "@/types/mail";
import type { PaginatedResponse } from "@/types/collaboration";
import { apiErrorMessage } from "@/lib/apiError";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, response.status));
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const mailKey = (folder: EmailFolder) => ["mail", "messages", folder] as const;

export function useEmails(folder: EmailFolder) {
  return useQuery({
    queryKey: mailKey(folder),
    queryFn: async () => {
      const data = await fetchJson<PaginatedResponse<EmailListItem>>(
        `/api/proxy/mail/messages?folder=${folder}&page_size=100`
      );
      return data.results;
    },
  });
}

export function useEmail(id: number | null) {
  return useQuery({
    queryKey: ["mail", "message", id],
    queryFn: () => fetchJson<EmailDetail>(`/api/proxy/mail/messages/${id}`),
    enabled: id != null,
  });
}

export function useSyncInbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<{ synced: number }>("/api/proxy/mail/messages/sync", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mail"] });
    },
  });
}

export function useSendEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { to: string; subject: string; body: string; cc?: string }) =>
      fetchJson<EmailDetail>("/api/proxy/mail/messages/send", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mailKey("sent") }),
  });
}

export function useMailUnreadCount(enabled = true) {
  return useQuery({
    queryKey: ["mail", "unread-count"],
    queryFn: () => fetchJson<{ count: number }>("/api/proxy/mail/messages/unread-count"),
    enabled,
  });
}
