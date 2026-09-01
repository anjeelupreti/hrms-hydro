"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

export type Share = {
  label: string;
  value: number;
  /**
   * A CSS colour. Pass `var(--hrms-status-*-solid)` for state and
   * `seriesColor(i)` for identity — both follow the colour scheme.
   *
   * Never pass this to `alpha()`; it is a `var(…)` at runtime and MUI's
   * `alpha` parses colours in JS. See the `StatTile` fix in the ledger.
   */
  color: string;
};

type Props = {
  data: Share[];
  /** Bar thickness. The default is deliberately thin — it is a summary, not a plot. */
  height?: number;
  /** Renders "412 of 443 days" under the bar rather than a bare total. */
  unit?: string;
  /** Hide the legend where the caller lays out its own. */
  hideLegend?: boolean;
};

/**
 * One bar that states a whole, divided into its parts.
 *
 * **Why this exists.** Four `LinearProgress` bars, each rendering
 * `value / total` on its own full-width track, is the shape this replaces. Each
 * track reads as its own 0–100 scale, so nothing on screen says the four
 * numbers are slices of one quantity — and a reader cannot see that on-time
 * plus late plus absent *is* the month. A single divided bar says it in the
 * geometry, before anyone reads a number.
 *
 * Marks follow the dataviz spec: a 2px surface gap between segments so
 * adjacent fills never bleed into one another, rounded outer ends only, and a
 * minimum segment width so a real-but-tiny slice cannot vanish (a rendered
 * zero and an actual zero must not look the same).
 */
export default function ShareBar({ data, height = 12, unit, hideLegend = false }: Props) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  // With no data there is no whole to divide. An empty track would imply a
  // measured zero; the caller decides what "nothing logged yet" should say.
  if (total === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nothing logged yet{unit ? ` — no ${unit} to break down` : ""}.
      </Typography>
    );
  }

  const present = data.filter((d) => d.value > 0);

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ height, width: "100%", borderRadius: 99, overflow: "hidden", gap: "2px" }}
        role="img"
        aria-label={present.map((d) => `${d.label}: ${d.value} of ${total}`).join(", ")}
      >
        {present.map((d) => (
          <Tooltip key={d.label} title={`${d.label} — ${d.value} of ${total} (${Math.round((d.value / total) * 100)}%)`}>
            <Box
              sx={{
                // A floor of 3px: a segment that exists must be visible, or a
                // rare-but-real state reads as absent.
                flex: `1 1 ${(d.value / total) * 100}%`,
                minWidth: 3,
                bgcolor: d.color,
              }}
            />
          </Tooltip>
        ))}
      </Stack>

      {!hideLegend && (
        <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2, rowGap: 0.75, mt: 1.5 }}>
          {data.map((d) => (
            <Stack key={d.label} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              {/* Identity is never colour alone: the swatch sits beside a
                  written label and its count, so the row survives CVD, a
                  greyscale print and forced-colors. */}
              <Box
                aria-hidden
                sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: d.color, flexShrink: 0 }}
              />
              <Typography variant="body2" color="text.secondary">
                {d.label}
              </Typography>
              {/* Text wears text tokens, never the series colour. */}
              <Typography className="hrms-num" variant="body2" sx={{ fontWeight: 700 }}>
                {d.value}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}
