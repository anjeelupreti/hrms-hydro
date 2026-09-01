"use client";

import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import { useTheme } from "@mui/material/styles";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";

import { getNotificationIconSpec } from "@/components/notifications/notificationIcons";
import { getNotificationRoute } from "@/components/notifications/notificationRoutes";
import type { Notification } from "@/types/notifications";

// An announcement arrives as "Subject - body"; split for a proper title.
function splitHeading(message: string): { title: string; body: string } {
  const match = message.match(/ (—|-) /);
  if (match && match.index != null && match.index > 0 && match.index < 120) {
    return { title: message.slice(0, match.index), body: message.slice(match.index + match[0].length) };
  }
  return { title: "Notification", body: message };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationDetailDialog({
  notification,
  onClose,
}: {
  notification: Notification;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { icon: Icon, color } = getNotificationIconSpec(notification.verb);
  const route = getNotificationRoute(notification.verb);
  const { title, body } = splitHeading(notification.message);

  // The band follows the live palette rather than a frozen copy. The accent is
  // the company preference, so a hardcoded hue is wrong for every company that
  // changed it — and a literal tracks neither scheme.
  const palette = theme.palette[color as "primary" | "success" | "warning" | "error" | "info" | "secondary"];
  const bandColor = palette?.main ?? theme.palette.primary.main;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      {/* Coloured header band */}
      <Box
        sx={{
          background: `linear-gradient(135deg, ${bandColor}dd, ${bandColor}88)`,
          px: 3,
          pt: 2.5,
          pb: 2,
          color: "common.white",
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: 2,
              bgcolor: "rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: "common.white" }} noWrap>
              {title}
            </Typography>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.75)" }}>
              {relativeTime(notification.created_at)}
            </Typography>
          </Box>
        </Stack>
      </Box>

      <DialogContent sx={{ pt: 2.5 }}>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
          {body}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} size="small">
          Close
        </Button>
        {route && (
          <Button
            variant="contained"
            size="small"
            endIcon={<OpenInNewIcon fontSize="small" />}
            component={NextLink}
            href={route}
            onClick={onClose}
          >
            Open
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
