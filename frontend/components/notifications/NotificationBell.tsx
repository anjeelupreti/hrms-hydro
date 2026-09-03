"use client";

import DoneAllIcon from "@mui/icons-material/DoneAll";
import NotificationsIcon from "@mui/icons-material/Notifications";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import SettingsIcon from "@mui/icons-material/Settings";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import Drawer from "@mui/material/Drawer";
import { useTheme } from "@mui/material/styles";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { getNotificationIconSpec } from "@/components/notifications/notificationIcons";
import NotificationDetailDialog from "@/components/notifications/NotificationDetailDialog";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/hooks/useNotifications";
import type { Notification } from "@/types/notifications";

/** Relative-time label: "5 min ago", "2 hr ago", "Yesterday", etc. */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Group notifications into Today / Yesterday / This week / Older */
function groupNotifications(list: Notification[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400_000);
  const weekStart = new Date(todayStart.getTime() - 6 * 86400_000);

  const groups: { label: string; items: Notification[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This week", items: [] },
    { label: "Older", items: [] },
  ];

  for (const n of list) {
    const d = new Date(n.created_at);
    if (d >= todayStart) groups[0].items.push(n);
    else if (d >= yesterdayStart) groups[1].items.push(n);
    else if (d >= weekStart) groups[2].items.push(n);
    else groups[3].items.push(n);
  }

  return groups.filter((g) => g.items.length > 0);
}

function NotificationItem({
  n,
  onClick,
}: {
  n: Notification;
  onClick: (n: Notification) => void;
}) {
  const { icon: Icon, color } = getNotificationIconSpec(n.verb);

  return (
    <Box
      component="button"
      onClick={() => onClick(n)}
      sx={{
        display: "flex",
        width: "100%",
        alignItems: "flex-start",
        gap: 1.5,
        px: 2,
        py: 1.5,
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        borderLeft: "3px solid",
        borderLeftColor: n.is_read ? "transparent" : "primary.main",
        bgcolor: n.is_read ? "transparent" : "action.hover",
        transition: "background-color 0.15s ease",
        "&:hover": { bgcolor: "action.selected" },
      }}
    >
      {/* Coloured icon avatar */}
      <Avatar
        sx={{
          width: 36,
          height: 36,
          bgcolor: `${color}.light`,
          color: `${color}.dark`,
          flexShrink: 0,
        }}
      >
        <Icon sx={{ fontSize: 16 }} />
      </Avatar>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{
            fontWeight: n.is_read ? 500 : 700,
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {n.message}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: "block" }}>
          {relativeTime(n.created_at)}
        </Typography>
      </Box>

      {/* Unread dot */}
      {!n.is_read && (
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: "primary.main",
            flexShrink: 0,
            mt: 0.75,
          }}
        />
      )}
    </Box>
  );
}

