"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { conversationsKey, messagesKey } from "@/hooks/useChat";
import type { ChatMessage, ChatSocketEvent, Conversation, MessageHistory } from "@/types/chat";

const TYPING_TTL_MS = 4000;
const MAX_BACKOFF_MS = 15000;

/**
 * Where the chat socket lives.
 *
 * Derived from the page, never hardcoded. A fixed `ws://localhost:8000` is
 * wrong everywhere but a single-company machine: on `acme.localhost:3000` it
 * drops the company subdomain, and on a deployed host it points the browser at
 * its own machine. So:
 *
 *   - `NEXT_PUBLIC_WS_URL` always wins when set (split-host deployments).
 *   - In dev the Next dev server (3000) and Django/daphne (8000) are two
 *     processes, so keep the hostname — subdomain included — and swap ports.
 *   - Anywhere else the reverse proxy fronts both, so use the same origin
 *     and let it route `/ws/`. wss: on https, so no mixed-content block.
 */
function wsBase(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window === "undefined") return "";
  const { protocol, hostname, port } = window.location;
  const scheme = protocol === "https:" ? "wss:" : "ws:";
  const devApiPort = process.env.NEXT_PUBLIC_DEV_API_PORT ?? "8000";
  if (port === "3000") return `${scheme}//${hostname}:${devApiPort}`;
  return `${scheme}//${window.location.host}`;
}

// An optimistic (not-yet-acked) message carries the client_id so the server
// echo can replace it; `pending` drives the "sending…" affordance and
// `failed` marks one the server never accepted.
export type CachedMessage = ChatMessage & {
  clientId?: string;
  pending?: boolean;
  failed?: boolean;
};

export type SocketStatus = "connecting" | "open" | "closed";

type Options = { myUserId: number | undefined; activeConversationId: number | null };

