"use client";

/**
 * Pinned announcements, as headlines.
 *
 * An announcement is worth *knowing about*; reading it is a decision the reader
 * makes. Three alerts each carrying a full paragraph is ~255px above every
 * number on the dashboard, spent re-reading something they read yesterday.
 *
 * So: titles, in one card, each expandable. The full text is one click away and
 * the fact that there are three is visible at a glance — which is the part that
 * belongs on a dashboard.
 *
 * **Pinned only, as before.** An announcement somebody deliberately pinned is a
 * claim that it should stay visible; the rest live on their own page.
 */

import CampaignIcon from "@mui/icons-material/Campaign";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Collapse from "@mui/material/Collapse";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { useAnnouncements } from "@/hooks/useCollaboration";

export default function AnnouncementsRail() {
  const { data: announcements } = useAnnouncements(true);
  const [open, setOpen] = useState<number | null>(null);

  const pinned = announcements?.results.filter((a) => a.pinned) ?? [];
  if (pinned.length === 0) return null;

  return (
    <Card variant="outlined" sx={{ mb: 2.5, overflow: "hidden" }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          px: 1.75,
          py: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "action.hover",
        }}
      >
        <CampaignIcon sx={{ fontSize: 17, color: "text.secondary" }} />
        <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>
          {pinned.length} pinned {pinned.length === 1 ? "announcement" : "announcements"}
        </Typography>
      </Stack>

      {pinned.map((announcement, index) => {
        const isOpen = open === announcement.id;
        return (
          <Box
            key={announcement.id}
            sx={{
              borderTop: index === 0 ? "none" : "1px solid",
              borderColor: "divider",
            }}
          >
            <Stack
              component="button"
              direction="row"
              spacing={1}
              onClick={() => setOpen(isOpen ? null : announcement.id)}
              aria-expanded={isOpen}
              sx={{
                width: "100%",
                alignItems: "center",
                textAlign: "left",
                px: 1.75,
                py: 1.1,
                border: "none",
                bgcolor: "transparent",
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Typography
                sx={{
                  fontSize: "0.86rem",
                  fontWeight: 600,
                  flexGrow: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {announcement.title}
              </Typography>
              <ExpandMoreIcon
                sx={{
                  fontSize: 18,
                  color: "text.disabled",
                  flexShrink: 0,
                  transform: isOpen ? "rotate(180deg)" : "none",
                  transition: "transform .18s",
                }}
              />
            </Stack>
            <Collapse in={isOpen} unmountOnExit>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 1.75, pb: 1.5, whiteSpace: "pre-wrap" }}
              >
                {announcement.body}
              </Typography>
            </Collapse>
          </Box>
        );
      })}
    </Card>
  );
}
