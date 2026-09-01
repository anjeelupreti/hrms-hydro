"use client";

import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";

import CardEmpty from "@/components/dashboard/CardEmpty";

import { compactCard } from "@/lib/theme/cards";
import SendIcon from "@mui/icons-material/Send";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import { useMessages, useSavedThread, useSendNote } from "@/hooks/useChat";

/**
 * Notes to yourself, as messages.
 *
 * **A note is a message you send to yourself, so it is stored as one.** The
 * alternative was a `Note` model with a title, a body and an editor — a second
 * place to type things, with its own search, its own attachments and its own
 * empty state, sitting next to a chat system that already had all three. Every
 * messenger that grew a notes feature arrived at the same answer: a thread with
 * one member in it.
 *
 * What that buys, for no extra code: attachments, search across the message
 * history, the socket, and links that render. What it costs is that a note
 * cannot be edited into a different note — which is honest, because that is how
 * a scratchpad behaves anyway.
 *
 * **Newest first here, oldest first in the thread.** A card showing three lines
 * is a glance at what you last wrote down; the thread is a conversation and
 * reads forwards. Same data, and the reading order follows the job.
 */

export default function NotesCard() {
  const { data: thread, isLoading: threadLoading } = useSavedThread();
  const { data: history, isLoading: messagesLoading } = useMessages(thread?.id ?? null);
  const send = useSendNote();
  const [draft, setDraft] = useState("");

  function submit() {
    const body = draft.trim();
    if (!body || !thread) return;
    send.mutate({ conversationId: thread.id, body });
    setDraft("");
  }

  // The endpoint queries newest-first and then reverses, so what arrives is
  // *chronological* — the newest note is the last element. Reading it as
  // newest-first would have pinned the four oldest notes to this card forever,
  // and it would have looked plausible the whole time.
  const notes = (history?.results ?? [])
    .filter((m) => !m.is_deleted)
    .slice(-4)
    .reverse();

  return (
    <Card sx={compactCard}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <BookmarkBorderIcon sx={{ fontSize: 17, color: "text.secondary" }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              My notes
            </Typography>
          </Stack>
          {thread ? (
            <Box
              component={Link}
              href="/messages"
              sx={{ fontSize: 13, fontWeight: 650, color: "primary.main", textDecoration: "none" }}
            >
              Open thread
            </Box>
          ) : null}
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          A note to yourself. It lands in your own chat thread — only you can see it.
        </Typography>

        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            alignItems: "center",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1.5,
            px: 1.25,
            py: 0.25,
            mb: 1.5,
          }}
        >
          <InputBase
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Note to self…"
            disabled={threadLoading || !thread}
            multiline
            maxRows={4}
            sx={{ flexGrow: 1, fontSize: 14 }}
            inputProps={{ "aria-label": "Write a note to yourself" }}
          />
          <IconButton size="small" onClick={submit} disabled={!draft.trim() || !thread} aria-label="Save note">
            <SendIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Stack>

        {threadLoading || messagesLoading ? (
          <Skeleton variant="rounded" height={90} />
        ) : notes.length === 0 ? (
          <CardEmpty>Nothing saved yet.</CardEmpty>
        ) : (
          <Stack spacing={1}>
            {notes.map((note) => (
              <Box
                key={note.id}
                sx={{
                  bgcolor: "action.hover",
                  borderRadius: 1.5,
                  px: 1.5,
                  py: 1,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    // A note keeps the line breaks it was written with — a
                    // pasted address collapsed into one line is not the note
                    // that was saved.
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {note.body}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(note.created_at).toLocaleString(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
