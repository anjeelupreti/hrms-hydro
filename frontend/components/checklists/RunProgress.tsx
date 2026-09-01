"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import type { Checklist } from "@/types/checklists";

/**
 * Where onboarding is stuck, and who is stuck behind it.
 *
 * Deliberately not a scatter of age against completion. That pairing is right
 * — 20% opened yesterday is fine, 80% opened a month ago has a person waiting —
 * but a scatter needs a population to read as a shape, and a company onboards
 * two or five people at a time: five dots in a 240px frame is a chart you have
 * to hover to identify, on a page where every dot is a named colleague.
 *
 * **The question it answers instead is the one HR actually asks: which *step*
 * is everybody stuck at.** Runs share a template, so the same task title
 * appears across them — "Issue laptop" pending on four of five runs is a
 * bottleneck with a name and an owner, which no amount of plotting completion
 * against age would ever have surfaced. That aggregation was available the whole
 * time in `checklist.tasks`.
 *
 * Two readings, in the order they are useful:
 *
 * * **The bottleneck** — every outstanding step, ranked by how many people are
 *   waiting on it. This is the fix-one-thing-help-four view.
 * * **The people** — each run as a row with its progress, its age and what is
 *   wrong with it. Named, because an onboarding is a person.
 *
 * A task with no assignee has nobody to chase, and unlike a late task no amount
 * of following up fixes it — so it is counted and called out separately.
 */

function ageInDays(createdAt: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 86_400_000));
}

/** Past this, an open run is worth a second look rather than an alarm. */
const STALE_DAYS = 14;

