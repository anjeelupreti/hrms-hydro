"use client";

import AddIcon from "@mui/icons-material/Add";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import CloseIcon from "@mui/icons-material/Close";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import PersonAvatar from "@/components/common/PersonAvatar";
import SearchField from "@/components/common/SearchField";
import { useCreateConversation, useParticipants } from "@/hooks/useChat";
import { useMe } from "@/hooks/useMe";
import { useTextFilter } from "@/hooks/useTextFilter";
import type { ChatParticipant, Conversation } from "@/types/chat";

type Props = {
  conversations: Conversation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onClose?: () => void;
  /** Shown only in the docked panel — the full-page view has nowhere to expand to. */
  onExpand?: () => void;
  /** Defaults to "Chat" for the docked panel; the full page passes its own. */
  title?: string;
};

function preview(conv: Conversation) {
  const last = conv.last_message;
  if (!last) return "No messages yet";
  if (last.is_deleted) return "Message deleted";
  if (last.body?.trim()) return last.body;
  // Attachment-only message (no text body) — describe what was sent instead
  // of rendering a blank preview row. The noun carries it on its own: this is
  // a plain-text row, so a paperclip here would have to be an emoji, and an
  // emoji renders differently on every platform the product runs on.
  const atts = last.attachments ?? [];
  if (atts.length > 0) {
    const isImage = atts.every((a) => a.content_type?.startsWith("image/"));
    const noun = isImage ? "Photo" : "Attachment";
    return atts.length > 1 ? `${atts.length} ${noun.toLowerCase()}s` : noun;
  }
  return "";
}

export default function ConversationList({ conversations, selectedId, onSelect, onNew, onClose, onExpand, title = "Chat" }: Props) {
  const { data: me } = useMe();
  const { data: participants } = useParticipants();
  const createConversation = useCreateConversation();

  /**
   * Colleagues you have never messaged, listed below the threads that exist.
   *
   * Without this the panel opens empty on a new account and says "start one
   * with the + button" — so the first thing chat asks of somebody is that they
   * find a dialog, then find a name inside it. The people are already known;
   * showing them costs nothing and makes the first message a single click.
   *
   * Anyone already in a one-to-one thread is excluded — they are above, with
   * their history — and so are you, because your own notes thread is a
   * separate row that already exists.
   */
  const alreadyTalking = new Set(
    conversations
      .filter((c) => c.type === "dm")
      .flatMap((c) => c.members.map((m) => m.user_id))
  );
  const notYetTalking = (participants ?? []).filter(
    (p) => p.user_id !== me?.id && !alreadyTalking.has(p.user_id)
  );

  async function startWith(person: ChatParticipant) {
    // If two clicks race, or a thread was created elsewhere, the server
    // returns the existing one rather than a duplicate.
    const conv = await createConversation.mutateAsync({
      type: "dm",
      member_ids: [person.user_id],
    });
    onSelect(conv.id);
  }

  // Matches the person/group you're looking for *and* what was last said, so
  // "the thread about payroll" is findable without scrolling the whole list.
  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(conversations, (c) => [
    c.display_name,
    c.last_message?.body,
    ...c.members.map((m) => m.name),
  ]);

  // The same query narrows the directory rows, so typing a name finds the
  // person whether or not you have ever messaged them.
  const needle = query.trim().toLowerCase();
  const directory = needle
    ? notYetTalking.filter((p) => p.name.toLowerCase().includes(needle))
    : notYetTalking;

  return (
    <Stack sx={{ height: "100%" }}>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: "center", justifyContent: "space-between", px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}
      >
        {/* Titled only where nothing else is saying it. On the full-page view
            the page header already reads "Messages", and a second heading
            underneath it that says "Chat" reads as a different feature. */}
        <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>
          {title}
        </Typography>
        <IconButton color="primary" onClick={onNew} title="New conversation">
          <AddIcon />
        </IconButton>
        {onExpand && (
          /* The panel is 384px wide and a conversation is a thing people
             actually read. This is the way out of the corner. */
          <IconButton onClick={onExpand} title="Open in full screen">
            <OpenInFullIcon fontSize="small" />
          </IconButton>
        )}
        {onClose && (
          <IconButton onClick={onClose} title="Close">
            <CloseIcon />
          </IconButton>
        )}
      </Stack>

      {conversations.length > 0 && (
        <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search conversations…"
            label="Search conversations by name or message"
            sx={{ width: "100%" }}
          />
        </Box>
      )}

      <Box sx={{ flex: 1, overflowY: "auto" }}>
        {filtered.length === 0 && directory.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 2 }}>
            {isEmptyResult
              ? `Nobody matches “${query}”.`
              : "No conversations yet, and nobody else in the system."}
          </Typography>
        ) : (
          filtered.map((conv) => {
            const isSelected = conv.id === selectedId;
            return (
              <ButtonBase
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                sx={{
                  width: "100%",
                  display: "flex",
                  gap: 1.5,
                  alignItems: "center",
                  px: 2,
                  py: 1.5,
                  textAlign: "left",
                  bgcolor: isSelected ? "action.selected" : "transparent",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                {/* The notes thread is a place, not a person, so it gets an
                    icon rather than an initial. "Y" in a circle would read as
                    somebody in the system whose name begins with Y. */}
                <Avatar
                  sx={{
                    bgcolor:
                      conv.type === "self"
                        ? "action.selected"
                        : conv.type === "group"
                          ? "secondary.main"
                          : "primary.main",
                    color: conv.type === "self" ? "text.secondary" : undefined,
                  }}
                >
                  {conv.type === "self" ? (
                    <BookmarkBorderIcon fontSize="small" />
                  ) : (
                    conv.display_name.slice(0, 1).toUpperCase()
                  )}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                    {conv.display_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                    {conv.type === "self" && !conv.last_message
                      ? "Message yourself — notes, links, reminders"
                      : preview(conv)}
                  </Typography>
                </Box>
                {conv.unread_count > 0 && (
                  <Badge badgeContent={conv.unread_count} color="primary" sx={{ mr: 1 }} />
                )}
              </ButtonBase>
            );
          })
        )}

        {directory.length > 0 ? (
          <>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", px: 2, pt: 2, pb: 0.5 }}
            >
              Everyone else
            </Typography>
            {directory.map((person) => (
              <ButtonBase
                key={`p-${person.user_id}`}
                onClick={() => startWith(person)}
                disabled={createConversation.isPending}
                sx={{
                  width: "100%",
                  display: "flex",
                  gap: 1.5,
                  alignItems: "center",
                  px: 2,
                  py: 1.5,
                  textAlign: "left",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <PersonAvatar name={person.name} size={40} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                    {person.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                    {/* A prompt, not a status. "No messages yet" describes the
                        row; "Say hi" tells you what clicking it does. */}
                    Say hi
                  </Typography>
                </Box>
              </ButtonBase>
            ))}
          </>
        ) : null}
      </Box>
    </Stack>
  );
}
