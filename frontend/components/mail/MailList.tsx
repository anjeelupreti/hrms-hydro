"use client";

import AttachFileIcon from "@mui/icons-material/AttachFile";
import EditIcon from "@mui/icons-material/Edit";
import SyncIcon from "@mui/icons-material/Sync";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";

import type { EmailFolder, EmailListItem } from "@/types/mail";

import EmptyState from "@/components/common/EmptyState";

type Props = {
  folder: EmailFolder;
  onFolderChange: (folder: EmailFolder) => void;
  emails: EmailListItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onSync: () => void;
  syncing: boolean;
  onCompose: () => void;
};

function dateLabel(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function MailList({
  folder,
  onFolderChange,
  emails,
  selectedId,
  onSelect,
  onSync,
  syncing,
  onCompose,
}: Props) {
  return (
    <Stack sx={{ height: "100%" }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", px: 2, pt: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          Mail
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            startIcon={syncing ? <CircularProgress size={14} /> : <SyncIcon />}
            onClick={onSync}
            disabled={syncing}
          >
            Sync
          </Button>
          <Button size="small" variant="contained" startIcon={<EditIcon />} onClick={onCompose}>
            Compose
          </Button>
        </Stack>
      </Stack>

      <Tabs value={folder} onChange={(_, v) => onFolderChange(v)} variant="fullWidth" sx={{ minHeight: 40 }}>
        <Tab label="Inbox" value="inbox" sx={{ minHeight: 40 }} />
        <Tab label="Sent" value="sent" sx={{ minHeight: 40 }} />
      </Tabs>

      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          borderTop: "1px solid",
          borderColor: "divider",
          // Only becomes a centring context when empty; a populated list must
          // stay a normal top-anchored scroll column.
          ...(emails.length === 0 && { display: "flex", flexDirection: "column" }),
        }}
      >
        {emails.length === 0 ? (
          <EmptyState
            variant="empty"
            title={folder === "inbox" ? "Inbox is empty" : "Nothing sent yet"}
            description={
              folder === "inbox"
                ? "Hit Sync to fetch mail from the connected account."
                : "Messages you send from here will be listed."
            }
            compact
            fill
          />
        ) : (
          emails.map((email) => {
            const isSelected = email.id === selectedId;
            const primary = folder === "sent" ? `To: ${email.to}` : email.from_name || email.from_email;
            return (
              <ButtonBase
                key={email.id}
                onClick={() => onSelect(email.id)}
                sx={{
                  width: "100%",
                  display: "block",
                  textAlign: "left",
                  px: 2,
                  py: 1.25,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  bgcolor: isSelected ? "action.selected" : "transparent",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: email.is_read || folder === "sent" ? 500 : 800 }}
                    noWrap
                  >
                    {primary}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {dateLabel(email.date)}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: email.is_read || folder === "sent" ? 400 : 700, flex: 1 }}
                    noWrap
                  >
                    {email.subject || "(no subject)"}
                  </Typography>
                  {email.has_attachments && <AttachFileIcon fontSize="inherit" color="action" />}
                </Stack>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                  {email.snippet}
                </Typography>
              </ButtonBase>
            );
          })
        )}
      </Box>
    </Stack>
  );
}
