"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Notification, NotificationPreference, PaginatedResponse } from "@/types/notifications";
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

export function useNotifications(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ["notifications", page, pageSize],
    queryFn: () =>
      fetchJson<PaginatedResponse<Notification>>(
        `/api/proxy/notifications?page=${page}&page_size=${pageSize}`
      ),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => fetchJson<{ count: number }>("/api/proxy/notifications/unread-count"),
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<Notification>(`/api/proxy/notifications/${id}/mark-read`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<void>("/api/proxy/notifications/mark-all-read", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => fetchJson<NotificationPreference>("/api/proxy/notifications/preferences"),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<NotificationPreference>) =>
      fetchJson<NotificationPreference>("/api/proxy/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
}

// --- Reminder rules --------------------------------------------------------

export type ReminderRule = {
  id: number;
  /** Registry key. Read-only — repointing it would aim a configured message at
   *  a different query and quietly change who receives it. */
  kind: string;
  label: string;
  description: string;
  /** Placeholders this kind offers. Served from the registry, not stored, so
   *  the screen cannot describe a kind wrongly. */
  variables: string[];
  is_enabled: boolean;
  lead_days: number[];
  subject: string;
  body: string;
};

export type ReminderPreview = {
  kind: string;
  lead_days: number;
  to: string;
  subject: string;
  body: string;
};

export function useReminderRules() {
  return useQuery({
    queryKey: ["reminder-rules"],
    queryFn: () =>
      fetchJson<PaginatedResponse<ReminderRule>>("/api/proxy/notifications/reminder-rules"),
  });
}

export function useUpdateReminderRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<ReminderRule> }) =>
      fetchJson<ReminderRule>(`/api/proxy/notifications/reminder-rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reminder-rules"] }),
  });
}

/**
 * What would go out today, rendered against real data, sending nothing.
 *
 * `enabled: false` by default — this resolves every rule against the whole
 * employee table, so it runs when somebody asks for it rather than on page
 * load.
 */
export function useReminderPreview(enabled: boolean) {
  return useQuery({
    queryKey: ["reminder-rules", "preview"],
    queryFn: () =>
      fetchJson<ReminderPreview[]>("/api/proxy/notifications/reminder-rules/preview"),
    enabled,
    staleTime: 0,
  });
}