export default function RunProgress({ checklists }: { checklists: Checklist[] }) {
  // Once per mount: a clock read during render is unstable across re-renders
  // and disagrees between the server render and the client's first one.
  const [now] = useState(() => Date.now());

  const active = checklists.filter((c) => c.status === "active");
  if (active.length === 0) return null;

  const rows = active
    .map((checklist) => ({
      checklist,
      age: ageInDays(checklist.created_at, now),
      unassigned: checklist.tasks.filter((t) => t.status === "pending" && t.assignee === null).length,
      overdue: checklist.tasks.filter(
        (t) =>
          t.status === "pending" &&
          t.due_date !== null &&
          new Date(`${t.due_date}T23:59:59`).getTime() < now,
      ).length,
    }))
    .sort((a, b) => b.age - a.age);

  // The bottleneck: one entry per outstanding step, counting the people waiting.
  const steps = new Map<string, { waiting: number; unassigned: number; overdue: number }>();
  for (const row of rows) {
    for (const task of row.checklist.tasks) {
      if (task.status === "done") continue;
      const entry = steps.get(task.title) ?? { waiting: 0, unassigned: 0, overdue: 0 };
      entry.waiting += 1;
      if (task.assignee === null) entry.unassigned += 1;
      if (
        task.due_date !== null &&
        new Date(`${task.due_date}T23:59:59`).getTime() < now
      ) {
        entry.overdue += 1;
      }
      steps.set(task.title, entry);
    }
  }
  const bottlenecks = [...steps.entries()]
    .map(([title, v]) => ({ title, ...v }))
    .sort((a, b) => b.waiting - a.waiting || b.overdue - a.overdue)
    .slice(0, 6);

  const unassignedTotal = rows.reduce((sum, r) => sum + r.unassigned, 0);
  const overdueTotal = rows.reduce((sum, r) => sum + r.overdue, 0);
  const worst = bottlenecks[0];
  const oldest = rows[0];
  const mostWaiting = Math.max(1, ...bottlenecks.map((b) => b.waiting));

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            What is still running
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {rows.length} {rows.length === 1 ? "person" : "people"} onboarding
          </Typography>
        </Stack>

        {/* The finding, before the marks. Unassigned leads: it is the only
            failure that chasing cannot fix. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {unassignedTotal > 0
            ? `${unassignedTotal} outstanding ${unassignedTotal === 1 ? "task has" : "tasks have"} nobody assigned — there is no one to chase.`
            : worst && worst.waiting > 1
              ? `${worst.waiting} people are waiting on “${worst.title}”.`
              : oldest.checklist.progress.pct < 100
                ? `“${oldest.checklist.employee_name ?? oldest.checklist.title}” has been open ${oldest.age} day${oldest.age === 1 ? "" : "s"} at ${oldest.checklist.progress.pct}%.`
                : "Everything open is complete and waiting to be closed."}
        </Typography>

        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            alignItems: "start",
          }}
        >
          {/* ── The bottleneck ──────────────────────────────────────────── */}
          <Box>
            <Typography
              variant="overline"
              sx={{ color: "text.disabled", display: "block", mb: 1 }}
            >
              Steps people are waiting on
            </Typography>
            <Stack spacing={1.1}>
              {bottlenecks.map((step) => (
                <Box key={step.title}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 0.35 }}>
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }}
                      noWrap
                      title={step.title}
                    >
                      {step.title}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}
                    >
                      {step.waiting}
                    </Typography>
                  </Stack>
                  <Tooltip
                    title={
                      step.unassigned > 0
                        ? `${step.unassigned} of these have nobody assigned`
                        : step.overdue > 0
                          ? `${step.overdue} of these are past their date`
                          : `${step.waiting} waiting`
                    }
                  >
                    <Box
                      sx={{
                        position: "relative",
                        height: 8,
                        borderRadius: 1,
                        bgcolor: "action.hover",
                        overflow: "hidden",
                      }}
                    >
                      <Box
                        sx={{
                          position: "absolute",
                          inset: 0,
                          width: `${(step.waiting / mostWaiting) * 100}%`,
                          borderRadius: 1,
                          // Unassigned is the worse state and wins the colour:
                          // an overdue task has somebody to ask, an unassigned
                          // one does not.
                          bgcolor:
                            step.unassigned > 0
                              ? "var(--hrms-status-serious-solid)"
                              : step.overdue > 0
                                ? "var(--hrms-status-warning-solid)"
                                : "primary.main",
                        }}
                      />
                    </Box>
                  </Tooltip>
                </Box>
              ))}
            </Stack>
            {/* The legend is two words rather than a key, because there are
                only two exceptional states and both are named on the bar. */}
            {unassignedTotal > 0 || overdueTotal > 0 ? (
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1.25 }}>
                {unassignedTotal > 0 ? `${unassignedTotal} unassigned` : null}
                {unassignedTotal > 0 && overdueTotal > 0 ? " · " : null}
                {overdueTotal > 0 ? `${overdueTotal} past their date` : null}
              </Typography>
            ) : null}
          </Box>

          {/* ── The people ──────────────────────────────────────────────── */}
          <Box>
            <Typography
              variant="overline"
              sx={{ color: "text.disabled", display: "block", mb: 1 }}
            >
              Who is mid-onboarding
            </Typography>
            <Stack spacing={1.25}>
              {rows.slice(0, 6).map((row) => {
                const stale = row.age > STALE_DAYS && row.checklist.progress.pct < 100;
                return (
                  <Box key={row.checklist.id}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 0.35 }}>
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }}
                        noWrap
                      >
                        {row.checklist.employee_name ?? row.checklist.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 700,
                          // Age is what makes a completion figure bad, so it is
                          // the part that changes colour.
                          color: stale ? "var(--hrms-status-warning-fg)" : "text.disabled",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.age}d · {row.checklist.progress.pct}%
                      </Typography>
                    </Stack>
                    <Box
                      sx={{
                        position: "relative",
                        height: 8,
                        borderRadius: 1,
                        bgcolor: "action.hover",
                        overflow: "hidden",
                      }}
                    >
                      <Box
                        sx={{
                          position: "absolute",
                          inset: 0,
                          width: `${row.checklist.progress.pct}%`,
                          borderRadius: 1,
                          bgcolor: stale ? "var(--hrms-status-warning-solid)" : "primary.main",
                        }}
                      />
                    </Box>
                    {row.unassigned > 0 || row.overdue > 0 ? (
                      <Typography variant="caption" color="text.disabled">
                        {row.unassigned > 0 ? `${row.unassigned} unassigned` : null}
                        {row.unassigned > 0 && row.overdue > 0 ? " · " : null}
                        {row.overdue > 0 ? `${row.overdue} overdue` : null}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </Stack>
            {rows.length > 6 ? (
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>
                +{rows.length - 6} more below
              </Typography>
            ) : null}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
