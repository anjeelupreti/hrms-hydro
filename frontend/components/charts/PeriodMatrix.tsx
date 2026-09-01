"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import EmptyState from "@/components/common/EmptyState";
import { monthLabel, weekLabel } from "@/lib/format/period";
import { SERIES_HONEST_LIMIT } from "@/lib/theme/tokens";

/**
 * A run of periods against the things that filled them, drawn as a grid.
 *
 * A month-by-category band, used on leave and expenses in place of a stacked
 * bar chart.
 *
 * **The stack's reasoning is sound and is not the point.** Its parts really do
 * sum to the total, each month really is a closed bucket, and bars really are
 * the textbook form. But the question a reader brings to *these* two pages is
 * "when was there a lot, and of what" — magnitude across a grid — and a grid is
 * the sanctioned form for exactly that. Two dimensions read at once, without
 * six colours competing for the same eye.
 *
 * **One hue, stepped light to dark.** Magnitude is a sequential job, so it
 * takes one hue rather than a colour per category — which also means the whole
 * class of "can a colourblind reader separate series 4 from series 5" simply
 * does not arise, because no two cells are ever meant to be told apart by hue.
 * The hue is the company's own accent, so the company's choice reaches this the
 * way it reaches everything else.
 *
 * **Five steps, not a continuous fade.** A continuous ramp invites the reader to
 * compare two mid-tone cells precisely, which is the one thing colour intensity
 * is bad at. Discrete steps say "these two are in the same band" honestly, and
 * the exact number is one hover away.
 *
 * **The numbers are still printed.** Row totals sit at the right in text ink,
 * because intensity answers *where* and a figure answers *how much*, and a
 * chart that only shades leaves the second question to a tooltip nobody opens.
 */

/** How many bands the ramp is cut into. Five reads; nine does not. */
const STEPS = 5;

/** Fill for a cell holding nothing — a faint wash, so the grid stays a grid. */
const EMPTY_TINT = 4;

/** Opacity per band, in percent. Bottom band stays visible; top is solid. */
const BAND_TINT = [16, 34, 55, 78, 100];

/**
 * A bucket's date, as it should be written under its column.
 *
 * Both cases go through `lib/format/period`, which parses a date-only string
 * from its parts rather than through `new Date(iso)` — the constructor reads
 * one as *UTC* midnight while `getMonth()` reads back local, so west of UTC
 * every column here was labelled a month early.
 */
function labelFor(iso: string, bucket: "month" | "week") {
  return bucket === "week" ? weekLabel(iso) : monthLabel(iso);
}

