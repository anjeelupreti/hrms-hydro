"use client";

import Card from "@mui/material/Card";

import { analyticsCard } from "@/lib/theme/cards";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";

import RankedBars from "@/components/charts/RankedBars";

/**
 * What people took leave *for*, ranked.
 *
 * Deliberately not the hundred-square waffle used for "attendance this month".
 * A waffle is right where the reader is counting *days out of a month* and the
 * unit is the point; nobody counts leave requests out of a hundred, and the
 * denominator here is however many happened to be filed.
 *
 * Ranked bars instead, one colour per leave type from the theme's categorical
 * ramp — because these are different *kinds* of thing, not amounts of one
 * thing, and stepped opacity says the opposite.
 *
 * (It was briefly a ring, which made two rings on one page. See the note at the
 * call site: fixing sameness by reaching for a second favourite form is not
 * fixing sameness.)
 */
export default function LeaveMix({
  data,
}: {
  data: { leave_type: string; count: number }[];
}) {
  const total = data.reduce((sum, entry) => sum + entry.count, 0);
  const top = [...data].sort((a, b) => b.count - a.count)[0];

  return (
    <Card sx={analyticsCard}>
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Leave this year
        </Typography>
        {/* The finding in words before the marks, as everywhere else. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {total === 0
            ? "No leave requested this year."
            : `${total} request${total === 1 ? "" : "s"} — most of them ${top.leave_type.toLowerCase()}.`}
        </Typography>

        {/* Ranked bars rather than a ring: "headcount by department" already
            owns that form on this page, and bars share a baseline, so *which
            type dominates* is read rather than estimated from arc lengths. */}
        <RankedBars
          items={data.map((entry) => ({ label: entry.leave_type, value: entry.count }))}
          unit="request"
          empty="No leave requested this year."
        />
      </CardContent>
    </Card>
  );
}
