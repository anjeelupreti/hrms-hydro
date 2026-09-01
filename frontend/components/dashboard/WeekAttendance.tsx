"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Columns from "@/components/charts/Columns";
import { analyticsCard } from "@/lib/theme/cards";
import type { AttendanceTrendPoint } from "@/types/dashboard";

/**
 * How many people were in, each day this week.
 *
 * Three readings from one glance: how many turned up, how many of those were
 * late, and which day was thinnest.
 *
 * Columns rather than a dot per person. At 88 people a dot grid is 616
 * four-pixel marks across seven columns, which asks the reader to judge a count
 * by area — and nobody counts dots, so the column height ends up carrying the
 * signal anyway.
 *
 * Late is a sub-total, not a second series: somebody late was still at work.
 * It is hatched into the foot of the day's own column, because a bar beside it
 * would invite adding 77 present to 12 late and reading 89 people out of 88.
 * The hatch is a texture rather than a second hue for the same reason — a new
 * colour announces a new category, and these are the same people counted a
 * second way.
 *
 * Closed days are hollow, not zero. A weekend column at zero reads as a
 * catastrophic day; an outline reads as "nobody was expected".
 */
export default function WeekAttendance({ data }: { data: AttendanceTrendPoint[] }) {
  const days = data.slice(-7);

  if (days.length === 0) {
    return (
      <Card sx={analyticsCard}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            This week
          </Typography>
          <Typography variant="caption" color="text.secondary">
            No attendance recorded yet.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  // A day nobody was expected has no present, no absent and no late. Marking it
  // "closed" rather than zero is the same distinction the hero panel makes.
  const isClosed = (day: AttendanceTrendPoint) =>
    day.present === 0 && day.absent === 0 && !day.late;

  const worked = days.filter((day) => !isClosed(day));
  const thinnest = worked.length
    ? worked.reduce((low, day) => (day.present < low.present ? day : low))
    : null;
  const totalLate = worked.reduce((sum, day) => sum + (day.late ?? 0), 0);

  const columns = days.map((day) => {
    const parsed = new Date(`${day.date}T00:00:00`);
    const late = day.late ?? 0;
    return {
      label: parsed.toLocaleDateString(undefined, { weekday: "short" }),
      // Local date parts, not `toISOString()`: the bucket is a calendar
      // day, and UTC would shift it for readers west of the company.
      sub: `${parsed.getDate()}/${String(parsed.getMonth() + 1).padStart(2, "0")}`,
      value: day.present,
      empty: isClosed(day),
      // A share of the column, never a column of its own. See `Column.part`.
      part: late > 0 ? { value: late, label: "late" } : undefined,
    };
  });

  return (
    <Card sx={analyticsCard}>
      <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            This week
          </Typography>
          <Typography variant="caption" color="text.secondary">
            people in, by day
          </Typography>
        </Stack>

        {/* The finding in words before the marks — the same discipline the rest
            of the dashboard's cards use. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {thinnest
            ? `${new Date(`${thinnest.date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
              })} was thinnest at ${thinnest.present}${
                totalLate ? ` · ${totalLate} late arrivals across the week` : ""
              }`
            : "Nothing was worked this week."}
        </Typography>

        <Box sx={{ flexGrow: 1, display: "flex", alignItems: "flex-end" }}>
          <Box sx={{ width: "100%" }}>
            <Columns
              data={columns}
              height={190}
              badge={(column) =>
                column.empty
                  ? `${column.label} — closed`
                  : column.part
                    ? `${column.label} — ${column.value} in, ${column.part.value} late`
                    : `${column.label} — ${column.value} in`
              }
            />

            {/* The key for the hatch. A texture without a key is
                decoration. Shown only when there is a hatch to explain. */}
            {totalLate > 0 ? (
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mt: 1.25 }}>
                <Box
                  aria-hidden
                  sx={{
                    width: 14,
                    height: 10,
                    borderRadius: "2px",
                    bgcolor: "var(--hrms-data-1)",
                    backgroundImage:
                      "repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 3px, transparent 3px 6px)",
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" sx={{ color: "text.disabled" }}>
                  hatched = arrived late, counted within the day&apos;s total
                </Typography>
              </Stack>
            ) : null}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
