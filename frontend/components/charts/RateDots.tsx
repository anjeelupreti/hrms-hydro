"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";

/**
 * Rates that all live near the ceiling, on an axis that can actually show them.
 *
 * For rates clustered in a narrow band — team attendance runs 87–100%. A bar
 * chart has to start at zero, which is not a style rule but what makes bar
 * *length* mean the value, so teams within a few points of each other come out
 * as bars of nearly identical height and the caption does all the work.
 *
 * **A dot may sit on a truncated axis; a bar may not.** A dot encodes position,
 * not length, so starting the scale at 80% misrepresents nothing *provided the
 * baseline is stated* — which is why the floor is drawn and labelled rather
 * than implied. That is the whole reason to change form rather than to zoom the
 * bars and hope nobody notices.
 *
 * **Ranked worst-first**, so the order carries the finding and the eye lands on
 * the team that needs attention before it reads a single number.
 */

export type Rate = { label: string; value: number | null; sub?: string };

export default function RateDots({
  rows,
  floor = 80,
  warnBelow = 90,
  empty,
}: {
  rows: Rate[];
  /** The left edge of the scale. Drawn and labelled, never implied. */
  floor?: number;
  warnBelow?: number;
  empty: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const ranked = [...rows].sort((a, b) => (a.value ?? 999) - (b.value ?? 999));
  if (ranked.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.disabled", py: 3, textAlign: "center" }}>
        {empty}
      </Typography>
    );
  }

  const span = 100 - floor;
  const position = (value: number) => ((Math.max(value, floor) - floor) / span) * 100;

  return (
    <Box onMouseLeave={() => setActive(null)}>
      <Stack spacing={0.9}>
        {ranked.map((row, index) => {
          const isActive = active === index;
          const missing = row.value === null;
          const warn = !missing && (row.value as number) < warnBelow;

          return (
            <Stack
              key={row.label}
              direction="row"
              spacing={1.25}
              onMouseEnter={() => setActive(index)}
              sx={{
                alignItems: "center",
                opacity: active !== null && !isActive ? 0.45 : 1,
                transition: "opacity .18s",
              }}
            >
              <Box sx={{ width: 132, flexShrink: 0 }}>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: isActive ? 800 : 600, display: "block" }}
                  noWrap
                  title={row.label}
                >
                  {row.label}
                </Typography>
                {row.sub ? (
                  <Typography sx={{ fontSize: 10, color: "text.disabled" }}>{row.sub}</Typography>
                ) : null}
              </Box>

              <Box sx={{ position: "relative", flexGrow: 1, height: 20, minWidth: 0 }}>
                {/* The track, with the floor at its left edge. */}
                <Box
                  sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 9,
                    height: 2,
                    borderRadius: 1,
                    bgcolor: "action.hover",
                  }}
                />
                {missing ? (
                  <Typography
                    sx={{ position: "absolute", left: 0, top: 2, fontSize: 10.5, color: "text.disabled" }}
                  >
                    nothing logged
                  </Typography>
                ) : (
                  <>
                    {/* A stem from the floor to the dot: it turns a scattered
                        row of points into something the eye can compare, without
                        claiming the length *is* the value. */}
                    <Box
                      sx={{
                        position: "absolute",
                        left: 0,
                        top: 9,
                        height: 2,
                        width: `${position(row.value as number)}%`,
                        borderRadius: 1,
                        bgcolor: warn ? "var(--hrms-status-warning-solid)" : "var(--hrms-data-1)",
                        opacity: 0.45,
                      }}
                    />
                    <Box
                      sx={{
                        position: "absolute",
                        left: `calc(${position(row.value as number)}% - 6px)`,
                        top: 4,
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: warn ? "var(--hrms-status-warning-solid)" : "var(--hrms-data-1)",
                        border: "2px solid",
                        borderColor: "background.paper",
                        boxShadow: isActive ? 2 : 0,
                        transform: isActive ? "scale(1.25)" : "none",
                        transition: "transform .18s, box-shadow .18s",
                      }}
                    />
                  </>
                )}
              </Box>

              <Typography
                sx={{
                  width: 42,
                  flexShrink: 0,
                  textAlign: "right",
                  fontSize: 12.5,
                  fontWeight: 800,
                  fontVariantNumeric: "tabular-nums",
                  color: warn ? "var(--hrms-status-warning-fg)" : "text.primary",
                }}
              >
                {missing ? "—" : `${Math.round(row.value as number)}%`}
              </Typography>
            </Stack>
          );
        })}
      </Stack>

      {/* The axis, stated. Without this the chart is a lie by omission. */}
      <Stack direction="row" sx={{ mt: 1.25, pl: "144px", pr: "50px", justifyContent: "space-between" }}>
        <Typography sx={{ fontSize: 10, color: "text.disabled" }}>{floor}%</Typography>
        <Typography sx={{ fontSize: 10, color: "text.disabled" }}>100%</Typography>
      </Stack>
    </Box>
  );
}
