"use client";

import Box from "@mui/material/Box";
import { useId } from "react";

type Props = {
  /** Oldest → newest. Fewer than two points renders nothing. */
  data: number[];
  width?: number;
  height?: number;
  /** Any CSS colour. Defaults to the current text colour, so it inherits tone. */
  color?: string;
  /** Fill under the line. Off for a bare trend, on inside a tile. */
  area?: boolean;
  /** Accessible summary. Without one this is decorative and hidden. */
  label?: string;
};

/**
 * An inline trend, no axes and no gridlines.
 *
 * It exists to put shape next to a number inside a tile — whether the figure
 * arrived by climbing or falling — in a footprint where a real chart would be
 * unreadable. Anything that needs to be read precisely wants a proper chart
 * with axes, not this.
 */
export default function Sparkline({ data, width = 72, height = 24, color, area = true, label }: Props) {
  const gradientId = useId();

  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);

  // 1px inset top and bottom so the stroke is never clipped at the extremes.
  const points = data.map((v, i) => [i * step, height - 1 - ((v - min) / span) * (height - 2)] as const);
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fill = `${line} L${width},${height} L0,${height} Z`;

  return (
    <Box
      component="svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      sx={{ display: "block", color: color ?? "currentColor", overflow: "visible" }}
    >
      {area && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fill} fill={`url(#${gradientId})`} />
        </>
      )}
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="2.25" fill="currentColor" />
    </Box>
  );
}
