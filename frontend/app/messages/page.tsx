"use client";

import ForumIcon from "@mui/icons-material/Forum";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import ConversationList from "@/components/chat/ConversationList";
import MessageThread from "@/components/chat/MessageThread";
import NewConversationDialog from "@/components/chat/NewConversationDialog";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useChatSocket } from "@/hooks/useChatSocket";
import { useConversations, useUploadAttachment } from "@/hooks/useChat";
import { useMe } from "@/hooks/useMe";
import { useUIStore } from "@/lib/store/ui";

/**
 * Messages, with room to read them.
 *
 * The full-page counterpart to the docked chat panel. A 384px corner panel is
 * the right shape for a quick reply while you are doing something else, and the
 * wrong one for everything else somebody does with a conversation — reading
 * back through a thread, looking at an attachment, working through a morning's
 * messages.
 *
 * **Both panes at once, which the widget cannot do.** In 384px the list and the
 * thread have to take turns — opening a conversation replaces the list, and
 * going back loses your place in the thread. With the width to show both, the
 * list stays put and switching threads costs nothing, which is what makes
 * working through a queue of them possible at all.
 *
 * **The same components, the same socket, the same selection.** The list, the
 * thread and the new-conversation dialog are the widget's own; the selected
 * conversation lives in the shared UI store. So opening the panel, expanding to
 * here, and going back leaves you in the same conversation rather than at the
 * top of the list — and a message read in one place is read in the other,
 * because there is only one socket and one cache behind both.
 */
export default function MessagesPage() {
  const { data: me } = useMe();
  const { data: conversations } = useConversations();
  const selectedId = useUIStore((s) => s.chatSelectedId);
  const setChatSelectedId = useUIStore((s) => s.setChatSelectedId);
  const uploadAttachment = useUploadAttachment();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Always the active conversation here — unlike the widget, which passes null
  // while it is closed. This page being open *is* the chat being open.
  const socket = useChatSocket({ myUserId: me?.id, activeConversationId: selectedId });

  const selected = conversations?.find((c) => c.id === selectedId) ?? null;
  const typingForSelected = selectedId ? Object.values(socket.typing[selectedId] ?? {}) : [];

  function openConversation(id: number) {
    setChatSelectedId(id);
    socket.markRead(id);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Messages"
        subtitle="Conversations with your colleagues"
        icon={<ForumIcon />}
      />

      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          // Fills what is left of the window rather than growing with the
          // thread: a conversation scrolls inside its own pane, and a page that
          // grew instead would put the composer below the fold on a long one.
          height: "calc(100dvh - 260px)",
          minHeight: 460,
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            width: { xs: "100%", md: 340 },
            flexShrink: 0,
            borderRight: { md: "1px solid" },
            borderColor: { md: "divider" },
            // On a narrow screen the two panes take turns, the way the panel
            // does — there is no width to show both, and a 160px list column
            // would be worse than switching.
            display: { xs: selected ? "none" : "flex", md: "flex" },
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <ConversationList
            conversations={conversations ?? []}
            selectedId={selectedId}
            onSelect={openConversation}
            onNew={() => setDialogOpen(true)}
            title="Conversations"
          />
        </Box>

        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: { xs: selected ? "flex" : "none", md: "flex" },
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {selected ? (
            <MessageThread
              key={selected.id}
              conversation={selected}
              myUserId={me?.id}
              typingNames={typingForSelected}
              onBack={() => setChatSelectedId(null)}
              onSend={socket.sendMessage}
              onEdit={socket.editMessage}
              onDelete={socket.deleteMessage}
              onTyping={socket.sendTyping}
              onUpload={(file, body) =>
                uploadAttachment.mutate({ conversationId: selected.id, file, body })
              }
              uploading={uploadAttachment.isPending}
            />
          ) : (
            // Not an error and not a loading state — nothing is wrong, a
            // conversation simply has not been picked yet.
            <Box
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                px: 4,
                textAlign: "center",
              }}
            >
              <ForumIcon sx={{ fontSize: 40, color: "text.disabled" }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Pick a conversation
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "36ch" }}>
                {conversations && conversations.length === 0
                  ? "You have not spoken to anybody yet. Start one with the button above the list."
                  : "Choose someone on the left, or start a new conversation."}
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>

      {socket.status !== "open" && (
        <Typography variant="caption" color="warning.main" sx={{ mt: 1, display: "block" }}>
          {socket.status === "connecting" ? "Connecting…" : "Reconnecting…"}
        </Typography>
      )}

      <NewConversationDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={openConversation}
      />
    </PageContainer>
  );
}