export function useChatSocket({ myUserId, activeConversationId }: Options) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<SocketStatus>("connecting");

  // typing[convId] = { userId: name } — auto-expiring.
  const [typing, setTyping] = useState<Record<number, Record<number, string>>>({});
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Refs so the long-lived onmessage closure always sees current values
  // without needing to tear down and reopen the socket.
  const myUserIdRef = useRef(myUserId);
  const activeConvRef = useRef(activeConversationId);
  useEffect(() => {
    myUserIdRef.current = myUserId;
  }, [myUserId]);
  useEffect(() => {
    activeConvRef.current = activeConversationId;
  }, [activeConversationId]);

  const applyIncoming = useCallback(
    (event: ChatSocketEvent) => {
      const me = myUserIdRef.current;

      if (event.type === "message.new") {
        const message = event.message;
        // Merge into the message thread cache (only if it's loaded).
        queryClient.setQueryData<MessageHistory>(messagesKey(message.conversation), (old) => {
          if (!old) return old;
          if (old.results.some((m) => m.id === message.id)) return old;
          // Drop the optimistic placeholder this echo confirms.
          const results = old.results.filter(
            (m) => !(event.client_id && (m as CachedMessage).clientId === event.client_id)
          );
          return { ...old, results: [...results, message] };
        });
        // Update the conversation list (last message, unread, ordering).
        queryClient.setQueryData<Conversation[]>(conversationsKey, (old) => {
          if (!old) return old;
          const idx = old.findIndex((c) => c.id === message.conversation);
          if (idx === -1) {
            queryClient.invalidateQueries({ queryKey: conversationsKey });
            return old;
          }
          const conv = old[idx];
          const isMine = message.sender_id === me;
          const isActive = message.conversation === activeConvRef.current;
          const updated: Conversation = {
            ...conv,
            last_message: message,
            updated_at: message.created_at,
            unread_count: isMine || isActive ? conv.unread_count : conv.unread_count + 1,
          };
          return [updated, ...old.filter((_, i) => i !== idx)];
        });
        return;
      }

      if (event.type === "message.edited" || event.type === "message.deleted") {
        const message = event.message;
        queryClient.setQueryData<MessageHistory>(messagesKey(message.conversation), (old) =>
          old
            ? { ...old, results: old.results.map((m) => (m.id === message.id ? message : m)) }
            : old
        );
        queryClient.setQueryData<Conversation[]>(conversationsKey, (old) =>
          old?.map((c) =>
            c.last_message?.id === message.id ? { ...c, last_message: message } : c
          )
        );
        return;
      }

      if (event.type === "typing") {
        if (event.user_id === me) return; // ignore own typing echo
        const key = `${event.conversation}:${event.user_id}`;
        setTyping((prev) => ({
          ...prev,
          [event.conversation]: { ...prev[event.conversation], [event.user_id]: event.sender_name },
        }));
        clearTimeout(typingTimers.current[key]);
        typingTimers.current[key] = setTimeout(() => {
          setTyping((prev) => {
            const forConv = { ...prev[event.conversation] };
            delete forConv[event.user_id];
            return { ...prev, [event.conversation]: forConv };
          });
        }, TYPING_TTL_MS);
        return;
      }

      if (event.type === "conversation.new") {
        // Server already added this socket to the new group; just refresh
        // the list so it shows up.
        queryClient.invalidateQueries({ queryKey: conversationsKey });
      }
    },
    [queryClient]
  );

  // Single long-lived connection with ticket-based auth + reconnect.
  useEffect(() => {
    let shouldReconnect = true;
    let backoff = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      setStatus("connecting");
      let ticket: string;
      try {
        const res = await fetch("/api/proxy/chat/ws-ticket", { method: "POST" });
        if (!res.ok) throw new Error("ticket");
        ticket = (await res.json()).ticket;
      } catch {
        scheduleReconnect();
        return;
      }
      if (!shouldReconnect) return;

      const ws = new WebSocket(`${wsBase()}/ws/chat/?ticket=${encodeURIComponent(ticket)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        backoff = 1000;
        setStatus("open");
      };
      ws.onmessage = (e) => {
        try {
          applyIncoming(JSON.parse(e.data) as ChatSocketEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        setStatus("closed");
        if (shouldReconnect) scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    }

    function scheduleReconnect() {
      if (!shouldReconnect) return;
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }

    connect();

    return () => {
      shouldReconnect = false;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [applyIncoming]);

  // Clear any outstanding typing-expiry timers on unmount. Kept separate
  // from the socket effect so the timers map (a stable ref object) is
  // captured once at mount — its live contents are cleared at unmount.
  useEffect(() => {
    const timers = typingTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  const sendRaw = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  /** Replace an optimistic placeholder with whatever the server settled on. */
  const settleOptimistic = useCallback(
    (conversationId: number, clientId: string, message: ChatMessage | null) => {
      queryClient.setQueryData<MessageHistory>(messagesKey(conversationId), (old) => {
        if (!old) return old;
        const results = old.results.flatMap((m) => {
          if ((m as CachedMessage).clientId !== clientId) return [m];
          if (!message) return [{ ...(m as CachedMessage), pending: false, failed: true }];
          // The socket echo may have landed first; don't duplicate it.
          return old.results.some((x) => x.id === message.id) ? [] : [message];
        });
        return { ...old, results };
      });
    },
    [queryClient]
  );

  const sendMessage = useCallback(
    (conversationId: number, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      const clientId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Math.random());
      // Optimistic placeholder — reconciled/removed when the echo arrives.
      const optimistic: CachedMessage = {
        id: -Date.now(),
        conversation: conversationId,
        sender_id: myUserIdRef.current ?? -1,
        sender_name: "",
        body: trimmed,
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
        is_deleted: false,
        attachments: [],
        clientId,
        pending: true,
      };
      queryClient.setQueryData<MessageHistory>(messagesKey(conversationId), (old) =>
        old ? { ...old, results: [...old.results, optimistic] } : old
      );

      const overSocket = sendRaw({
        action: "message.send",
        conversation: conversationId,
        body: trimmed,
        client_id: clientId,
      });
      if (overSocket) return;

      // Socket down (still connecting, reconnecting, or blocked outright).
      // Post it over REST rather than leaving the message stuck as "sending".
      void fetch(`/api/proxy/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed, client_id: clientId }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          settleOptimistic(conversationId, clientId, (await res.json()) as ChatMessage);
          queryClient.invalidateQueries({ queryKey: conversationsKey });
        })
        .catch(() => settleOptimistic(conversationId, clientId, null));
    },
    [queryClient, sendRaw, settleOptimistic]
  );

  const editMessage = useCallback(
    (messageId: number, body: string) => sendRaw({ action: "message.edit", message_id: messageId, body }),
    [sendRaw]
  );
  const deleteMessage = useCallback(
    (messageId: number) => sendRaw({ action: "message.delete", message_id: messageId }),
    [sendRaw]
  );
  const sendTyping = useCallback(
    (conversationId: number) => sendRaw({ action: "typing", conversation: conversationId }),
    [sendRaw]
  );
  const markRead = useCallback(
    (conversationId: number) => {
      sendRaw({ action: "mark_read", conversation: conversationId });
      queryClient.setQueryData<Conversation[]>(conversationsKey, (old) =>
        old?.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c))
      );
    },
    [queryClient, sendRaw]
  );

  return { status, typing, sendMessage, editMessage, deleteMessage, sendTyping, markRead };
}
