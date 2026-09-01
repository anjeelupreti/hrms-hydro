"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import EmptyState from "@/components/common/EmptyState";

/**
 * A funnel — ordered stages, and where people fall out of them.
 *
 * **Not a bar chart with the bars sorted.** A funnel's stages have a fixed
 * order that comes from the process, not from the data, and a stage that has
 * *grown* relative to the one before it is a fact worth seeing rather than a
 * row to re-sort. Sorting by size would also let the shape change every time
 * somebody moved a card, which is the opposite of what a funnel is for.
 *
 * **Two numbers per stage, and they answer different questions.** The count is
 * how many are there now; the percentage is how many of the *previous* stage
 * survived to it. The second is where a hiring process actually leaks, and it
 * is invisible in a column of counts — 40 → 38 → 4 → 3 has one catastrophic
 * step in it and three unremarkable ones, and only the conversion figure says
 * which is which.
 *
 * **Bars are scaled to the first stage, not to the largest.** A funnel is read
 * as "of everyone who applied, this many got here", so the top stage is the
 * whole width by definition. Scaling to the maximum would make an unusual
 * mid-funnel bulge redraw every bar above it.
 */

export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  /** Terminal stages — hired, rejected — read differently from live ones. */
  tone?: "default" | "success" | "muted";
};

export default function FunnelBars({
  stages,
  emptyTitle = "Nobody in the pipeline yet",
  emptyDescription,
}: {
  stages: FunnelStage[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const top = stages.length ? stages[0].count : 0;

  if (!stages.length || stages.every((s) => s.count === 0)) {
    return <EmptyState compact title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <Stack spacing={1.25}>
      {stages.map((stage, index) => {
        // Of the stage before it — not of the total. "Half of everyone who was
        // screened got an interview" is the sentence a hiring manager acts on.
        const previous = index > 0 ? stages[index - 1].count : null;
        const conversion =
          previous && previous > 0 ? Math.round((stage.count / previous) * 100) : null;
        const width = top > 0 ? Math.max((stage.count / top) * 100, stage.count > 0 ? 2 : 0) : 0;

        return (
          <Box key={stage.key}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.5 }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
                {stage.label}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexShrink: 0 }}>
                <Typography className="hrms-num" variant="body2" sx={{ fontWeight: 700 }}>
                  {stage.count}
                </Typography>
                {/* Only where there is a previous stage to convert *from*. On
                    the first row this would be a meaningless 100%. */}
                {conversion !== null ? (
                  <Tooltip title={`${conversion}% of ${stages[index - 1].label}`}>
                    <Typography
                      className="hrms-num"
                      variant="caption"
                      sx={{
                        color: conversion < 25 ? "warning.main" : "text.secondary",
                        fontWeight: conversion < 25 ? 700 : 400,
                        minWidth: 34,
                        textAlign: "right",
                      }}
                    >
                      {conversion}%
                    </Typography>
                  </Tooltip>
                ) : (
                  <Box sx={{ minWidth: 34 }} />
                )}
              </Stack>
            </Stack>

            <Box
              sx={{
                height: 10,
                borderRadius: 999,
                bgcolor: "action.hover",
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  height: "100%",
                  width: `${width}%`,
                  borderRadius: 999,
                  transition: (t) =>
                    `width ${t.hrms.motion.duration.normal}ms ${t.hrms.motion.easing.standard}`,
                  bgcolor:
                    stage.tone === "success"
                      ? "var(--hrms-status-success-solid)"
                      : stage.tone === "muted"
                        ? "text.disabled"
                        : "primary.main",
                }}
              />
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
