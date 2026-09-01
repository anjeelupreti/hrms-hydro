"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useState } from "react";

/**
 * Two measures at once, because some questions genuinely have two.
 *
 * For questions that are two-dimensional. "Is this survey collecting?" is
 * responses *against how long it has been open* — twelve is good on day one and
 * a failure on day thirty. "Is this onboarding stalled?" is completion *against
 * age* — 40% is fine on Monday and a person without a laptop three weeks later.
 * A ranked bar with the second measure demoted to a caption makes the reader
 * hold one number in their head while looking at another.
 *
 * On two axes the answer is a *position*: the corner that matters is the one
 * with high age and low progress, and it needs no explaining once the quadrant
 * is shaded.
 *
 * **The danger corner is shaded, not the points.** Colouring the points would
 * spend the one channel that could carry a category; shading the region says
 * "anything landing here is a problem" and keeps working when the data changes.
 */

export type Point = {
  label: string;
  /** Horizontal measure — usually time. */
  x: number;
  /** Vertical measure — usually progress or volume. */
  y: number;
  /** Shown in the tooltip under the label. */
  detail?: string;
};

export default function Scatter({
  points,
  xLabel,
  yLabel,
  /** Anything at or past this on x, and at or below `dangerBelowY`, is at risk. */
  dangerPastX,
  dangerBelowY,
  empty,
  xMax,
  yMax,
  formatX = (n: number) => String(n),
  formatY = (n: number) => String(n),
}: {
  points: Point[];
  xLabel: string;
  yLabel: string;
  dangerPastX?: number;
  dangerBelowY?: number;
  empty: string;
  /**
   * Fixed axis extents, and they matter more than they look.
   *
   * Set by the caller rather than derived from the data, which breaks on a new
   * workspace: three onboarding runs created the same day give every point
   * `x = 0`, so the axis spans a day, the 14-day danger threshold lands
   * off-screen and every marker stacks into one corner.
   *
   * A caller knows the meaningful range: percentages run to 100 whatever the
   * data says, and "long open" means a fortnight whether or not anything has
   * been open that long yet.
   */
  xMax?: number;
  yMax?: number;
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.disabled", py: 3, textAlign: "center" }}>
        {empty}
      </Typography>
    );
  }

  // Padded so a point never sits on the frame, where half of it is clipped and
  // its value looks like the axis maximum. The caller's floor wins whenever the
  // data has not reached it yet.
  const maxX = Math.max(xMax ?? 0, ...points.map((p) => p.x), 1) * 1.12;
  const maxY = Math.max(yMax ?? 0, ...points.map((p) => p.y), 1) * 1.12;

  // Three runs at the same age and completion are three different people, and
  // one marker would hide two of them. Nudged apart deterministically — by
  // index within their own cluster, so the arrangement is stable across renders
  // rather than jittering on every paint.
  const seen = new Map<string, number>();
  const placed = points.map((point) => {
    const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
    const rank = seen.get(key) ?? 0;
    seen.set(key, rank + 1);
    return { point, rank };
  });

  const shaded =
    dangerPastX !== undefined && dangerBelowY !== undefined
      ? {
          left: `${(dangerPastX / maxX) * 100}%`,
          bottom: 0,
          right: 0,
          height: `${(dangerBelowY / maxY) * 100}%`,
        }
      : null;

  return (
    <Box>
      <Box
        sx={{ position: "relative", height: 210, ml: 4.5, mr: 1, mt: 1 }}
        onMouseLeave={() => setActive(null)}
      >
        {/* The frame: two axes, no grid. A grid on twelve points is furniture. */}
        <Box sx={{ position: "absolute", inset: 0, borderLeft: "1px solid", borderBottom: "1px solid", borderColor: "divider" }} />

        {shaded ? (
          <Box
            sx={{
              position: "absolute",
              ...shaded,
              bgcolor: "var(--hrms-status-warning-solid)",
              opacity: 0.09,
              borderRadius: "2px 0 0 0",
            }}
          />
        ) : null}

        {placed.map(({ point, rank }, index) => {
          const isActive = active === index;
          // A tight spiral: right, up, left, down at 9px, which separates a
          // handful of identical points without implying different values.
          const nudge = [
            [0, 0],
            [9, 0],
            [0, 9],
            [-9, 0],
            [0, -9],
            [9, 9],
            [-9, -9],
          ][Math.min(rank, 6)];
          const atRisk =
            dangerPastX !== undefined &&
            dangerBelowY !== undefined &&
            point.x >= dangerPastX &&
            point.y <= dangerBelowY;

          return (
            <Box
              key={`${point.label}-${index}`}
              onMouseEnter={() => setActive(index)}
              sx={{
                position: "absolute",
                left: `${(point.x / maxX) * 100}%`,
                bottom: `${(point.y / maxY) * 100}%`,
                transform: `translate(calc(-50% + ${nudge[0]}px), calc(50% + ${nudge[1]}px))`,
                zIndex: isActive ? 3 : 1,
              }}
            >
              <Box
                sx={{
                  width: isActive ? 16 : 13,
                  height: isActive ? 16 : 13,
                  borderRadius: "4px",
                  transition: "width .15s, height .15s",
                  bgcolor: atRisk ? "var(--hrms-status-warning-solid)" : "var(--hrms-data-1)",
                  border: "2px solid",
                  borderColor: "background.paper",
                  boxShadow: isActive ? 3 : 1,
                  opacity: active !== null && !isActive ? 0.4 : 1,
                }}
              />
              {isActive ? (
                <Box
                  sx={{
                    position: "absolute",
                    bottom: "calc(100% + 8px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    px: 1,
                    py: 0.5,
                    borderRadius: 1.5,
                    bgcolor: "text.primary",
                    color: "background.paper",
                    whiteSpace: "nowrap",
                    boxShadow: 3,
                    pointerEvents: "none",
                  }}
                >
                  <Typography sx={{ fontSize: 11, fontWeight: 800 }}>{point.label}</Typography>
                  <Typography sx={{ fontSize: 10, opacity: 0.85 }}>
                    {formatY(point.y)} · {formatX(point.x)}
                  </Typography>
                </Box>
              ) : null}
            </Box>
          );
        })}

        <Typography
          sx={{
            position: "absolute",
            left: -38,
            top: "50%",
            transform: "rotate(-90deg) translateX(50%)",
            transformOrigin: "left top",
            fontSize: 10,
            color: "text.disabled",
            whiteSpace: "nowrap",
          }}
        >
          {yLabel}
        </Typography>
      </Box>

      <Typography sx={{ mt: 0.75, textAlign: "center", fontSize: 10, color: "text.disabled" }}>
        {xLabel} →
      </Typography>
    </Box>
  );
}
