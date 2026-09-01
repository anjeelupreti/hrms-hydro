"use client";

import DeleteOutlineIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import type { CachedMessage } from "@/hooks/useChatSocket";

type Props = {
  message: CachedMessage;
  isMine: boolean;
  showSender: boolean;
  onEdit: (message: CachedMessage) => void;
  onDelete: (messageId: number) => void;
};

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function MessageBubble({ message, isMine, showSender, onEdit, onDelete }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const canManage = isMine && !message.is_deleted && !message.pending;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: isMine ? "flex-end" : "flex-start",
        "&:hover .msg-actions": { opacity: 1 },
      }}
    >
      {showSender && !isMine && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5, mb: 0.25 }}>
          {message.sender_name}
        </Typography>
      )}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexDirection: isMine ? "row-reverse" : "row", maxWidth: "78%" }}>
        <Box
          sx={{
            px: 2,
            py: 1.25,
            borderRadius: isMine ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
            bgcolor: message.is_deleted
              ? "transparent"
              : isMine
                ? "primary.main"
                : "background.paper",
            color: isMine && !message.is_deleted ? "primary.contrastText" : "text.primary",
            border: message.is_deleted || !isMine ? "1px solid" : "none",
            borderColor: "divider",
            opacity: message.pending ? 0.6 : 1,
            outline: message.failed ? "1px solid" : "none",
            outlineColor: "error.main",
            boxShadow: !isMine && !message.is_deleted ? "0 2px 8px rgba(0,0,0,0.04)" : "none",
          }}
        >
          {message.is_deleted ? (
            <Typography variant="body2" sx={{ fontStyle: "italic" }} color="text.secondary">
              This message was deleted
            </Typography>
          ) : (
            <>
              {message.body && (
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {message.body}
                </Typography>
              )}
              {message.attachments?.map((att) => {
                const href = `/api/proxy/chat/attachments/${att.id}/download`;
                const isImage = att.content_type?.startsWith("image/");
                return isImage ? (
                  <Box
                    key={att.id}
                    component="a"
                    href={href}
                    target="_blank"
                    rel="noopener"
                    sx={{ display: "block", mt: message.body ? 0.75 : 0 }}
                  >
                    <Box
                      component="img"
                      src={href}
                      alt={att.filename}
                      sx={{ maxWidth: 220, maxHeight: 220, borderRadius: 1.5, display: "block" }}
                    />
                  </Box>
                ) : (
                  <Box
                    key={att.id}
                    component="a"
                    href={href}
                    target="_blank"
                    rel="noopener"
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      mt: message.body ? 0.75 : 0,
                      p: 0.75,
                      borderRadius: 1.5,
                      bgcolor: isMine ? "rgba(255,255,255,0.15)" : "background.paper",
                      color: "inherit",
                      textDecoration: "none",
                      maxWidth: 240,
                    }}
                  >
                    <InsertDriveFileIcon fontSize="small" />
                    <Typography variant="caption" noWrap sx={{ flex: 1 }}>
                      {att.filename}
                    </Typography>
                  </Box>
                );
              })}
            </>
          )}
          <Typography
            variant="caption"
            sx={{ display: "block", mt: 0.25, opacity: 0.7, textAlign: isMine ? "right" : "left" }}
          >
            {timeLabel(message.created_at)}
            {message.edited_at && !message.is_deleted ? " · edited" : ""}
            {message.pending ? " · sending…" : ""}
            {message.failed ? " · not sent" : ""}
          </Typography>
        </Box>
        {canManage && (
          <IconButton
            size="small"
            className="msg-actions"
            sx={{ opacity: 0, transition: "opacity 0.15s" }}
            onClick={(e) => setAnchor(e.currentTarget)}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onEdit(message);
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onDelete(message.id);
          }}
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>
    </Box>
  );
}
