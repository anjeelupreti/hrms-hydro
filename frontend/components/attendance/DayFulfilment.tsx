"use client";

import Box from "@mui/material/Box";
import { useSyncExternalStore } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * How much of today's working day has actually been clocked.
 *
 * **A dial, because the question is "how far through", not "how many".** Hours
 * worked is a number anybody can read off the clock widget already; what it
 * cannot say is whether that is most of a day or a third of one. A dial answers
 * that without arithmetic — the sweep *is* the fraction — which is the whole
 * reason to spend the space.
 *
 * **It knows what a day is here, or admits it does not.** The target comes from
 * the company's own office hours. `office_start_time` and `office_end_time`
 * are nullable by design, and a dial that quietly assumed 9-to-5 would be
 * inventing the denominator — so with no hours set it says so and shows the
 * hours plainly instead of a fraction of a guess.
 *
 * **Over a full day is shown, not clamped.** Somebody who worked ten hours
 * against an eight-hour day has done something worth seeing; a needle pinned at
 * the end would hide exactly the case a manager cares about. The arc stops at
 * full and the figure keeps counting, with the overshoot named.
 */

/**
 * A ticking clock as an external store.
 *
 * **`getSnapshot` must return a constant.** `useSyncExternalStore` calls it
 * during render and compares the result with `Object.is` to decide whether to
 * re-render, so something like `() => Date.now()` returns a different number
 * almost every call: React sees the store change on every check, re-renders,
 * checks again, and throws "Maximum update depth exceeded".
 *
 * It fires only when two consecutive reads straddle a millisecond boundary,
 * which makes it intermittent — roughly one page load in three, never
 * reproducibly.
 * That is also why it survived — a crash you cannot reproduce gets refreshed
 * past.
 *
 * The snapshot is now a cached value that changes **only when the timer fires**,
 * which is what the hook's contract asks for.
 */
let tickNow = Date.now();
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

/** Half a minute is finer than anybody reads a dial to. */
function subscribeToTick(onChange: () => void) {
  tickListeners.add(onChange);
  if (tickTimer === null) {
    tickTimer = setInterval(() => {
      tickNow = Date.now();
      tickListeners.forEach((listener) => listener());
    }, 30_000);
  }
  return () => {
    tickListeners.delete(onChange);
    // One timer for however many dials are on screen, and none when there are
    // none — a per-instance interval left running is a leak on every unmount.
    if (tickListeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/** Stable between ticks — this is the part that must not be `Date.now()`. */
function getTickSnapshot() {
  return tickNow;
}

/** The server has no clock to agree with, so the first paint carries none. */
function getTickServerSnapshot() {
  return null;
}

const SIZE = 132;
const CENTRE = SIZE / 2;
const RADIUS = 52;
const THICKNESS = 9;
/** Three-quarters of a circle, opening at the bottom — a speedometer, not a pie. */
const SWEEP = 1.5 * Math.PI;
const START = 0.75 * Math.PI;

function polar(angle: number, radius: number) {
  return { x: CENTRE + Math.cos(angle) * radius, y: CENTRE + Math.sin(angle) * radius };
}

function arc(fromFraction: number, toFraction: number) {
  const a = START + SWEEP * fromFraction;
  const b = START + SWEEP * toFraction;
  const start = polar(a, RADIUS);
  const end = polar(b, RADIUS);
  const large = b - a > Math.PI ? 1 : 0;
  return `M${start.x} ${start.y} A${RADIUS} ${RADIUS} 0 ${large} 1 ${end.x} ${end.y}`;
}

export default function DayFulfilment({
  secondsWorked,
  openSince,
  targetSeconds,
}: {
  /** Closed sessions only — the served figure, which does not move. */
  secondsWorked: number;
  /** When the stretch still running began, if one is. */
  openSince?: string | null;
  /** The working day in seconds, or null where the system has not set hours. */
  targetSeconds: number | null;
}) {
  // The running stretch ticks here rather than being computed by the caller —
  // reading `Date.now()` during a parent's render is an impure call, and the
  // clock belongs to the component that draws it anyway.
  //
  // `useSyncExternalStore` rather than setState in an effect: the effect form
  // schedules a second render on mount and trips
  // `react-hooks/set-state-in-effect`. This is the same pattern the page
  // header and the theme customiser use for the same reason. Starting at
  // `null` on the server keeps the first paint identical on both sides, which
  // is what stops a hydration mismatch on a value made of the current time.
  const now = useSyncExternalStore(subscribeToTick, getTickSnapshot, getTickServerSnapshot);

  const running =
    openSince && now ? Math.max(0, (now - new Date(openSince).getTime()) / 1000) : 0;
  const worked = secondsWorked + running;
  const hours = worked / 3600;
  const fraction = targetSeconds ? Math.min(worked / targetSeconds, 1) : 0;
  const over = targetSeconds ? worked - targetSeconds : 0;

  const label = `${Math.floor(hours)}h ${String(Math.round((hours % 1) * 60)).padStart(2, "0")}m`;

  return (
    <Stack sx={{ alignItems: "center" }}>
      <Box component="svg" width={SIZE} height={SIZE * 0.78} viewBox={`0 0 ${SIZE} ${SIZE * 0.78}`}>
        {/* The track. Always the full sweep, so the dial reads as a dial even
            at nought — an arc that grows from nothing looks broken until it
            has something in it. */}
        <path
          d={arc(0, 1)}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.13}
          strokeWidth={THICKNESS}
          strokeLinecap="round"
        />
        {fraction > 0 ? (
          <path
            d={arc(0, fraction)}
            fill="none"
            stroke={
              over > 0
                ? "var(--hrms-status-warning-solid)"
                : "var(--mui-palette-primary-main)"
            }
            strokeWidth={THICKNESS}
            strokeLinecap="round"
          />
        ) : null}

        <text
          x={CENTRE}
          y={CENTRE + 2}
          textAnchor="middle"
          fontSize={20}
          fontWeight={800}
          fill="currentColor"
        >
          {label}
        </text>
        <text
          x={CENTRE}
          y={CENTRE + 20}
          textAnchor="middle"
          fontSize={9}
          fill="currentColor"
          opacity={0.55}
          letterSpacing={0.6}
        >
          {targetSeconds ? `OF ${Math.round(targetSeconds / 3600)}H` : "CLOCKED TODAY"}
        </text>
      </Box>

      {/* Said in words underneath, because a dial alone cannot distinguish
          "nearly done" from "an hour over". */}
      <Typography variant="caption" color={over > 0 ? "warning.main" : "text.secondary"}>
        {!targetSeconds
          ? "Set office hours to track a target"
          : over > 0
            ? `${Math.round(over / 60)} min over`
            : `${Math.round((targetSeconds - worked) / 60)} min to go`}
      </Typography>
    </Stack>
  );
}
