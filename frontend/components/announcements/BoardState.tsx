"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import type { Announcement } from "@/types/collaboration";

/**
 * What is actually on the noticeboard, and what will never come off it.
 *
 * **A noticeboard fails by accumulating, and nothing on the page showed that.**
 * The list is ordered by date, so a notice posted in Baisakh that nobody ever
 * took down looks exactly like one posted this morning — it is just further
 * scrolled. The failure is not any single stale notice; it is the ratio, and a
 * ratio has to be shown to be seen.
 *
 * **Two different states, deliberately not merged.** An *expired* notice has a
 * date that has passed: it has already stopped reaching employees, because the
 * dashboard banner asks for `active=true` and the server filters on
 * `expires_at`. A notice with *no expiry* is the opposite problem — it is still
 * on every employee's dashboard and no date will ever remove it. The first is
 * clutter on this page; the second is a permanent fixture on everybody else's.
 * Calling both "old" would hide the one that is still broadcasting.
 *
 * **Pinned-and-permanent is called out on its own.** A pinned notice with no
 * expiry is the strongest thing this module can do to an employee's screen, and
 * it lasts until somebody remembers to archive it.
 *
 * Nothing here is a defect report: showing expired notices on *this* page is
 * correct — it is the management view, and HR should see what has lapsed. The
 * card exists so that seeing it does not require counting.
 */

export default function BoardState({ announcements }: { announcements: Announcement[] }) {
  // Once per mount: a clock read during render is unstable and disagrees
  // between the server render and the client's first one.
  const [now] = useState(() => Date.now());

  if (announcements.length === 0) return null;

  const expired = announcements.filter(
    (a) => a.expires_at !== null && new Date(a.expires_at).getTime() < now,
  );
  const permanent = announcements.filter((a) => a.expires_at === null);
  const live = announcements.filter(
    (a) => a.expires_at !== null && new Date(a.expires_at).getTime() >= now,
  );
  const pinnedForever = permanent.filter((a) => a.pinned);

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            What is on the board
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {announcements.length} {announcements.length === 1 ? "notice" : "notices"}
          </Typography>
        </Stack>

        {/* The finding, before the marks. The permanent ones lead: they are
            still on everybody's dashboard, which the expired ones are not. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {pinnedForever.length > 0
            ? `${pinnedForever.length} pinned ${pinnedForever.length === 1 ? "notice has" : "notices have"} no expiry — ${pinnedForever.length === 1 ? "it stays" : "they stay"} at the top of every dashboard until archived by hand.`
            : permanent.length > 0
              ? `${permanent.length} ${permanent.length === 1 ? "notice has" : "notices have"} no expiry date, so nothing will take ${permanent.length === 1 ? "it" : "them"} down.`
              : expired.length > 0
                ? `${expired.length} of ${announcements.length} have lapsed and stopped reaching anybody.`
                : "Every notice has a date and none has passed it."}
        </Typography>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: "3px", mb: 2 }}>
          {[...permanent, ...live, ...expired].map((notice) => {
            const isPermanent = notice.expires_at === null;
            const isExpired = notice.expires_at !== null && new Date(notice.expires_at).getTime() < now;
            return (
              <Tooltip
                key={notice.id}
                title={`${notice.title}${notice.pinned ? " · pinned" : ""} — ${
                  isPermanent
                    ? "no expiry"
                    : isExpired
                      ? `lapsed ${new Date(notice.expires_at as string).toLocaleDateString()}`
                      : `until ${new Date(notice.expires_at as string).toLocaleDateString()}`
                }`}
              >
                <Box
                  sx={{
                    width: 16,
                    height: 16,
                    borderRadius: "3px",
                    // A pin is a property of the notice, not a fourth category,
                    // so it is a ring rather than another fill.
                    outline: notice.pinned ? "2px solid" : "none",
                    outlineColor: "text.primary",
                    outlineOffset: 1,
                    ...(isPermanent
                      ? {
                          border: "1.5px solid",
                          borderColor: "var(--hrms-status-warning-solid)",
                          bgcolor: "transparent",
                        }
                      : isExpired
                        ? { bgcolor: "action.hover" }
                        : { bgcolor: "primary.main", opacity: 0.85 }),
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>

        <Stack direction="row" spacing={2.5} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          {[
            { label: `${live.length} live`, sx: { bgcolor: "primary.main", opacity: 0.85 } },
            {
              label: `${permanent.length} no expiry`,
              sx: { border: "1.5px solid", borderColor: "var(--hrms-status-warning-solid)" },
            },
            { label: `${expired.length} lapsed`, sx: { bgcolor: "action.hover" } },
          ].map((item) => (
            <Stack key={item.label} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 10, height: 10, borderRadius: "2px", ...item.sx }} />
              <Typography variant="caption" color="text.secondary">
                {item.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