export default function PeriodMatrix({
  periods,
  bucketKey = "month",
  bucket = "month",
  series,
  valueFormatter = (v) => String(v ?? 0),
  emptyTitle,
  emptyDescription,
}: {
  /** Oldest first. Each row carries its date under `bucketKey`, plus a numeric key per series. */
  periods: ({ total: number } & Record<string, number | string>)[];
  /** Which field holds the ISO date — `month` or `week`. */
  bucketKey?: string;
  /** How that date is written along the bottom. */
  bucket?: "month" | "week";
  /** The categories, in the order the caller considers meaningful. */
  series: string[];
  valueFormatter?: (value: number | null) => string;
  emptyTitle: string;
  emptyDescription?: string;
}) {
  const hasData = periods.some((p) => p.total > 0);
  if (!hasData) {
    return <EmptyState title={emptyTitle} description={emptyDescription} compact />;
  }

  // Heaviest category first: the reader's eye starts at the top-left, so the
  // row that matters most should be there rather than wherever the API happened
  // to order it.
  const totals = new Map(
    series.map((name) => [
      name,
      periods.reduce((sum, period) => sum + Number(period[name] ?? 0), 0),
    ])
  );
  const ordered = [...series].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));

  // Past the honest limit the grid becomes a wall of near-identical rows, so
  // the tail folds into one — the same rule the stacked version used, for the
  // same reason.
  const shown = ordered.slice(0, SERIES_HONEST_LIMIT);
  const tail = ordered.slice(SERIES_HONEST_LIMIT);
  const rows: { name: string; values: number[]; total: number }[] = shown.map((name) => ({
    name,
    values: periods.map((p) => Number(p[name] ?? 0)),
    total: totals.get(name) ?? 0,
  }));
  if (tail.length > 0) {
    rows.push({
      name: `Other (${tail.length})`,
      values: periods.map((p) => tail.reduce((sum, name) => sum + Number(p[name] ?? 0), 0)),
      total: tail.reduce((sum, name) => sum + (totals.get(name) ?? 0), 0),
    });
  }

  // One scale across the whole grid. Scaling each row to its own maximum is the
  // standard way to make a matrix lie: a quiet category would shade as darkly
  // as a busy one.
  const peak = Math.max(1, ...rows.flatMap((row) => row.values));

  function band(value: number) {
    if (value <= 0) return -1;
    return Math.min(STEPS - 1, Math.floor(((value / peak) * STEPS * 0.999999)));
  }

  function tint(value: number) {
    const index = band(value);
    const percent = index < 0 ? EMPTY_TINT : BAND_TINT[index];
    // `color-mix` against the paper rather than an alpha on the accent: an
    // alpha would let whatever sits behind the card show through the pale
    // bands, and these grids sit on two different surfaces already.
    return `color-mix(in srgb, var(--mui-palette-primary-main) ${percent}%, var(--mui-palette-background-paper))`;
  }

  return (
    <Box>
      <Box sx={{ overflowX: "auto" }}>
        <Box
          sx={{
            display: "grid",
            // Label · one track per period · total.
            gridTemplateColumns: `minmax(7rem, max-content) repeat(${periods.length}, minmax(1.6rem, 1fr)) minmax(3rem, max-content)`,
            gap: "3px",
            alignItems: "center",
            minWidth: `${periods.length * 2.2 + 12}rem`,
          }}
        >
          {rows.map((row) => (
            <Box key={row.name} sx={{ display: "contents" }}>
              <Typography
                variant="body2"
                noWrap
                title={row.name}
                sx={{ color: "text.secondary", pr: 1, textTransform: "capitalize" }}
              >
                {row.name}
              </Typography>

              {row.values.map((value, index) => (
                <Tooltip
                  key={index}
                  arrow
                  title={`${row.name} · ${labelFor(String(periods[index][bucketKey]), bucket)} · ${valueFormatter(value)}`}
                >
                  <Box
                    sx={{
                      // Fixed height, not `aspect-ratio: 1`: against a track
                      // that grows with the container, square cells reach ~75px
                      // tall on a wide screen and become a wall of colour
                      // dominating the page they summarise. A matrix is a band
                      // you scan, so only the width breathes.
                      height: 30,
                      borderRadius: "4px",
                      backgroundColor: tint(value),
                      // A hairline so an empty cell still reads as a cell
                      // rather than as a hole in the grid.
                      border: "1px solid",
                      borderColor: "divider",
                      transition: "outline-color 120ms",
                      outline: "2px solid transparent",
                      outlineOffset: 1,
                      "&:hover": { outlineColor: "var(--mui-palette-primary-main)" },
                    }}
                  />
                </Tooltip>
              ))}

              {/* Intensity answers *where*; this answers *how much*. */}
              <Typography
                variant="body2"
                sx={{
                  color: "text.primary",
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                  fontWeight: 600,
                  pl: 1,
                }}
              >
                {valueFormatter(row.total)}
              </Typography>
            </Box>
          ))}

          {/* The period axis, under the grid it describes. */}
          <Box />
          {periods.map((period, index) => (
            <Typography
              key={index}
              variant="caption"
              sx={{ color: "text.disabled", textAlign: "center", fontSize: 10 }}
            >
              {labelFor(String(period[bucketKey]), bucket)}
            </Typography>
          ))}
          <Box />
        </Box>
      </Box>

      {/* The sequential legend: the ramp itself, labelled at its ends. There is
          no category legend because there are no category colours — the row
          label carries identity, which is why this form needs no key. */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 2, justifyContent: "flex-end" }}>
        <Typography variant="caption" sx={{ color: "text.disabled" }}>
          less
        </Typography>
        {BAND_TINT.map((percent) => (
          <Box
            key={percent}
            sx={{
              width: 14,
              height: 14,
              borderRadius: "3px",
              border: "1px solid",
              borderColor: "divider",
              backgroundColor: `color-mix(in srgb, var(--mui-palette-primary-main) ${percent}%, var(--mui-palette-background-paper))`,
            }}
          />
        ))}
        <Typography variant="caption" sx={{ color: "text.disabled" }}>
          more
        </Typography>
      </Box>
    </Box>
  );
}