function NotificationPanel({
  onClose,
  onItemClick,
}: {
  onClose: () => void;
  onItemClick: (n: Notification) => void;
}) {
  const { data: notifications, isPending, isError, refetch } = useNotifications(1, 20);
  const markAll = useMarkAllNotificationsRead();
  const { data: unread } = useUnreadCount();
  const items = notifications?.results ?? [];
  const groups = groupNotifications(items);

  return (
    <Box
      sx={{
        width: { xs: "100%", sm: 400 },
        display: "flex",
        flexDirection: "column",
        // `height: 100%` was meaningless here: the parent is sized by
        // `maxHeight`, so it has no definite height to be 100% of. What the
        // panel actually needs is to be a flex item that can shrink.
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Header */}
      <Stack
        direction="row"
        sx={{ alignItems: "center", px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
          Notifications
          {(unread?.count ?? 0) > 0 && (
            <Box
              component="span"
              sx={{
                ml: 1,
                px: 0.75,
                py: 0.1,
                borderRadius: 999,
                bgcolor: "error.main",
                color: "common.white",
                fontSize: "0.65rem",
                fontWeight: 800,
                verticalAlign: "middle",
              }}
            >
              {unread!.count}
            </Box>
          )}
        </Typography>
        {(unread?.count ?? 0) > 0 && (
          <Button
            size="small"
            startIcon={<DoneAllIcon fontSize="small" />}
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            sx={{ mr: 0.5, fontSize: "0.75rem" }}
          >
            Mark all read
          </Button>
        )}
      </Stack>

      {/* Scrollable list */}
      {/* `minHeight: 0` is the whole fix.
          A flex item defaults to `min-height: auto`, which means it refuses to
          shrink below its content — so this box grew to the full height of the
          list, pushed the footer out of the panel, and `overflowY: auto` never
          had anything to scroll because the box was never smaller than its
          contents. The panel clipped the overflow and the last notification
          looked cut in half. */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
        {/* **Three states, not two.**

            This used to be `items.length === 0 ? "all caught up" : list`, and
            `items` is `data?.results ?? []` — so an in-flight request and a
            failed one both read as *no notifications*. The badge counts through
            its own endpoint, which is one small request and lands first, so the
            panel confidently said "You're all caught up!" directly underneath a
            red 14. The count was never wrong; the list was lying about not
            having loaded.

            The panel is mounted by the popover, so every first open starts with
            an empty cache and shows this. */}
        {isPending ? (
          <Stack sx={{ p: 2 }} spacing={1.5}>
            {[0, 1, 2, 3].map((row) => (
              <Stack key={row} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <Skeleton variant="circular" width={32} height={32} />
                <Stack sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="90%" />
                  <Skeleton variant="text" width="35%" />
                </Stack>
              </Stack>
            ))}
          </Stack>
        ) : isError ? (
          <Stack sx={{ alignItems: "center", justifyContent: "center", py: 6, px: 2 }} spacing={1}>
            <NotificationsNoneIcon sx={{ fontSize: 40, color: "text.disabled" }} />
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
              Your notifications could not be loaded.
            </Typography>
            <Button size="small" onClick={() => refetch()}>
              Try again
            </Button>
          </Stack>
        ) : items.length === 0 ? (
          <Stack sx={{ alignItems: "center", justifyContent: "center", py: 8, px: 2 }}>
            <NotificationsNoneIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
              You&apos;re all caught up!
              <br />
              No notifications yet.
            </Typography>
          </Stack>
        ) : (
          <AnimatePresence>
            {groups.map((group) => (
              <Box key={group.label}>
                <Typography
                  variant="overline"
                  sx={{ px: 2, py: 0.75, display: "block", color: "text.secondary", bgcolor: "background.default" }}
                >
                  {group.label}
                </Typography>
                {group.items.map((n, i) => (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.2 }}
                  >
                    <NotificationItem n={n} onClick={onItemClick} />
                  </motion.div>
                ))}
              </Box>
            ))}
          </AnimatePresence>
        )}
      </Box>

      {/* Footer. `flexShrink: 0` so a long list cannot squeeze it away — it
          carries the only route to the full notification page. */}
      <Divider sx={{ flexShrink: 0 }} />
      <Stack direction="row" sx={{ px: 1.5, py: 1, gap: 0.5, flexShrink: 0 }}>
        <Button
          size="small"
          startIcon={<OpenInFullIcon fontSize="small" />}
          component={Link}
          href="/notifications"
          onClick={onClose}
          sx={{ fontSize: "0.75rem" }}
        >
          See all
        </Button>
        <Button
          size="small"
          startIcon={<SettingsIcon fontSize="small" />}
          component={Link}
          href="/settings/notifications"
          onClick={onClose}
          sx={{ fontSize: "0.75rem" }}
        >
          Settings
        </Button>
      </Stack>
    </Box>
  );
}

export default function NotificationBell() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [detail, setDetail] = useState<Notification | null>(null);
  const { data: unread } = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const hasUnread = (unread?.count ?? 0) > 0;
  const open = Boolean(anchorEl);

  function handleClick(n: Notification) {
    if (!n.is_read) markRead.mutate(n.id);
    setAnchorEl(null);
    setDetail(n);
  }

  return (
    <>
      {/* Bell button with pulse ring when unread */}
      <Box sx={{ position: "relative", display: "inline-flex" }}>
        {hasUnread && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              bgcolor: "error.main",
              animation: "pulse-ring 1.8s ease-out infinite",
              opacity: 0,
            }}
          />
        )}
        <IconButton
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{
            color: hasUnread ? "primary.main" : "text.secondary",
            transition: "color 0.2s ease",
          }}
        >
          <Badge badgeContent={unread?.count ?? 0} color="error" max={99}>
            {hasUnread ? <NotificationsIcon /> : <NotificationsNoneIcon />}
          </Badge>
        </IconButton>
      </Box>

      {/* Desktop: Popover panel */}
      {!isMobile && (
        <Popover
          open={open}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{
            paper: {
              sx: {
                width: 400,
                maxHeight: 560,
                display: "flex",
                flexDirection: "column",
                borderRadius: 3,
                border: "1px solid",
                borderColor: "divider",
                overflow: "hidden",
                mt: 1,
              },
            }
          }}
        >
          <NotificationPanel
            onClose={() => setAnchorEl(null)}
            onItemClick={handleClick}
          />
        </Popover>
      )}

      {/* Mobile: bottom Drawer */}
      {isMobile && (
        <Drawer
          anchor="bottom"
          open={open}
          onClose={() => setAnchorEl(null)}
          slotProps={{
            paper: {
              sx: {
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                maxHeight: "80dvh",
                display: "flex",
                flexDirection: "column",
              },
            },
          }}
        >
          <Box sx={{ display: "flex", justifyContent: "center", pt: 1.5, pb: 0.5 }}>
            <Box sx={{ width: 40, height: 4, borderRadius: 999, bgcolor: "divider" }} />
          </Box>
          <NotificationPanel
            onClose={() => setAnchorEl(null)}
            onItemClick={handleClick}
          />
        </Drawer>
      )}

      {detail && (
        <NotificationDetailDialog notification={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}
