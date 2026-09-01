"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/**
 * The one thing worth knowing about a list, above the list.
 *
 * The owner asked for "a space like we have there in attendance page, which
 * shows a metric" on every screen that lists things — and separately, earlier,
 * rejected a row of counts with "dont provide such useless metrics". Both are
 * right, and together they say what this has to be.
 *
 * **A reading, not a scoreboard.** What works on the attendance page is not
 * that it displays numbers; it is that it answers a question somebody actually
 * has — *is the start time we publish the one people keep* — in a sentence.
 * A strip of tiles reading "Total 7 · Pending 3 · Approved 3" restates the
 * filter chips directly beneath it in bigger type. So this takes a **headline
 * figure and a plain-English reading of it**, and the reading is the part that
 * earns the space.
 *
 * **Every figure comes from the server.** These describe the whole list, and a
 * page here is capped at 100 rows — a total summed from `results` silently
 * undercounts on exactly the companys where the number matters (§2.6). Callers
 * pass values from a `status-counts` endpoint, never from the rows on screen.
 *
 * **The distribution strip is optional and ordinal.** Where the states have an
 * order — requested → approved → active → closed — the strip shows the shape of
 * the queue in one hue deepening along it. Where they do not, it is left out
 * rather than coloured arbitrarily.
 */

export type InsightSegment = {
  label: string;
  value: number;
  /** 0–1 along the ramp. Ordinal position, not magnitude. */
  depth: number;
  /** Draws in the error hue instead: this state is a problem, not a stage. */
  attention?: boolean;
};

export default function ListInsight({
  headline,
  reading,
  aside,
  segments,
}: {
  /** The figure itself — money, a count, a duration. Already formatted. */
  headline: ReactNode;
  /** What it means, in a sentence somebody would say out loud. */
  reading: ReactNode;
  /** A second fact, secondary to the headline. Often the one that needs acting on. */
  aside?: ReactNode;
  segments?: InsightSegment[];
}) {
  const drawable = (segments ?? []).filter((s) => s.value > 0);
  const total = drawable.reduce((sum, s) => sum + s.value, 0);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        gap: { xs: 2, md: 4 },
        alignItems: { md: "center" },
        px: 2.5,
        py: 2,
        mb: 3,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          component="div"
          sx={{
            fontSize: "1.75rem",
            fontWeight: 700,
            lineHeight: 1.1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {headline}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: "46ch" }}>
          {reading}
        </Typography>
      </Box>

      {aside ? (
        <Box
          sx={{
            pl: { md: 3 },
            borderLeft: { md: "1px solid" },
            borderColor: { md: "divider" },
          }}
        >
          {aside}
        </Box>
      ) : null}

      {total > 0 && (
        <Box sx={{ flex: 1, minWidth: { md: 160 } }}>
          <Box sx={{ display: "flex", gap: "2px", height: 8, borderRadius: 999, overflow: "hidden" }}>
            {drawable.map((segment) => (
              <Tooltip key={segment.label} arrow title={`${segment.label}: ${segment.value}`}>
                <Box
                  sx={{
                    flexGrow: segment.value,
                    flexBasis: 0,
                    minWidth: 3,
                    backgroundColor: segment.attention
                      ? "var(--mui-palette-error-main)"
                      : `color-mix(in srgb, var(--mui-palette-primary-main) ${
                          18 + Math.round(segment.depth * 82)
                        }%, var(--mui-palette-background-paper))`,
                  }}
                />
              </Tooltip>
            ))}
          </Box>
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mt: 1 }}>
            {drawable.map((segment) => (
              <Typography
                key={segment.label}
                variant="caption"
                sx={{ color: segment.attention ? "error.main" : "text.secondary" }}
              >
                {segment.label}{" "}
                <Box component="span" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {segment.value}
                </Box>
              </Typography>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
