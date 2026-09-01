"use client";

import Box from "@mui/material/Box";

/**
 * An ECG trace, drawn while the clock is running.
 *
 * **Why a waveform and not a pulsing dot.** A dot that fades in and out is the
 * same animation every "live" badge on the internet uses, and it says only
 * "something is animating". A cardiac trace says *running* — the reading is
 * immediate and needs no legend, because everyone has seen a hospital monitor.
 * It also survives being small, where a pulsing dot is just a flickering dot.
 *
 * **The geometry had two faults that made it look broken, and both came from
 * the same mistake: hardcoding a path and assuming it fitted.**
 *
 * 1. *The loop did not tile.* One beat is 61 units wide, so the two-beat path is
 *    122 — but the animation translated by `width` (88, or 92 in the top bar)
 *    and the second copy was drawn at `x = width`. The copies overlapped by 30
 *    units and the wrap landed mid-beat, so the trace visibly stuttered and
 *    doubled back on itself every cycle.
 * 2. *The spike was clipped.* The QRS reaches 15 units above the baseline and 11
 *    below. At the top bar's `height={20}` the baseline is at 10, so the peak
 *    sat at `y = -5` — outside the viewBox — and the tip of every beat was
 *    sliced flat against the top edge.
 *
 * Both are now derived rather than assumed: the beat is described in its own
 * unit space, the path is scaled to whatever height it is given, and enough
 * beats are laid down to cover the window plus one so the translation is
 * *exactly one beat* and the wrap is genuinely invisible.
 *
 * A mask fades the leading and trailing edges, so the line emerges and
 * disappears rather than being cut — a hard edge reads as a rendering fault,
 * which is the opposite of "everything is fine".
 *
 * Honours `prefers-reduced-motion`: the trace still draws, it simply stops
 * travelling. The information is "the clock is running", and a static waveform
 * carries that as well as a moving one.
 */

/**
 * One beat, in its own coordinate space.
 *
 * `x` runs 0 → `BEAT_WIDTH`; `y` is the excursion from the baseline in units
 * where `BEAT_PEAK` is the largest, so the whole shape can be scaled to fit any
 * height without a second set of magic numbers.
 */
const BEAT_WIDTH = 60;
/** The largest excursion either side of the baseline, in the same units. */
const BEAT_PEAK = 15;

/** Points of one beat: flat, P bump, flat, the QRS spike, flat, T bump, flat. */
const BEAT_POINTS: [number, number][] = [
  [0, 0],
  [8, 0],
  [11, -2.5],
  [14, 0],
  [21, 0],
  [24, 3],
  [27, -15],
  [30, 11],
  [33, 0],
  [40, 0],
  [45, -5],
  [50, 0],
  [60, 0],
];

export default function LiveTrace({
  width = 88,
  height = 26,
  /** Seconds per beat. Roughly a resting pulse at the default. */
  period = 1.1,
}: {
  width?: number;
  height?: number;
  period?: number;
}) {
  const mid = height / 2;
  // Leave a hairline of room so the stroke's own width is not clipped at the
  // extremes — the peak should touch the edge, not be shaved by it.
  const scale = (mid - 1.2) / BEAT_PEAK;

  // One beat's worth of extra, so that after translating exactly one beat there
  // is still a drawn beat covering the right-hand edge.
  const beats = Math.ceil(width / BEAT_WIDTH) + 1;

  const path = Array.from({ length: beats }, (_, beat) =>
    BEAT_POINTS.map(([x, y], index) => {
      const px = (beat * BEAT_WIDTH + x).toFixed(2);
      const py = (mid + y * scale).toFixed(2);
      return `${index === 0 && beat === 0 ? "M" : "L"}${px} ${py}`;
    }).join(" "),
  ).join(" ");

  const canvasWidth = beats * BEAT_WIDTH;

  return (
    <Box
      aria-hidden
      sx={{
        width,
        height,
        overflow: "hidden",
        // The edges fade rather than cut. Without this the line appears to be
        // sliced off by an invisible box.
        maskImage: "linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)",
        "& svg": { display: "block" },
        "& .trace": { animation: `trace-sweep ${period}s linear infinite` },
        "@keyframes trace-sweep": {
          from: { transform: "translateX(0)" },
          // Exactly one beat. Every beat is identical, so the frame after the
          // wrap is pixel-for-pixel the frame before it.
          to: { transform: `translateX(-${BEAT_WIDTH}px)` },
        },
        "@media (prefers-reduced-motion: reduce)": {
          "& .trace": { animation: "none" },
        },
      }}
    >
      <Box
        component="svg"
        width={canvasWidth}
        height={height}
        viewBox={`0 0 ${canvasWidth} ${height}`}
        sx={{ overflow: "visible" }}
      >
        <path
          className="trace"
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Box>
    </Box>
  );
}
