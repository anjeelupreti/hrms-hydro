"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import PersonAvatar from "@/components/common/PersonAvatar";
import type { KeyResult, Objective } from "@/hooks/useGoals";

/**
 * The objectives as a roadmap, with each key result as a milestone.
 *
 * Draws OKRs as what they are: a period, the objectives in it, and under each
 * one a set of measures moving from a starting number to a target — `period`
 * and `start_value`/`current_value`/`target_value` per key result. A card with
 * one rolled-up percentage on it discards all of that.
 *
 * **Lanes are periods, not dates.** `period` is a label — "Q3 2026", "FY2026" —
 * not a range, so there is no honest way to place an objective on a calendar.
 * Inventing start and end dates to draw a Gantt would be a chart asserting
 * something nobody entered. Periods are lanes; within a lane the ordering is by
 * how far along each objective is, which is the comparison that exists.
 *
 * **Each key result is a track from its own start to its own target.** That is
 * the milestone: 22 of 40 new logos reads as two-thirds of the way along a bar
 * that begins at 0, and net revenue retention starting at 90 and targeting 120
 * is *not* at 90% when it sits at 108 — it is 60% of the way. A progress bar
 * anchored at zero would have got that wrong, which is exactly why the start
 * value is a stored field.
 *
 * **No "at risk" flag.** Without a due date there is no schedule to be behind,
 * and colouring a low percentage red would assert one. An objective is compared
 * against the average of its own period, which is a comparison the data can
 * actually support.
 */

/** Where a key result sits between its own start and its own target. */
function milestonePct(kr: KeyResult) {
  const start = Number(kr.start_value) || 0;
  const target = Number(kr.target_value) || 0;
  const current = Number(kr.current_value) || 0;
  const span = target - start;
  // A target equal to the start cannot be measured against — it is either done
  // or meaningless, and dividing by zero would render either as NaN.
  if (span === 0) return current >= target ? 100 : 0;
  return Math.max(0, Math.min(100, ((current - start) / span) * 100));
}

function number(value: string | number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
}

