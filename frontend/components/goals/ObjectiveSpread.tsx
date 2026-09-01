"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { Objective } from "@/hooks/useGoals";

/**
 * Where the objectives have got to — and which ones cannot answer the question.
 *
 * **The page's own copy says "progress is measured rather than asserted".** An
 * objective with no key results has nothing to measure, so its progress is
 * whatever the page decides to print — usually 0%, indistinguishable from an
 * objective that is genuinely stuck. That is the one fact worth leading with,
 * because it is the only one nobody can see by scrolling: a list of objectives
 * looks identical whether or not any of them are measurable.
 *
 * **A row of ticks, not a bar chart of four buckets.** Each objective is one
 * mark placed at its own progress, so the shape of the year is visible —
 * clustered near done, spread evenly, or piled at zero — and no bucket
 * boundary is invented to make that shape up. Bucketing 0–25/26–50/51–75/76–100
 * would put an objective at 26% and one at 50% in the same box and call them
 * alike.
 *
 * Derived entirely from the list the page already loaded. No second request,
 * and nothing here can disagree with the rows underneath it.
 */

export default function ObjectiveSpread({ objectives }: { objectives: Objective[] }) {
  const active = objectives.filter((o) => o.status === "active");
  if (active.length === 0) return null;

  const unmeasurable = active.filter((o) => (o.key_results?.length ?? 0) === 0);
  const done = active.filter((o) => o.progress >= 100);
  const notStarted = active.filter((o) => o.progress === 0 && (o.key_results?.length ?? 0) > 0);

  const mean = Math.round(active.reduce((sum, o) => sum + o.progress, 0) / active.length);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Where the objectives stand
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {active.length} active · {mean}% average
          </Typography>
        </Stack>

        {/* The finding, in words, before the marks — and the unmeasurable ones
            come first because they are the only failure the list cannot show. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2.5 }}>
          {unmeasurable.length > 0
            ? `${unmeasurable.length} objective${unmeasurable.length === 1 ? " has" : "s have"} no key results, so ${unmeasurable.length === 1 ? "its" : "their"} progress is not measured — it is assumed.`
            : done.length === active.length
              ? "Every objective is complete."
              : notStarted.length > 0
                ? `${notStarted.length} of ${active.length} have not moved off zero.`
                : "Every objective has movement against it."}
        </Typography>

        {/* One tick per objective, placed at its progress. */}
        <Box sx={{ position: "relative", height: 40, mb: 0.5 }}>
          <Box
            sx={{
              position: "absolute",
              top: 18,
              left: 0,
              right: 0,
              height: 2,
              bgcolor: "divider",
              borderRadius: 1,
            }}
          />
          {active.map((objective) => {
            const measurable = (objective.key_results?.length ?? 0) > 0;
            return (
              <Tooltip
                key={objective.id}
                title={`${objective.title} — ${objective.progress}%${measurable ? "" : " (no key results)"}`}
              >
                <Box
                  sx={{
                    position: "absolute",
                    // Clamped so 0% and 100% stay on the page rather than
                    // hanging half off each end.
                    left: `calc(${Math.min(Math.max(objective.progress, 0), 100)}% - 5px)`,
                    top: 9,
                    width: 10,
                    height: 20,
                    borderRadius: "3px",
                    // An unmeasurable objective is drawn hollow: it is a claim,
                    // not a measurement, and it should not look like one.
                    ...(measurable
                      ? { bgcolor: "primary.main", opacity: 0.75 }
                      : {
                          border: "1.5px dashed",
                          borderColor: "var(--hrms-status-warning-solid)",
                          bgcolor: "transparent",
                        }),
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>

        <Stack direction="row" sx={{ justifyContent: "space-between", mb: 2 }}>
          <Typography variant="caption" color="text.disabled">
            0%
          </Typography>
          <Typography variant="caption" color="text.disabled">
            100%
          </Typography>
        </Stack>

        <Stack direction="row" spacing={2.5} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <Box sx={{ width: 10, height: 14, borderRadius: "3px", bgcolor: "primary.main", opacity: 0.75 }} />
            <Typography variant="caption" color="text.secondary">
              measured against key results
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                width: 10,
                height: 14,
                borderRadius: "3px",
                border: "1.5px dashed",
                borderColor: "var(--hrms-status-warning-solid)",
              }}
            />
            <Typography variant="caption" color="text.secondary">
              no key results
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
