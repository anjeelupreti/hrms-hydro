"use client";

import ForumIcon from "@mui/icons-material/Forum";
import MailIcon from "@mui/icons-material/Email";
import Badge from "@mui/material/Badge";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import NextLink from "next/link";

import { useConversations } from "@/hooks/useChat";
import { useMailUnreadCount } from "@/hooks/useMail";
import { useMe } from "@/hooks/useMe";

/**
 * Messages and the company mailbox, in the sidebar under the profile card.
 *
 * **Not nav rows — and that was always the point.** The sidebar is a list of
 * *places to work*, and you go to one because you decided to. These two are
 * different: they are things that arrive, and what you want is a count at a
 * glance and one click when it changes. Two more rows in a nav that already has
 * thirty is the wrong shape for "you have four unread".
 *
 * They spent a while in the top bar for that reason. The owner asked for them
 * here instead, and the reason holds up: the top bar is seven small controls a
 * person has to hunt through, while the profile card is the one piece of chrome
 * the eye already returns to — and beside your own name, an unread count reads
 * as *yours*. So: in the sidebar, in the identity block, still not a nav row.
 * One home either way; a duplicated inbox is how two counts come to disagree.
 *
 * **The mail icon appears only for somebody who may open it.** The company
 * mailbox is gated by `mail.access` — its own capability, grantable by the
 * owner from Roles & permissions — and the icon follows the same rule the API
 * enforces rather than a second guess at it. An employee without the grant does
 * not see it; grant it and it appears. Messages has no such gate on purpose:
 * chatting with a colleague is not the company mailbox.
 *
 * **The unread count is only requested by somebody entitled to it.** Asking on
 * behalf of a reader who will be refused produces a 403 on every page load —
 * which is exactly what the sidebar's badge did before, because it was gated on
 * a different permission from the one the endpoint checks.
 */
export default function InboxIcons({ collapsed = false }: { collapsed?: boolean }) {
  const { data: me } = useMe();
  const canReadMail = Boolean(me?.permissions?.includes("mail.access"));

  const { data: conversations } = useConversations();
  const unreadChats = (conversations ?? []).reduce((sum, c) => sum + c.unread_count, 0);

  const { data: mail } = useMailUnreadCount(canReadMail);
  const mailUnread = mail?.count ?? 0;

  // A collapsed rail is for navigation. Stacking two more icons into it makes
  // them look like nav entries, which is the shape this deliberately is not.
  if (collapsed) return null;

  return (
    <Stack
      direction="row"
      spacing={0.5}
      // Two icons take the width of two icons. As a flex item claiming
      // everything going, they squeeze the name beside them to an ellipsis.
      sx={{ justifyContent: "center", flexShrink: 0 }}
    >
      <Tooltip title={unreadChats > 0 ? `Messages — ${unreadChats} unread` : "Messages"}>
        <IconButton
          size="small"
          color="inherit"
          component={NextLink}
          href="/messages"
          aria-label={unreadChats > 0 ? `Messages, ${unreadChats} unread` : "Messages"}
        >
          <Badge badgeContent={unreadChats} color="error">
            <ForumIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>

      {canReadMail && (
        <Tooltip title={mailUnread > 0 ? `Mail — ${mailUnread} unread` : "Mail"}>
          <IconButton
            size="small"
            color="inherit"
            component={NextLink}
            href="/mail"
            aria-label={mailUnread > 0 ? `Mail, ${mailUnread} unread` : "Mail"}
          >
            <Badge badgeContent={mailUnread} color="error">
              <MailIcon fontSize="small" />
            </Badge>
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}
