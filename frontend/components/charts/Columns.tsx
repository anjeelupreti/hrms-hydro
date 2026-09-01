"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";

/**
 * A column chart, for questions about an ordered sequence — days of a week,
 * months of a year, stages of a process.
 *
 * Hovering a column raises it, dims its neighbours and pins a badge with the
 * exact value above it. That is the point of columns over static blocks: the
 * reader gets the number instead of estimating it against an axis.
 *
 * Selection is carried by weight, not colour. Colour already carries the
 * series, and one channel cannot hold two meanings.
 *
 * Bars have a rounded top and a square base. A bar is anchored to its baseline,
 * and rounding the bottom lifts it off the axis that gives its length meaning.
 *
 * A column may carry a `part` — a sub-total drawn inside it. See `Column.part`
 * for when that is honest and when it would misstate a total.
 */

export type Column = {
  label: string;
  value: number;
  /** Optional second line under the label — a date, a count, a unit. */
  sub?: string;
  /** Overrides the series colour, for a column that means something else. */
  colour?: string;
  /** Drawn hollow — for "no data", which is not the same as zero. */
  empty?: boolean;
  /**
   * A sub-total of `value`, drawn inside the same column.
   *
   * Only for a figure genuinely contained in the column. Late arrivals are
   * counted within the present total, so a second bar beside it would invite
   * adding 77 present to 12 late and reading 89 people out of 88. Inside the
   * column, the same number reads as "of these, this many".
   *
   * `value` stays the whole column. A part larger than it is clamped.
   */
  part?: { value: number; label: string };
};

export default function Columns({
  data,
  height = 168,
  format = (n: number) => String(n),
  /** Shown in the badge instead of the raw value, when a unit reads better. */
  badge,
  onSelect,
}: {
  data: Column[];
  height?: number;
  format?: (value: number) => string;
  /** `index` is given too: a label alone can repeat across a window. */
  badge?: (column: Column, index: number) => string;
  onSelect?: (column: Column, index: number) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-end",
          gap: 1,
          height,
          // Room above the tallest bar for the badge, which would otherwise be
          // clipped by the chart's own box on the highest column.
          pt: 3.5,
          position: "relative",
        }}
        onMouseLeave={() => setActive(null)}
      >
        {data.map((column, index) => {
          const isActive = active === index;
          const dimmed = active !== null && !isActive;
          const barHeight = column.empty ? 6 : Math.max((column.value / max) * (height - 28), 3);
          // A part cannot exceed its whole, and a zero-height column has no
          // room for one — both would otherwise draw a hatch taller than the
          // bar it is meant to sit inside.
          const partValue = Math.min(column.part?.value ?? 0, column.value);
          const partHeight =
            column.empty || partValue <= 0 || column.value <= 0
              ? 0
              : (partValue / column.value) * barHeight;

          return (
            <Box
              key={`${column.label}-${index}`}
              onMouseEnter={() => setActive(index)}
              onClick={onSelect ? () => onSelect(column, index) : undefined}
              sx={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                alignItems: "center",
                height: "100%",
                cursor: onSelect ? "pointer" : "default",
                position: "relative",
              }}
            >
              {/* The badge, only for the column being pointed at. A number over
                  every bar is the clutter this replaces. */}
              {isActive ? (
                <Box
                  sx={{
                    position: "absolute",
                    top: -6,
                    px: 1,
                    py: 0.3,
                    borderRadius: 1.5,
                    bgcolor: "text.primary",
                    color: "background.paper",
                    fontSize: 11,
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                    zIndex: 2,
                    boxShadow: 2,
                  }}
                >
                  {badge ? badge(column, index) : format(column.value)}
                </Box>
              ) : null}

              <Box
                sx={{
                  position: "relative",
                  width: "100%",
                  maxWidth: 46,
                  height: barHeight,
                  borderRadius: "6px 6px 2px 2px",
                  overflow: "hidden",
                  transition: "opacity .18s, transform .18s, filter .18s",
                  opacity: dimmed ? 0.35 : 1,
                  transform: isActive ? "translateY(-3px)" : "none",
                  ...(column.empty
                    ? { border: "1.5px dashed", borderColor: "divider" }
                    : {
                        // A vertical wash rather than a flat fill: the lighter
                        // foot keeps a tall bar from reading as a solid slab.
                        background: `linear-gradient(180deg, ${
                          column.colour ?? "var(--hrms-data-1)"
                        }, color-mix(in srgb, ${column.colour ?? "var(--hrms-data-1)"} 62%, transparent))`,
                        filter: isActive ? "saturate(1.15)" : "none",
                      }),
                }}
              >
                {/* The sub-total, at the foot of the column it belongs to.
                    Hatched rather than given a second hue: a new colour would
                    read as a new category, and this is the same people counted
                    a second way. The hatch says "part of this bar" in a way a
                    flat block cannot. */}
                {partHeight > 0 ? (
                  <Box
                    aria-hidden
                    sx={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: partHeight,
                      backgroundImage:
                        "repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 3px, transparent 3px 6px)",
                      borderTop: "1.5px solid rgba(255,255,255,.75)",
                    }}
                  />
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        {data.map((column, index) => (
          <Box key={`${column.label}-label-${index}`} sx={{ flex: 1, minWidth: 0, textAlign: "center" }}>
            <Typography
              variant="caption"
              sx={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                lineHeight: 1.25,
                // Two lines rather than an ellipsis. On one line, department
                // names truncate to "Company Secret…" and "Electrical &
                // Trans…", which identify nothing — and the reader needs the
                // label to decide which column to point at, so deferring the
                // full name to the hover badge is too late.
                fontWeight: active === index ? 800 : 500,
                color: active === index ? "text.primary" : "text.secondary",
              }}
            >
              {column.label}
            </Typography>
            {column.sub ? (
              <Typography variant="caption" sx={{ display: "block", color: "text.disabled", fontSize: 10 }} noWrap>
                {column.sub}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
