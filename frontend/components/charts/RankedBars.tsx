"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { foldSeries, seriesColor } from "@/lib/theme/chartSeries";

/**
 * Ranked horizontal bars — the form for "which of these is biggest".
 *
 * Bars share a baseline, so their order is read directly. A ring is the wrong
 * form for this question: comparing arc lengths around a circle is the one
 * comparison people cannot do reliably. Rings answer "what is this made of",
 * and the dashboard already spends that form on headcount by department.
 *
 * Each bar carries its own value in a pill at its right-hand end, so the reader
 * never tracks across a gap to a legend. Under about a fifth of the track there
 * is no room inside the bar and the figure sits just past it instead.
 *
 * Colours come from `seriesColor` and never cycle. Past the eight validated
 * hues `foldSeries` sums the tail into one grey "Other": reusing a hue would
 * paint two different categories identically, which is worse than admitting the
 * palette has run out.
 */

export type RankedItem = { label: string; value: number; colour?: string };

export default function RankedBars({
  items,
  unit,
  empty,
}: {
  items: RankedItem[];
  /** Singular noun for the pill — "request", "day". */
  unit?: string;
  empty: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  // `foldSeries` ranks and caps in one step; the caller's own `colour` is kept
  // where it gave one, because a category with an assigned meaning (a status,
  // a module) must not be recoloured by its position in the ranking.
  const assigned = new Map(items.filter((i) => i.colour).map((i) => [i.label, i.colour as string]));
  const rows = foldSeries(
    items.filter((i) => i.value > 0),
    (i) => i.value,
    (i) => i.label,
  );
  if (rows.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.disabled", py: 3, textAlign: "center" }}>
        {empty}
      </Typography>
    );
  }

  const max = Math.max(...rows.map((r) => r.value));
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <Stack spacing={1.1} onMouseLeave={() => setActive(null)}>
      {rows.map((row, index) => {
        const isActive = active === index;
        const width = (row.value / max) * 100;
        // Under a fifth of the track there is no room for the pill inside the
        // bar, so it sits just past the end instead of being cropped.
        const inside = width > 22;
        const colour = row.isOther
          ? "var(--mui-palette-text-disabled)"
          : (assigned.get(row.label) ?? seriesColor(index) ?? "var(--mui-palette-text-disabled)");

        return (
          <Box
            key={row.label}
            onMouseEnter={() => setActive(index)}
            sx={{ opacity: active !== null && !isActive ? 0.45 : 1, transition: "opacity .18s" }}
          >
            <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.4 }}>
              <Typography
                variant="caption"
                sx={{ fontWeight: isActive ? 800 : 600 }}
                noWrap
                title={row.label}
              >
                {row.label}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.disabled", flexShrink: 0, ml: 1 }}>
                {Math.round((row.value / total) * 100)}%
              </Typography>
            </Stack>

            <Box sx={{ position: "relative", height: 22 }}>
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
                  width: `${width}%`,
                  borderRadius: 1,
                  // Full strength at the right-hand end, fading left. The
                  // value label is pinned to that end, and the palette
                  // guarantees each hue's contrast at full strength — not at
                  // 70% of itself over whatever the card is.
                  background: `linear-gradient(90deg, color-mix(in srgb, ${colour} 72%, transparent), ${colour})`,
                  transition: "filter .18s",
                  filter: isActive ? "saturate(1.2)" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  pr: inside ? 0.75 : 0,
                }}
              >
                {inside ? (
                  <Typography
                    sx={{
                      fontSize: 11,
                      fontWeight: 800,
                      // Every hue in the categorical ramp is validated for
                      // contrast against its own scheme's surface, which puts
                      // all of them dark enough to carry white type.
                      color: "common.white",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {row.value}
                    {unit ? ` ${unit}${row.value === 1 ? "" : "s"}` : ""}
                  </Typography>
                ) : null}
              </Box>
              {!inside ? (
                <Typography
                  sx={{
                    position: "absolute",
                    left: `calc(${width}% + 6px)`,
                    top: 3,
                    fontSize: 11,
                    fontWeight: 800,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {row.value}
                  {unit ? ` ${unit}${row.value === 1 ? "" : "s"}` : ""}
                </Typography>
              ) : null}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
