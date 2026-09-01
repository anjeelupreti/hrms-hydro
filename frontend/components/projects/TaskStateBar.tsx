"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { ProjectTask, TaskStatus } from "@/types/projects";

/**
 * Where the work stands, as one bar rather than a single percentage.
 *
 * Counts by state, not "12 of 38 done" over a plain progress bar — that
 * collapses five states into two and hides the one that matters. A project 30%
 * done with nothing blocked is healthy; one 30% done with nine blocked tasks is
 * stuck, and a single bar draws them identically.
 *
 * **Ordered by workflow, not by size.** Left to right is the path a task takes,
 * so the shape of the bar reads as a pipeline: weight piling up on the left is a
 * backlog, weight in the middle is work in flight. Sorting the segments by count
 * would make the same project draw differently week to week for no reason.
 *
 * **One accent, stepped — except where attention is owed.** Progress is an
 * ordinal scale, so it takes one hue deepening along the path rather than five
 * unrelated colours. Blocked is the exception and gets the error hue, because it
 * is the only state that is a problem rather than a stage.
 */

/** In workflow order. The order is the encoding — see above. */
const FLOW: { status: TaskStatus; label: string; tint: string }[] = [
  { status: "todo", label: "To do", tint: "color-mix(in srgb, var(--mui-palette-primary-main) 18%, var(--mui-palette-background-paper))" },
  { status: "in_progress", label: "In progress", tint: "color-mix(in srgb, var(--mui-palette-primary-main) 45%, var(--mui-palette-background-paper))" },
  { status: "in_review", label: "In review", tint: "color-mix(in srgb, var(--mui-palette-primary-main) 70%, var(--mui-palette-background-paper))" },
  { status: "done", label: "Done", tint: "var(--mui-palette-primary-main)" },
  // Not a stage. A task here has stopped, and that is the finding.
  { status: "blocked", label: "Blocked", tint: "var(--mui-palette-error-main)" },
];

export default function TaskStateBar({ tasks }: { tasks: ProjectTask[] }) {
  const counts = new Map<TaskStatus, number>();
  for (const task of tasks) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  }

  const total = tasks.length;
  if (total === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No tasks yet
      </Typography>
    );
  }

  const segments = FLOW.filter((state) => (counts.get(state.status) ?? 0) > 0);
  const done = counts.get("done") ?? 0;
  const blocked = counts.get("blocked") ?? 0;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.75 }}>
        <Typography variant="caption" color="text.secondary">
          {done} of {total} done
        </Typography>
        {blocked > 0 && (
          // Said in words as well as colour: a count nobody can read off a bar
          // is a count that only exists for people who already knew to look.
          <Typography variant="caption" sx={{ color: "error.main", fontWeight: 600 }}>
            · {blocked} blocked
          </Typography>
        )}
      </Box>

      <Box
        sx={{
          display: "flex",
          // A 2px gap between segments, so two adjacent tints read as two
          // segments rather than one gradient.
          gap: "2px",
          height: 8,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        {segments.map((state) => {
          const count = counts.get(state.status) ?? 0;
          return (
            <Tooltip key={state.status} arrow title={`${state.label}: ${count}`}>
              <Box
                sx={{
                  flexGrow: count,
                  flexBasis: 0,
                  minWidth: 3,
                  backgroundColor: state.tint,
                }}
              />
            </Tooltip>
          );
        })}
      </Box>

      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mt: 1 }}>
        {segments.map((state) => (
          <Box key={state.status} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "2px",
                backgroundColor: state.tint,
                border: "1px solid",
                borderColor: "divider",
              }}
            />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {state.label}{" "}
              <Box component="span" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                {counts.get(state.status)}
              </Box>
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
