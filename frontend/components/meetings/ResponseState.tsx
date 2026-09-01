"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { useState } from "react";

import type { CompanyEvent } from "@/types/calendar";

/**
 * Which upcoming meetings still have a room that has not replied.
 *
 * **The organiser's question is not "what is scheduled" — the list answers
 * that.** It is "is this actually happening", and that turns on how many people
 * have said yes. A meeting with nine invitees and two acceptances the day
 * before is a meeting that needs a nudge or a cancellation, and nothing on this
 * page said so: each card showed its own attendees, so the comparison across
 * meetings had to be done by scrolling and remembering.
 *
 * **Past meetings are excluded, not greyed.** A pending RSVP on a meeting that
 * already happened is not an outstanding action, it is a historical fact about
 * somebody who never clicked. Including those would put permanent unanswerable
 * rows at the top of a card whose whole job is to list things to chase.
 *
 * **Three states in a fixed order — accepted, declined, pending — because they
 * are not interchangeable.** A declined invitation is answered; the meeting can
 * proceed knowing that person is out. A pending one is the only one that costs
 * the organiser anything, so it sits at the end where a run of it is visible as
 * a ragged right edge across the rows.
 */

const SOON_DAYS = 14;

export default function ResponseState({ meetings }: { meetings: CompanyEvent[] }) {
  // Read once per mount rather than on every render. `Date.now()` in the render
  // body is impure — the horizon would shift underneath a re-render, and the
  // server's value and the client's first value would not agree, which is a
  // hydration mismatch as well as a lint error.
  const [now] = useState(() => Date.now());
  const horizon = now + SOON_DAYS * 86_400_000;

  const upcoming = meetings
    .filter((m) => {
      const start = new Date(m.start_datetime).getTime();
      return start >= now && start <= horizon && (m.attendees?.length ?? 0) > 0;
    })
    .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime());

  if (upcoming.length === 0) return null;

  const rows = upcoming.map((meeting) => {
    const attendees = meeting.attendees ?? [];
    return {
      meeting,
      accepted: attendees.filter((a) => a.rsvp_status === "accepted").length,
      declined: attendees.filter((a) => a.rsvp_status === "declined").length,
      pending: attendees.filter((a) => a.rsvp_status === "pending").length,
      total: attendees.length,
    };
  });

  const worst = [...rows].sort((a, b) => b.pending - a.pending)[0];
  const totalPending = rows.reduce((sum, r) => sum + r.pending, 0);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Who has replied
          </Typography>
          <Typography variant="caption" color="text.secondary">
            next {SOON_DAYS} days
          </Typography>
        </Stack>

        {/* The finding, before the marks. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {totalPending === 0
            ? `Everyone has answered on all ${rows.length} upcoming ${rows.length === 1 ? "meeting" : "meetings"}.`
            : `“${worst.meeting.title}” is waiting on ${worst.pending} of ${worst.total}.`}
        </Typography>

        <Stack spacing={1}>
          {rows.map((row) => (
            <Stack key={row.meeting.id} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, display: "block" }} noWrap title={row.meeting.title}>
                  {row.meeting.title}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {new Date(row.meeting.start_datetime).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                </Typography>
              </Box>

              <Box sx={{ display: "flex", gap: "2px", flexGrow: 1, minWidth: 0 }}>
                {(
                  [
                    { key: "accepted", value: row.accepted, label: "accepted" },
                    { key: "declined", value: row.declined, label: "declined" },
                    { key: "pending", value: row.pending, label: "no reply" },
                  ] as const
                ).map((segment) =>
                  segment.value === 0 ? null : (
                    <Tooltip key={segment.key} title={`${segment.value} ${segment.label}`}>
                      <Box
                        sx={{
                          flexGrow: segment.value,
                          height: 16,
                          borderRadius: "3px",
                          ...(segment.key === "pending"
                            ? {
                                // No reply is drawn hollow: it is an absence of
                                // information, not a third opinion.
                                border: "1.5px dashed",
                                borderColor: "divider",
                              }
                            : {
                                bgcolor: "primary.main",
                                opacity: segment.key === "accepted" ? 0.85 : 0.35,
                              }),
                        }}
                      />
                    </Tooltip>
                  ),
                )}
              </Box>

              <Typography
                variant="caption"
                sx={{
                  width: 60,
                  flexShrink: 0,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color: row.pending > 0 ? "text.primary" : "text.secondary",
                  fontWeight: row.pending > 0 ? 700 : 400,
                }}
              >
                {row.accepted}/{row.total} in
              </Typography>
            </Stack>
          ))}
        </Stack>

        <Stack direction="row" spacing={2.5} sx={{ mt: 2, flexWrap: "wrap", rowGap: 1 }}>
          {[
            { label: "accepted", sx: { bgcolor: "primary.main", opacity: 0.85 } },
            { label: "declined", sx: { bgcolor: "primary.main", opacity: 0.35 } },
            { label: "no reply", sx: { border: "1.5px dashed", borderColor: "divider" } },
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
