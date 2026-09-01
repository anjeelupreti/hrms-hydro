"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CloseIcon from "@mui/icons-material/Close";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import SendIcon from "@mui/icons-material/Send";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";

import MessageBubble from "@/components/chat/MessageBubble";
import { useMessages } from "@/hooks/useChat";
import type { CachedMessage } from "@/hooks/useChatSocket";
import type { Conversation } from "@/types/chat";

type Props = {
  conversation: Conversation;
  myUserId: number | undefined;
  typingNames: string[];
  onBack: () => void;
  onSend: (conversationId: number, body: string) => void;
  onEdit: (messageId: number, body: string) => void;
  onDelete: (messageId: number) => void;
  onTyping: (conversationId: number) => void;
  onUpload?: (file: File, body?: string) => void;
  uploading?: boolean;
  // In the narrow floating widget there's only one column, so the back
  // button must always show; on the full-width page it's mobile-only.
  showBackAlways?: boolean;
  // When set, a close (X) is shown in the header to dismiss the whole
  // floating widget (the panel docks flush to the corner, so there's no
  // separate launcher to close it).
  onClose?: () => void;
  /** Shown only in the docked panel. */
  onExpand?: () => void;
};

export default function MessageThread({
  conversation,
  myUserId,
  typingNames,
  onBack,
  onSend,
  onEdit,
  onDelete,
  onTyping,
  onUpload,
  uploading = false,
  showBackAlways = false,
  onClose,
  onExpand,
}: Props) {
  const { data: history, isLoading } = useMessages(conversation.id);
  const [draft, setDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<CachedMessage | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastTypingSent = useRef(0);

  const messages = (history?.results ?? []) as CachedMessage[];
  const isGroup = conversation.type === "group";

  // Auto-scroll to the latest message when the thread or its length changes.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, conversation.id]);

  function handleDraftChange(value: string) {
    setDraft(value);
    const now = Date.now();
    if (!editing && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      onTyping(conversation.id);
    }
  }

  function submit() {
    const body = draft.trim();
    if (editing) {
      if (!body) return;
      onEdit(editing.id, body);
      setEditing(null);
      setDraft("");
      return;
    }
    // A staged attachment is sent on submit (optionally with a caption),
    // never the instant it's picked.
    if (pendingFile && onUpload) {
      onUpload(pendingFile, body || undefined);
      setPendingFile(null);
      setDraft("");
      return;
    }
    if (!body) return;
    onSend(conversation.id, body);
    setDraft("");
  }

  function startEdit(message: CachedMessage) {
    setEditing(message);
    setDraft(message.body);
  }

  return (
    <Stack sx={{ height: "100%", flex: 1, minWidth: 0 }}>
      {/* Header */}
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ 
          alignItems: "center", 
          px: 2, 
          py: 1.5, 
          borderBottom: "1px solid", 
          borderColor: "divider",
          background: (theme) =>
            `color-mix(in srgb, ${theme.vars.palette.background.paper} 80%, transparent)`,
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <IconButton size="small" onClick={onBack} sx={{ display: { xs: "inline-flex", md: showBackAlways ? "inline-flex" : "none" } }}>
          <ArrowBackIcon />
        </IconButton>
        <Avatar sx={{ width: 40, height: 40, bgcolor: isGroup ? "secondary.main" : "primary.main" }}>
          {conversation.display_name.slice(0, 1).toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
            {conversation.display_name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {isGroup
              ? `${conversation.members.length} members`
              : conversation.type === "self"
                ? // "Direct message" under your own notes reads as a thread with
                  // somebody whose name you have forgotten.
                  "Only you can see this"
                : "Direct message"}
          </Typography>
        </Box>
        {onExpand && (
          /* A thread is where the 384px panel is most obviously too narrow —
             long messages wrap to four lines and attachments have nowhere to
             sit. This is the way out of the corner. */
          <IconButton size="small" onClick={onExpand} title="Open in full screen">
            <OpenInFullIcon fontSize="small" />
          </IconButton>
        )}
        {onClose && (
          <IconButton size="small" onClick={onClose} title="Close chat">
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>

      {/* Messages */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 2 }}>
        {isLoading ? (
          <Stack sx={{ alignItems: "center", pt: 4 }}>
            <CircularProgress size={24} />
          </Stack>
        ) : messages.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: "center", pt: 4 }}>
            No messages yet. Say hello!
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {messages.map((message, i) => (
              <MessageBubble
                key={message.id}
                message={message}
                isMine={message.sender_id === myUserId}
                showSender={isGroup && messages[i - 1]?.sender_id !== message.sender_id}
                onEdit={startEdit}
                onDelete={onDelete}
              />
            ))}
          </Stack>
        )}
        <div ref={endRef} />
      </Box>

      {/* Typing indicator */}
      <Box sx={{ height: 20, px: 2 }}>
        {typingNames.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
            {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing…
          </Typography>
        )}
      </Box>

      {/* Staged attachment (sent only on submit, not on pick) */}
      {pendingFile && (
        <Box sx={{ px: 2, pb: 0.5 }}>
          <Chip
            icon={<AttachFileIcon />}
            label={pendingFile.name}
            onDelete={() => setPendingFile(null)}
            variant="outlined"
            sx={{ maxWidth: "100%" }}
          />
        </Box>
      )}

      <Box sx={{ p: 2, pt: 1 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-end",
            borderRadius: 99, // pill — the composer, not a card
            border: "1px solid",
            borderColor: "divider",
            bgcolor: "background.default",
            p: 0.75,
            transition: "border-color 0.2s",
            "&:focus-within": { borderColor: "primary.main" },
          }}
        >
          {editing ? (
            <IconButton
              size="small"
              onClick={() => {
                setEditing(null);
                setDraft("");
              }}
              title="Cancel edit"
              sx={{ mb: 0.25 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          ) : (
            onUpload && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setPendingFile(file);
                    e.target.value = "";
                  }}
                />
                <IconButton onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach file" sx={{ mb: 0.25 }}>
                  {uploading ? <CircularProgress size={20} /> : <AttachFileIcon />}
                </IconButton>
              </>
            )
          )}
          <TextField
            fullWidth
            multiline
            maxRows={4}
            size="small"
            placeholder={editing ? "Edit message…" : pendingFile ? "Add a caption…" : "Type a message"}
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            variant="standard"
            slotProps={{ input: { disableUnderline: true, sx: { px: 1, py: 0.75 } } }}
          />
          <IconButton 
            color="primary" 
            onClick={submit} 
            disabled={!draft.trim() && !pendingFile}
            sx={{
              mb: 0.25,
              bgcolor: (draft.trim() || pendingFile) ? "primary.main" : "transparent",
              color: (draft.trim() || pendingFile) ? "#fff !important" : "text.disabled",
              "&:hover": { bgcolor: "primary.dark" },
            }}
          >
            <SendIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
    </Stack>
  );
}
