"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { analyticsCard } from "@/lib/theme/cards";
import { useRecruitmentSummary } from "@/hooks/useRecruitment";

/**
 * Where the candidates are, stage by stage.
 *
 * Where the hiring pipeline stands, on the company dashboard.
 *
 * **Not a funnel, despite the name.** `by_stage` counts candidates *currently
 * sitting in* each stage — a snapshot, not a cohort. A funnel asserts each
 * stage is a subset of the one before it, so pass-through rates printed between
 * the bars produce things like "↓ 133%" the moment four people have moved on
 * out of Applied while three remain in it: the arithmetic is fine and the
 * concept is false.
 *
 * So: **where the pipeline stands right now**, in stage order. The order is
 * still the information — applied → screening → interview → offer → hired is a
 * sequence and sorting it by size would destroy that — but nothing here claims
 * a conversion rate, because this data cannot support one. Measuring drop-off
 * needs stage *transitions* over a period, which the endpoint does not return
 * and which would be a different card.
 *
 * **Declined is kept out and named beside it.** Somebody who took a
 * counter-offer did not fail your interview; folding them into a rejection
 * count flatters the process and hides a real signal — the model's own `Stage`
 * comment makes exactly this point.
 */

const FUNNEL = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
] as const;

export default function HiringFunnel() {
  const [active, setActive] = useState<number | null>(null);
  // `summary` is an action on `JobPostingViewSet`, so the route is
  // `recruitment/jobs/summary` — not `recruitment/candidates/summary`.
  //
  // The query key is shared with `useRecruitmentSummary`, which means a wrong
  // URL here would be masked: React Query would hand this component the other
  // one's cached answer and the failing request would change nothing visible
  // until that hook stopped being called.
  //
  // Two components sharing a key while asking different URLs is the fault. One
  // hook now, the one that was already right.
  const { data, isLoading } = useRecruitmentSummary();

  if (isLoading) return <Skeleton variant="rounded" height={268} />;
  if (!data) return null;

  const stages = FUNNEL.map((stage) => ({ ...stage, value: data.by_stage[stage.key] ?? 0 }));
  const top = Math.max(1, ...stages.map((s) => s.value));
  const declined = data.by_stage.declined ?? 0;
  const rejected = data.by_stage.rejected ?? 0;

  // Where the most people are waiting. Not "where they fall away" — that is a
  // transition, and this endpoint reports occupancy.
  const inFlight = stages.slice(0, 4).reduce((sum, s) => sum + s.value, 0);
  const busiest = [...stages.slice(0, 4)].sort((a, b) => b.value - a.value)[0];

  return (
    <Card sx={analyticsCard}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Where candidates are
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {data.open_positions} open {data.open_positions === 1 ? "role" : "roles"}
          </Typography>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {data.total_candidates === 0
            ? "No candidates yet."
            : inFlight === 0
              ? `Nobody is in the pipeline — ${data.hired} hired.`
              : `${inFlight} in play, most of them at ${busiest.label.toLowerCase()}.`}
        </Typography>

        <Stack spacing={0.4} sx={{ flexGrow: 1 }} onMouseLeave={() => setActive(null)}>
          {stages.map((stage, index) => {
            const width = (stage.value / top) * 100;

            return (
              <Box key={stage.key} onMouseEnter={() => setActive(index)}>

                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography
                    variant="caption"
                    sx={{ width: 66, flexShrink: 0, fontWeight: active === index ? 800 : 600 }}
                  >
                    {stage.label}
                  </Typography>
                  <Box sx={{ flexGrow: 1, minWidth: 0, position: "relative", height: 20 }}>
                    <Box
                      sx={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: 1,
                        bgcolor: "action.hover",
                      }}
                    />
                    <Box
                      sx={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        // Left-aligned, not centre-tapered. A taper makes
                        // this read as a funnel, which is a claim this data
                        // cannot support — it would imply a narrowing that
                        // occupancy counts do not describe.
                        width: `${Math.max(width, 3)}%`,
                        borderRadius: 1,
                        background:
                          "linear-gradient(90deg, var(--hrms-module-recruitment), color-mix(in srgb, var(--hrms-module-recruitment) 55%, transparent))",
                        opacity: active !== null && active !== index ? 0.4 : 1,
                        transition: "opacity .18s",
                      }}
                    />
                  </Box>
                  <Typography
                    sx={{
                      width: 26,
                      flexShrink: 0,
                      textAlign: "right",
                      fontSize: 12.5,
                      fontWeight: 800,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {stage.value}
                  </Typography>
                </Stack>
              </Box>
            );
          })}
        </Stack>

        {declined + rejected > 0 ? (
          <Typography variant="caption" sx={{ color: "text.disabled", mt: 1.25, display: "block" }}>
            {declined > 0 ? `${declined} declined our offer` : null}
            {declined > 0 && rejected > 0 ? " · " : null}
            {rejected > 0 ? `${rejected} not taken forward` : null}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}
