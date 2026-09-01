"use client";

import Box from "@mui/material/Box";

type Props = {
  /** Oldest → newest. */
  data: number[];
  height?: number;
  barWidth?: number;
  gap?: number;
  color?: string;
  label?: string;
};

/**
 * A bar texture for inside a tile — the discrete counterpart to `Sparkline`.
 *
 * Use it where the values are counts that happened in separate buckets (runs
 * per month, tickets per day) rather than a continuous measure, where a line
 * would imply values between the points that do not exist.
 */
export default function MiniBars({ data, height = 26, barWidth = 4, gap = 3, color, label }: Props) {
  if (data.length === 0) return null;

  const max = Math.max(...data, 1);
  const peakIndex = data.lastIndexOf(max);

  return (
    <Box
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      sx={{
        display: "flex",
        alignItems: "flex-end",
        gap: `${gap}px`,
        height,
        color: color ?? "currentColor",
      }}
    >
      {data.map((v, i) => (
        <Box
          key={i}
          sx={{
            width: barWidth,
            // A floor of 3px so an empty bucket still reads as a bucket rather
            // than as a gap in the series.
            height: Math.max(3, (v / max) * height),
            borderRadius: 99,
            bgcolor: "currentColor",
            opacity: i === peakIndex ? 1 : 0.35,
          }}
        />
      ))}
    </Box>
  );
}
