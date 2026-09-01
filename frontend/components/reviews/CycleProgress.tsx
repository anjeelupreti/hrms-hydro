"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { useState } from "react";

import type { Review, ReviewCycle } from "@/types/organization";

/**
 * Where the cycle has stalled, and who it is waiting on.
 *
 * **A review cycle only ever fails one way: it stops halfway.** Nobody
 * abandons appraisals deliberately — they get to sixty percent, the remaining
 * forty sit with people who have not been chased, and the cycle quietly ends
 * when the dates run out. The list of reviews cannot show that, because a
 * stalled review looks exactly like one that is merely in progress.
 *
 * **Three stages, in order, because it is a sequence and not a set of
 * categories.** A review moves self → manager → done and never sideways. Drawn
 * as one bar in stage order, the shape says which handoff is holding: a fat
 * left segment means employees have not written theirs, a fat middle one means
 * managers are sitting on them. Those two problems need different phone calls,
 * and a pie of statuses would hide the distinction behind alphabetical order.
 *
 * **A review with no reviewer can never be completed.** `reviewer` is
 * nullable, and nothing in the flow requires it to be set before the employee
 * submits — so a review reaches `pending_manager` with nobody assigned to act
 * on it and waits forever. It is not a state the status field can express, so
 * it is called out separately; it is the one failure here that no amount of
 * chasing fixes, because there is nobody to chase.
 */

const STAGES = [
  { key: "pending_self", label: "with the employee", shade: 0.28 },
  { key: "pending_manager", label: "with the manager", shade: 0.6 },
  { key: "completed", label: "done", shade: 1 },
] as const;

function daysLeft(endDate: string, now: number) {
  const end = new Date(`${endDate}T23:59:59`);
  return Math.ceil((end.getTime() - now) / 86_400_000);
}

export default function CycleProgress({
  cycles,
  reviews,
  truncated = false,
}: {
  cycles: ReviewCycle[];
  reviews: Review[];
  /**
   * The page fetches reviews at `page_size=100`. Past that the counts below
   * describe the first hundred rows and not the cycle, so say so rather than
   * printing a confident total that quietly stops being true as the company
   * grows — the failure mode of every summary built on a paged list.
   */
  truncated?: boolean;
}) {
  // Read once per mount. `Date.now()` reached during render — even from a
  // helper, where the lint rule does not see it — shifts under a re-render and
  // disagrees between the server render and the client's first one.
  const [now] = useState(() => Date.now());

  const active = cycles.filter((c) => c.status === "active");
  if (active.length === 0) return null;

  // One cycle is the normal case; if several are open, the one closing soonest
  // is the one anybody needs to act on.
  const cycle = [...active].sort(
    (a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime(),
  )[0];

  const mine = reviews.filter((r) => r.cycle === cycle.id);
  if (mine.length === 0) return null;

  const counts = STAGES.map((stage) => ({
    ...stage,
    value: mine.filter((r) => r.status === stage.key).length,
  }));
  const total = mine.length;
  const done = counts[2].value;
  const orphaned = mine.filter((r) => r.status === "pending_manager" && r.reviewer === null).length;
  const left = daysLeft(cycle.end_date, now);

  // Whichever unfinished stage holds the most is the one to chase.
  const blocking = counts[0].value >= counts[1].value ? counts[0] : counts[1];

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {cycle.name}
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: left <= 7 && done < total ? "var(--hrms-status-warning-fg)" : "text.secondary" }}
          >
            {truncated ? "first 100 · " : ""}
            {left < 0
              ? `closed ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"} ago`
              : left === 0
                ? "closes today"
                : `${left} day${left === 1 ? "" : "s"} left`}
          </Typography>
        </Stack>

        {/* The finding, before the bar. The orphans lead when there are any:
            they are the only ones nobody can unblock by asking. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {orphaned > 0
            ? `${orphaned} review${orphaned === 1 ? " has" : "s have"} no reviewer assigned — ${orphaned === 1 ? "it cannot" : "they cannot"} be completed by anyone.`
            : done === total
              ? `All ${total} reviews are done.`
              : `${done} of ${total} done — ${blocking.value} still ${blocking.label}.`}
        </Typography>

        <Box sx={{ display: "flex", gap: "2px", mb: 1.5 }}>
          {counts.map((stage) =>
            stage.value === 0 ? null : (
              <Tooltip key={stage.key} title={`${stage.value} ${stage.label}`}>
                <Box
                  sx={{
                    flexGrow: stage.value,
                    height: 22,
                    borderRadius: "3px",
                    bgcolor: "primary.main",
                    opacity: stage.shade,
                  }}
                />
              </Tooltip>
            ),
          )}
        </Box>

        <Stack direction="row" spacing={2.5} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          {counts.map((stage) => (
            <Stack key={stage.key} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "2px",
                  bgcolor: "primary.main",
                  opacity: stage.shade,
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {stage.value} {stage.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
