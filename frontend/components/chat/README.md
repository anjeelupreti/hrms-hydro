# Chat UI

In-app messaging. Pairs with `hooks/useChat.ts`, `hooks/useChatSocket.ts`,
`types/chat.ts`, and the backend [`chat`](../../../backend/chat/README.md)
app (REST for history + a websocket for live delivery).

- **`ChatWidget.tsx`** — the dockable chat surface (opened from the shell);
  holds the selected-conversation state and composes the list + thread.
- **`ConversationList.tsx`** — conversations with a last-message preview.
  Attachment-only messages (empty body) render as `📎 Photo` / `📎 Attachment`
  rather than a blank line; unread counts as a badge.
- **`MessageThread.tsx`** — the open conversation: message history, a
  glassmorphism header, and the composer (text + file attach). Reconciles
  optimistic/pending messages from the socket cache.
- **`MessageBubble.tsx`** — one message. WhatsApp-style asymmetric radius
  ("tail"), inline image thumbnails and file chips for attachments,
  edited/sending states, and an owner-only edit/delete menu.
- **`NewConversationDialog.tsx`** — start a DM or group by picking members.

## Notes

- `last_message.attachments` is the source for the preview fallback — the
  backend sends `{id, filename, content_type}` per attachment, so the list
  can say "Photo" vs "Attachment" without fetching the file.
- Live updates come through `useChatSocket` (a `CachedMessage` cache);
  `useChat` owns REST history and mutations. Don't duplicate socket state
  into TanStack Query — the socket cache is the live source.
