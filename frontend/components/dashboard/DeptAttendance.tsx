"use client";

import Card from "@mui/material/Card";

import { analyticsCard } from "@/lib/theme/cards";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import CardEmpty from "@/components/dashboard/CardEmpty";

import RateDots from "@/components/charts/RateDots";
import type { AttendanceHeatmap } from "@/types/dashboard";

/**
 * Which team is thin, and on which days.
 *
 * Answers "who is struggling?" directly. A heatmap of department against day,
 * shaded by rate, makes that question a matter of comparing greys across a grid
 * — and a caption underneath naming the answer in words is the giveaway that
 * the chart did not.
 *
 * **Ranked, worst first.** The order carries the finding. A department list in
 * alphabetical order is a directory; in attendance order it is a priority list,
 * and nothing else has to change for it to be useful.
 *
 * **The daily detail survives.** Each row keeps its run of days as dots, so the
 * distinction the heatmap was right about — a team that had one bad Wednesday
 * versus one that is thin every day — is still visible. It just is not the only
 * thing on offer any more.
 *
 * **Non-working days are gaps, not zeroes.** `null` means nothing was logged —
 * a weekend or a holiday — and drawing that as 0% would accuse a whole
 * department of not turning up. The underlying payload is explicit about this
 * and the old rendering honoured it; so does this one.
 */

function average(cells: (number | null)[]) {
  const logged = cells.filter((c): c is number => c !== null);
  if (!logged.length) return null;
  return logged.reduce((sum, c) => sum + c, 0) / logged.length;
}

export default function DeptAttendance({ data }: { data: AttendanceHeatmap }) {
  const rows = (data?.rows ?? [])
    .map((row) => ({ ...row, mean: average(row.cells) }))
    .filter((row) => row.mean !== null)
    .sort((a, b) => (a.mean as number) - (b.mean as number));

  const worst = rows[0];
  const days = data?.days ?? [];

  return (
    <Card sx={analyticsCard}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.25 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Attendance by team
          </Typography>
          <Typography variant="caption" color="text.secondary">
            last {days.length} days
          </Typography>
        </Stack>

        {/* The finding, in words, before the marks. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {rows.length === 0
            ? "Nothing logged yet."
            : worst && (worst.mean as number) < 95
              ? `${worst.department} is thinnest at ${Math.round(worst.mean as number)}%.`
              : "Every team is above 95%."}
        </Typography>

        {rows.length === 0 ? (
          <CardEmpty>Nothing has been logged for any team in this period.</CardEmpty>
        ) : (
          /* Dots, not columns, and that is not a style choice. These rates
             sit between 87% and 100%; a bar must start at zero — that is what
             makes its *length* mean the value — so teams within a few points of
             each other draw near-identical bars. A dot encodes *position*, so
             it may sit on a truncated scale provided the floor is drawn and
             labelled. `RateDots` does both. */
          <RateDots
            rows={rows.map((row) => ({
              label: row.department,
              value: row.mean,
              sub: `${row.cells.filter((c) => c !== null).length} days logged`,
            }))}
            empty="Nothing has been logged for any team in this period."
          />
        )}
      </CardContent>
    </Card>
  );
}
