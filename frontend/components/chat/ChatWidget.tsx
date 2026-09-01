"use client";

import ChatBubbleIcon from "@mui/icons-material/ChatBubble";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Fab from "@mui/material/Fab";
import Grow from "@mui/material/Grow";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useState } from "react";

import ConversationList from "@/components/chat/ConversationList";
import MessageThread from "@/components/chat/MessageThread";
import NewConversationDialog from "@/components/chat/NewConversationDialog";
import { useConversations, useUploadAttachment } from "@/hooks/useChat";
import { useChatSocket } from "@/hooks/useChatSocket";
import { useMe } from "@/hooks/useMe";
import { useUIStore } from "@/lib/store/ui";

// Messenger-style floating chat: a FAB bottom-right that toggles a compact
// panel. Mounted once globally (AppShellLayout), so the WebSocket lives for
// the whole session and the unread badge stays live on every page — not
// only while a /chat route is open. Open state + selected conversation live
// in the UI store so the right-rail avatars can open a DM directly.
export default function ChatWidget() {
  const { data: me } = useMe();
  const { data: conversations } = useConversations();
  const open = useUIStore((s) => s.chatOpen);
  const setChatOpen = useUIStore((s) => s.setChatOpen);
  const selectedId = useUIStore((s) => s.chatSelectedId);
  const setChatSelectedId = useUIStore((s) => s.setChatSelectedId);
  const openChatConversation = useUIStore((s) => s.openChatConversation);
  const uploadAttachment = useUploadAttachment();
  const [dialogOpen, setDialogOpen] = useState(false);
  const router = useRouter();

  const socket = useChatSocket({ myUserId: me?.id, activeConversationId: open ? selectedId : null });

  const totalUnread = (conversations ?? []).reduce((sum, c) => sum + c.unread_count, 0);
  const selected = conversations?.find((c) => c.id === selectedId) ?? null;
  const typingForSelected = selectedId ? Object.values(socket.typing[selectedId] ?? {}) : [];

  /** Out of the corner and onto the page, keeping the conversation you were in.
   *  The selection lives in the shared UI store, so nothing has to be handed
   *  over — closing the panel is only tidying up behind you. */
  function expand() {
    setChatOpen(false);
    router.push("/messages");
  }

  function openConversation(id: number) {
    openChatConversation(id);
    socket.markRead(id);
  }

  return (
    <>
      <Grow in={open} style={{ transformOrigin: "bottom right" }}>
        <Paper
          elevation={12}
          sx={{
            position: "fixed",
            // Docked flush to the corner — no gap above a launcher, so it
            // reads as an anchored panel rather than something floating high.
            bottom: { xs: 0, sm: 24 },
            right: { xs: 0, sm: 24 },
            left: { xs: 0, sm: "auto" },
            top: { xs: 0, sm: "auto" },
            width: { xs: "100%", sm: 384 },
            height: { xs: "100dvh", sm: 620 },
            maxHeight: { sm: "calc(100dvh - 48px)" },
            zIndex: 1300,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRadius: { xs: 0, sm: 3 },
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
              onUpload={(file, body) => uploadAttachment.mutate({ conversationId: selected.id, file, body })}
              uploading={uploadAttachment.isPending}
              showBackAlways
              onExpand={expand}
              onClose={() => setChatOpen(false)}
            />
          ) : (
            <ConversationList
              conversations={conversations ?? []}
              selectedId={selectedId}
              onSelect={openConversation}
              onNew={() => setDialogOpen(true)}
              onExpand={expand}
              onClose={() => setChatOpen(false)}
            />
          )}
          {socket.status !== "open" && (
            <Box sx={{ px: 2, py: 0.5, bgcolor: "warning.light" }}>
              <Typography variant="caption">
                {socket.status === "connecting" ? "Connecting…" : "Reconnecting…"}
              </Typography>
            </Box>
          )}
        </Paper>
      </Grow>

      {/* Only the launcher floats. When the panel is open it docks to the
          corner and is dismissed from its own header, so the FAB hides. */}
      <Grow in={!open} style={{ transformOrigin: "bottom right" }} unmountOnExit>
        {/* The button earns its prominence. A 56px accent disc fixed to the
            corner covers whatever scrolls under it, at the same weight whether
            or not it has anything to say — and bottom padding cannot fix that,
            because it protects the end of a page rather than the middle of one
            being scrolled.

            With nothing waiting it is
            smaller, quiet, and sits back until you go near it; the moment
            somebody messages you it fills with the accent and says how many.
            The sidebar's Messages entry and the full page are the routes that
            do not float over anything, which is what lets this one recede. */}
        <Fab
          size={totalUnread > 0 ? "large" : "medium"}
          color="primary"
          onClick={() => setChatOpen(true)}
          className="no-print"
          sx={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 1301,
            // **Quiet, but still this system's colour.** The quiet state used
            // to be `color="default"`, which is MUI's grey — so the one control
            // floating over every page was the one control that ignored the
            // accent the system had chosen. Receding and being grey are not
            // the same thing: it recedes now by sitting on the page surface with
            // a tinted outline and the accent only in the icon, and fills with
            // the accent the moment somebody messages you.
            ...(totalUnread > 0
              ? {}
              : {
                  bgcolor: "background.paper",
                  color: "primary.main",
                  border: "1px solid",
                  borderColor: "primary.main",
                  "&:hover": { bgcolor: "primary.main", color: "primary.contrastText" },
                }),
            // Not `opacity`: the `Grow` above writes an inline opacity to
            // animate the launcher in, and an inline style beats anything sx
            // emits — the rule was silently doing nothing. Weight is carried by
            // the shadow and the surface instead, which the transition does not
            // own.
            boxShadow: totalUnread > 0 ? 6 : 1,
            transition: "box-shadow 160ms, background-color 160ms, color 160ms",
            "&:focus-visible": { boxShadow: 6 },
            "&:hover": { boxShadow: 6 },
          }}
          aria-label={totalUnread > 0 ? `Chat — ${totalUnread} unread` : "Chat"}
        >
          <Badge badgeContent={totalUnread} color="error">
            <ChatBubbleIcon fontSize={totalUnread > 0 ? "medium" : "small"} />
          </Badge>
        </Fab>
      </Grow>

      <NewConversationDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={openConversation} />
    </>
  );
}
