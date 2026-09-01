"use client";

import DoneAllIcon from "@mui/icons-material/DoneAll";
import NotificationsIcon from "@mui/icons-material/Notifications";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Pagination from "@mui/material/Pagination";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { getNotificationIconSpec } from "@/components/notifications/notificationIcons";
import NotificationDetailDialog from "@/components/notifications/NotificationDetailDialog";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/hooks/useNotifications";
import SearchField from "@/components/common/SearchField";
import { useTextFilter } from "@/hooks/useTextFilter";
import type { Notification } from "@/types/notifications";

const PAGE_SIZE = 20;

// An announcement arrives as "Subject — body"; show the subject as a bold
// heading and the rest as the preview line, matching the detail modal.
function splitHeading(message: string): { title: string; body: string } {
  const idx = message.indexOf(" — ");
  if (idx > 0 && idx < 120) return { title: message.slice(0, idx), body: message.slice(idx + 3) };
  return { title: message, body: "" };
}

// Compact relative time ("just now", "3h ago", "2d ago") with a full-date fallback.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [detail, setDetail] = useState<Notification | null>(null);
  const { data, isLoading } = useNotifications(page, PAGE_SIZE);
  const { data: unread } = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const pageCount = data ? Math.ceil(data.count / PAGE_SIZE) : 1;
  const unreadCount = unread?.count ?? 0;
  const items = (data?.results ?? []).filter((n) => (filter === "unread" ? !n.is_read : true));

  const { query, setQuery, filtered: visible, isEmptyResult } = useTextFilter(items, (n) => [
    n.message,
    n.verb,
  ]);

  function handleClick(n: Notification) {
    if (!n.is_read) markRead.mutate(n.id);
    setDetail(n);
  }

  return (
    <PageContainer>
      <Box sx={{ maxWidth: 760, mx: "auto" }}>
        <PageHeader
          title="Notifications"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          icon={<NotificationsIcon />}
          actions={
            <>
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder="Search notifications…"
                label="Search notifications by message"
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={<DoneAllIcon />}
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending || unreadCount === 0}
              >
                Mark all read
              </Button>
            </>
          }
        />

        <Stack direction="row" sx={{ mb: 2 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={filter}
            onChange={(_, v) => v && setFilter(v)}
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="unread">
              Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <Card>
          <List disablePadding>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <Box key={i} sx={{ display: "flex", gap: 2, p: 2, alignItems: "center" }}>
                  <Skeleton variant="circular" width={40} height={40} />
                  <Box sx={{ flex: 1 }}>
                    <Skeleton variant="text" width="70%" />
                    <Skeleton variant="text" width="30%" />
                  </Box>
                </Box>
              ))}
            {!isLoading && visible.length === 0 && (
              <Box sx={{ textAlign: "center", py: 6 }}>
                <NotificationsIcon sx={{ fontSize: 44, color: "text.disabled", mb: 1 }} />
                <Typography color="text.secondary">
                  {isEmptyResult
                    ? `No notifications match “${query}”.`
                    : filter === "unread"
                      ? "No unread notifications."
                      : "You're all caught up."}
                </Typography>
              </Box>
            )}
            {visible.map((n, i) => {
              const { icon: Icon, color } = getNotificationIconSpec(n.verb);
              const { title, body } = splitHeading(n.message);
              return (
                <ListItemButton
                  key={n.id}
                  divider={i < visible.length - 1}
                  onClick={() => handleClick(n)}
                  sx={{
                    gap: 0.5,
                    alignItems: "flex-start",
                    borderLeft: "3px solid",
                    borderLeftColor: n.is_read ? "transparent" : `${color}.main`,
                    bgcolor: n.is_read ? "transparent" : "action.hover",
                  }}
                >
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: `${color}.light`, color: `${color}.dark` }}>
                      <Icon fontSize="small" />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={title}
                    secondary={
                      <>
                        {body && (
                          <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block" }}>
                            {body}
                          </Typography>
                        )}
                        <Typography component="span" variant="caption" color="text.disabled">
                          {relativeTime(n.created_at)}
                        </Typography>
                      </>
                    }
                    slotProps={{ primary: { sx: { fontWeight: n.is_read ? 400 : 700 } } }}
                  />
                  {!n.is_read && <Chip size="small" label="New" color={color} sx={{ mt: 0.5 }} />}
                </ListItemButton>
              );
            })}
          </List>
        </Card>

        {pageCount > 1 && (
          <Stack direction="row" sx={{ justifyContent: "center", mt: 3 }}>
            <Pagination count={pageCount} page={page} onChange={(_, p) => setPage(p)} color="primary" />
          </Stack>
        )}
      </Box>
      {detail && <NotificationDetailDialog notification={detail} onClose={() => setDetail(null)} />}
    </PageContainer>
  );
}
