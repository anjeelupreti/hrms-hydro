"use client";

import ApartmentIcon from "@mui/icons-material/Apartment";
import ArchiveIcon from "@mui/icons-material/Archive";
import DeleteIcon from "@mui/icons-material/Delete";
import GroupsIcon from "@mui/icons-material/Groups";
import PersonIcon from "@mui/icons-material/Person";
import PushPinIcon from "@mui/icons-material/PushPin";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import AnnouncementReach from "@/components/announcements/AnnouncementReach";
import DateText from "@/components/common/DateText";
import PersonAvatar from "@/components/common/PersonAvatar";
import type { Announcement } from "@/types/collaboration";

/**
 * One notice on the board.
 *
 * **Every card used to look identical**, which is the problem with a
 * noticeboard rendered as a list: a pinned notice that must be read today and a
 * greeting from last festival carried exactly the same weight, and the only
 * difference was scroll position. So the things that actually distinguish a
 * notice are on it — who it is for, who wrote it, whether *you* have read it —
 * and a pinned one is drawn as something the eye stops at.
 *
 * **The audience is on the card because it changes what the notice means.**
 * "Everyone" and "the four people on the shutdown" are different messages even
 * with identical text, and the author is the one person who cannot tell them
 * apart afterwards without being told.
 */
export default function NoticeCard({
  announcement,
  canManage,
  archived,
  onArchiveToggle,
  onDelete,
  onOpenReceipts,
}: {
  announcement: Announcement;
  canManage: boolean;
  archived: boolean;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onOpenReceipts: () => void;
}) {
  const {
    department_name: departmentName,
    recipient_names: recipientNames,
    author_name: author,
  } = announcement;
  const named = recipientNames?.length ?? 0;
  // Neither set means the whole company — see `Announcement.recipients`.
  const companyWide = !departmentName && named === 0;
  // A notice nobody has opened yet is the one thing on this page the *reader*
  // wants picked out; the author's view of that is the reach strip below.
  const unread = !announcement.my_receipt?.seen_at;

  return (
    <Card
      variant="outlined"
      sx={{
        position: "relative",
        overflow: "hidden",
        // A pinned notice earns a stripe, not a louder background: the body
        // still has to be readable and a tinted card makes prose worse.
        borderColor: announcement.pinned ? "primary.main" : "divider",
        "&::before": announcement.pinned
          ? {
              content: '""',
              position: "absolute",
              insetBlock: 0,
              left: 0,
              width: 4,
              bgcolor: "primary.main",
            }
          : undefined,
      }}
    >
      <Box sx={{ p: 2, pl: announcement.pinned ? 2.75 : 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
          <PersonAvatar name={author || "?"} size={38} variant="outlined" />

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flexWrap: "wrap" }}
              useFlexGap
            >
              {announcement.pinned ? (
                <Tooltip title="Pinned to the top">
                  <PushPinIcon fontSize="small" color="primary" />
                </Tooltip>
              ) : null}
              <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                {announcement.title}
              </Typography>
              {unread && !archived ? (
                <Chip size="small" color="primary" label="New" />
              ) : null}
            </Stack>

            {/* Who wrote it, when, and who it reached — one line, because
                these are read together and never separately. `DateText`
                rather than a raw locale string: the rest of the product
                shows this company's calendar and this page did not. */}
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flexWrap: "wrap", mt: 0.5 }}
              useFlexGap
            >
              {/* An announcement can outlive the account that posted it —
                  `created_by` is nullable — so the byline is dropped rather
                  than rendered as a dash beside a question-mark avatar. */}
              {author ? (
                <>
                  <Typography variant="caption" color="text.secondary">
                    {author}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    ·
                  </Typography>
                </>
              ) : null}
              <Typography variant="caption" color="text.secondary">
                <DateText value={announcement.created_at} withTime />
              </Typography>
              <Box sx={{ flex: 1 }} />
              {companyWide ? (
                <Chip size="small" variant="outlined" icon={<GroupsIcon />} label="Everyone" />
              ) : (
                <>
                  {departmentName ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={<ApartmentIcon />}
                      label={departmentName}
                    />
                  ) : null}
                  {named > 0 ? (
                    <Tooltip
                      title={recipientNames.map((p) => p.name).join(", ")}
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        icon={<PersonIcon />}
                        label={`${named} ${named === 1 ? "person" : "people"}`}
                      />
                    </Tooltip>
                  ) : null}
                </>
              )}
            </Stack>
          </Box>

          {canManage ? (
            <Stack direction="row" spacing={0.5}>
              <Tooltip title={archived ? "Put it back on the board" : "File it away"}>
                <IconButton size="small" onClick={onArchiveToggle}>
                  {archived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete permanently">
                <IconButton size="small" onClick={onDelete}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ) : null}
        </Stack>

        {/* The reading measure, on the thing that is actually prose. A notice
            runs to a paragraph and a 1400px line is unreadable; the card
            around it is free to use the page. */}
        <Typography
          variant="body2"
          sx={{ mt: 1.5, maxWidth: "72ch", whiteSpace: "pre-wrap", color: "text.secondary" }}
        >
          {announcement.body}
        </Typography>

        <Box sx={{ mt: 1.5 }}>
          <AnnouncementReach
            announcement={announcement}
            // The endpoint refuses anybody who is not the author or a
            // workplace manager, so this only decides whether to draw the
            // button — it is not the check.
            canSeeNames={canManage || announcement.is_mine}
            onOpenReceipts={onOpenReceipts}
          />
        </Box>
      </Box>
    </Card>
  );
}
