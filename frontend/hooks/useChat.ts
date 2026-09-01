"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ChatParticipant, Conversation, MessageHistory } from "@/types/chat";
import type { PaginatedResponse } from "@/types/collaboration";
import { apiErrorMessage } from "@/lib/apiError";

export const conversationsKey = ["chat", "conversations"] as const;
export const messagesKey = (conversationId: number) => ["chat", "messages", conversationId] as const;

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

export function useConversations() {
  return useQuery({
    queryKey: conversationsKey,
    queryFn: async () => {
      // Two calls, because the notes thread has to exist before it can be
      // listed. `saved` is a get-or-create, so asking for it is what brings it
      // into being on somebody's first visit — and doing that here means every
      // surface that shows conversations (the panel, the full page, the unread
      // badge) gets it, rather than only whichever one remembered to ask.
      const [data, saved] = await Promise.all([
        fetchJson<PaginatedResponse<Conversation>>("/api/proxy/chat/conversations?page_size=100"),
        // A failure here must not take the whole list down with it: not being
        // able to make a scratchpad is no reason to hide somebody's messages.
        fetchJson<Conversation>("/api/proxy/chat/conversations/saved").catch(() => null),
      ]);

      const rest = data.results.filter((conv) => conv.type !== "self");
      // Pinned to the top rather than sorted by recency. It is a fixed place
      // you go, and a fixed place that moves around the list is not one.
      return saved ? [saved, ...rest] : data.results;
    },
  });
}

/**
 * The caller's own notes thread on its own, for surfaces that want just that.
 *
 * The system card needs the thread without pulling every conversation in the
 * workspace to find it, and `useConversations` is the wrong shape for a card
 * that shows one thing.
 */
export function useSavedThread() {
  return useQuery({
    queryKey: ["chat", "saved"],
    queryFn: () => fetchJson<Conversation>("/api/proxy/chat/conversations/saved"),
  });
}

/**
 * Post a note over REST rather than the socket.
 *
 * The chat UI sends through the WebSocket because it wants echo, typing and
 * ordering against other people's messages. A note to yourself has none of
 * those problems — there is nobody else in the room — so the card does not
 * need a live socket open to accept a line of text.
 */
export function useSendNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, body }: { conversationId: number; body: string }) =>
      fetchJson<unknown>(`/api/proxy/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: (_data, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: messagesKey(conversationId) });
      queryClient.invalidateQueries({ queryKey: conversationsKey });
    },
  });
}

export function useParticipants(enabled = true) {
  return useQuery({
    queryKey: ["chat", "participants"],
    queryFn: () => fetchJson<ChatParticipant[]>("/api/proxy/chat/participants"),
    enabled,
  });
}

export function useMessages(conversationId: number | null) {
  return useQuery({
    queryKey: conversationId ? messagesKey(conversationId) : ["chat", "messages", "none"],
    queryFn: () => fetchJson<MessageHistory>(`/api/proxy/chat/conversations/${conversationId}/messages`),
    enabled: conversationId != null,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { type: "dm" | "group"; member_ids: number[]; name?: string }) =>
      fetchJson<Conversation>("/api/proxy/chat/conversations", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationsKey }),
  });
}

export function useUploadAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    // Multipart upload; the created message is broadcast back over the
    // socket, so we don't need to touch the message cache here.
    mutationFn: async ({ conversationId, file, body }: { conversationId: number; file: File; body?: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (body) form.append("body", body);
      const res = await fetch(`/api/proxy/chat/conversations/${conversationId}/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationsKey }),
  });
}

/** REST fallback for marking a conversation read (the socket also supports
 * a mark_read action; this is used on open in case the socket isn't up). */
export function useMarkReadRest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: number) =>
      fetchJson<void>(`/api/proxy/chat/conversations/${conversationId}/mark-read`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationsKey }),
  });
}