export default function ObjectiveRoadmap({ objectives }: { objectives: Objective[] }) {
  const live = objectives.filter((o) => o.status !== "cancelled");
  if (live.length === 0) return null;

  // Lanes, most-populated first — the period somebody is actually working in.
  const lanes = new Map<string, Objective[]>();
  for (const objective of live) {
    const key = objective.period || "No period";
    lanes.set(key, [...(lanes.get(key) ?? []), objective]);
  }
  const ordered = [...lanes.entries()]
    .map(([period, items]) => ({
      period,
      items: [...items].sort((a, b) => b.progress - a.progress),
      average: Math.round(items.reduce((sum, o) => sum + o.progress, 0) / items.length),
    }))
    .sort((a, b) => b.items.length - a.items.length);

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.25 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            The roadmap
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {live.length} {live.length === 1 ? "objective" : "objectives"} across{" "}
            {ordered.length} {ordered.length === 1 ? "period" : "periods"}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2.5 }}>
          Each measure runs from where it started to where it is meant to end.
          The marker is where it is now.
        </Typography>

        <Stack spacing={3}>
          {ordered.map((lane) => (
            <Box key={lane.period}>
              {/* The lane header carries the period's own average, which is what
                  an objective inside it is compared against. */}
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  mb: 1.5,
                  pb: 0.75,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main" }} />
                <Typography sx={{ fontWeight: 800, fontSize: "0.9rem" }}>{lane.period}</Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {lane.items.length} {lane.items.length === 1 ? "objective" : "objectives"} ·
                  averaging {lane.average}%
                </Typography>
              </Stack>

              <Stack spacing={2.25}>
                {lane.items.map((objective) => {
                  const delta = objective.progress - lane.average;
                  return (
                    <Box key={objective.id}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.75 }}>
                        <PersonAvatar name={objective.owner_name || "—"} size={22} />
                        <Typography
                          sx={{ fontWeight: 700, fontSize: "0.88rem", flexGrow: 1, minWidth: 0 }}
                          noWrap
                          title={objective.title}
                        >
                          {objective.title}
                        </Typography>
                        <Typography
                          sx={{
                            fontWeight: 800,
                            fontSize: "0.88rem",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {objective.progress}%
                        </Typography>
                        {/* Against its own period, not against a target nobody
                            set. Suppressed within 5 points, where the
                            difference is noise. */}
                        {Math.abs(delta) >= 5 ? (
                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                              color:
                                delta > 0
                                  ? "var(--hrms-status-good-fg)"
                                  : "var(--hrms-status-warning-fg)",
                            }}
                          >
                            {delta > 0 ? "+" : ""}
                            {delta} vs period
                          </Typography>
                        ) : null}
                      </Stack>

                      {objective.key_results.length === 0 ? (
                        // The page's copy says progress is "measured rather
                        // than asserted". An objective with no key
                        // results has nothing to measure, and saying so is more
                        // use than drawing it at zero beside things that are
                        // genuinely stuck.
                        <Typography variant="caption" color="text.disabled" sx={{ pl: 3.75 }}>
                          No measures — this percentage is asserted, not measured.
                        </Typography>
                      ) : (
                        <Stack spacing={0.9} sx={{ pl: 3.75 }}>
                          {objective.key_results.map((kr, index) => {
                            const pct = milestonePct(kr);
                            const done = pct >= 100;
                            return (
                              <Box key={kr.id ?? index}>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{ alignItems: "baseline", mb: 0.25 }}
                                >
                                  <Typography
                                    variant="caption"
                                    sx={{ flexGrow: 1, minWidth: 0, color: "text.secondary" }}
                                    noWrap
                                    title={kr.title}
                                  >
                                    {kr.title}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      fontWeight: 700,
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {number(kr.current_value)} / {number(kr.target_value)}
                                    {kr.unit ? ` ${kr.unit}` : ""}
                                  </Typography>
                                </Stack>

                                <Tooltip
                                  title={`Started at ${number(kr.start_value)}${
                                    kr.unit ? ` ${kr.unit}` : ""
                                  } — ${Math.round(pct)}% of the way to target`}
                                >
                                  <Box sx={{ position: "relative", height: 14 }}>
                                    {/* The track: start on the left, target on
                                        the right. */}
                                    <Box
                                      sx={{
                                        position: "absolute",
                                        left: 0,
                                        right: 0,
                                        top: 6,
                                        height: 2,
                                        borderRadius: 1,
                                        bgcolor: "action.hover",
                                      }}
                                    />
                                    <Box
                                      sx={{
                                        position: "absolute",
                                        left: 0,
                                        top: 6,
                                        height: 2,
                                        width: `${pct}%`,
                                        borderRadius: 1,
                                        bgcolor: done
                                          ? "var(--hrms-status-good-solid)"
                                          : "primary.main",
                                      }}
                                    />
                                    {/* The milestone marker — where it is now. */}
                                    <Box
                                      sx={{
                                        position: "absolute",
                                        left: `${pct}%`,
                                        top: 1,
                                        width: 12,
                                        height: 12,
                                        ml: "-6px",
                                        borderRadius: "50%",
                                        border: "2px solid",
                                        borderColor: "background.paper",
                                        boxShadow: 1,
                                        bgcolor: done
                                          ? "var(--hrms-status-good-solid)"
                                          : "primary.main",
                                      }}
                                    />
                                    {/* The target pin, so "the end" is a place
                                        on the track rather than a number in the
                                        label. */}
                                    <Box
                                      sx={{
                                        position: "absolute",
                                        right: 0,
                                        top: 2,
                                        width: 2,
                                        height: 10,
                                        borderRadius: 1,
                                        bgcolor: "text.disabled",
                                      }}
                                    />
                                  </Box>
                                </Tooltip>
                              </Box>
                            );
                          })}
                        </Stack>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
