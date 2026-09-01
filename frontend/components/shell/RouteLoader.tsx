"use client";

import Box from "@mui/material/Box";

/**
 * What the screen does while a page is still coming.
 *
 * **The loader holds the whole page and blurs what is behind it.** A hairline
 * rail at the top of the window answers "did my click register?" with three
 * pixels of colour at the edge of the screen while the whole middle sits blank
 * — and on this stack a cold route compile runs to twelve seconds.
 *
 * The
 * shell — sidebar, top bar, the company's name — stays in the DOM through a
 * navigation, and putting it out of focus behind frosted glass says the thing a
 * rail could not: *this is the same workspace, the content is being replaced,
 * wait.* Nothing is thrown away and nothing is faked; the page you are going to
 * is simply not legible yet, and it looks that way.
 *
 * **It lifts the moment anything real arrives.** This is rendered from the
 * route's `loading.tsx`, so React unmounts it the instant the segment itself
 * renders — the first section to appear ends the hold, rather than the last.
 * A page that streams its header early gets read while its tables are still
 * filling, which is the point.
 *
 * **It waits a quarter-second before showing itself.** Most navigations here
 * are far quicker than that, and an overlay that flashed up and away on every
 * one of them would be worse than no overlay at all — motion where the eye
 * expects stillness. The fade is delayed in CSS rather than timed in JS, so a
 * fast route mounts and unmounts this without ever painting it.
 *
 * ---
 *
 * **The mark: a roster filling in.** Not a spinner. A spinner is the same
 * object in every product ever made, and it says only "a thing is turning".
 * This is a grid of five columns and four rows — a working month, the shape
 * this product draws more than any other, on the attendance calendar and the
 * timesheet and the leave planner — and its cells light in a diagonal sweep,
 * the way records land when a period is being assembled.
 *
 * It reads as *this system, gathering people's days*, and it is honest: there
 * is no way to know how far a React transition has got, so nothing here creeps
 * toward a finish line it cannot see. The wave simply travels.
 *
 * **It wears the company's colour.** The accent is the company's own choice,
 * and the one moving thing on a held screen should not belong to somebody
 * else. Every cell is drawn from `primary.main`.
 *
 * Honours `prefers-reduced-motion`: the sweep stops and the grid breathes as a
 * whole instead. What matters is "something is happening", and a slow collective
 * pulse carries that without anything travelling across the visual field.
 */

/** Five weekdays across, four weeks down — a month of work. */
const COLUMNS = 5;
const ROWS = 4;
const CELLS = Array.from({ length: COLUMNS * ROWS }, (_, i) => i);

/** One full pass of the wave, and the longest stagger inside it. */
const SWEEP_MS = 1900;
const STEP_MS = 110;

export default function RouteLoader({ visible = true }: { visible?: boolean }) {
  if (!visible) return null;

  return (
    <Box
      role="status"
      aria-live="polite"
      aria-label="Loading"
      sx={{
        position: "fixed",
        inset: 0,
        // Above the shell it is frosting, below dialogs and the command
        // palette — a navigation started from a modal must not be hidden by
        // its own loader.
        zIndex: 1250,
        display: "grid",
        placeItems: "center",
        // The frosted pane. A wash of the page's own background rather than a
        // grey, so the overlay belongs to the theme in both schemes, and light
        // enough that the shell behind stays recognisable as *this* workspace.
        backgroundColor: (t) =>
          `color-mix(in srgb, ${t.vars.palette.background.default} 62%, transparent)`,
        backdropFilter: "blur(14px) saturate(140%)",
        WebkitBackdropFilter: "blur(14px) saturate(140%)",
        // Held back so quick navigations never paint this at all. `both` keeps
        // it fully transparent through the delay rather than flashing at full
        // strength for one frame first.
        animation: "hrms-loader-in 260ms ease 240ms both",
        "@keyframes hrms-loader-in": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
          gap: 1,
          // Sized so the mark reads as a calendar rather than as a texture.
          width: 132,
        }}
      >
        {CELLS.map((index) => {
          const column = index % COLUMNS;
          const row = Math.floor(index / COLUMNS);
          // Diagonal: a cell's turn depends on how far it is from the top-left,
          // so the light travels corner to corner instead of row by row.
          const delay = (column + row) * STEP_MS;

          return (
            <Box
              key={index}
              sx={{
                aspectRatio: "1",
                borderRadius: 1,
                bgcolor: (t) => t.vars.palette.primary.main,
                // The resting state is a faint tint — the grid is always a
                // whole shape, and the wave brightens cells rather than
                // conjuring them out of nothing.
                opacity: 0.16,
                animation: `hrms-loader-cell ${SWEEP_MS}ms ease-in-out ${delay}ms infinite`,
                "@keyframes hrms-loader-cell": {
                  // Most of the cycle is spent at rest, so the lit band stays
                  // narrow and legibly a *sweep* rather than a general flicker.
                  "0%, 55%, 100%": { opacity: 0.16, transform: "scale(1)" },
                  "22%": { opacity: 1, transform: "scale(1.12)" },
                },
                "@media (prefers-reduced-motion: reduce)": {
                  // No travel and no stagger: the whole grid breathes together.
                  animation: "hrms-loader-breathe 2s ease-in-out infinite",
                  "@keyframes hrms-loader-breathe": {
                    "0%, 100%": { opacity: 0.2 },
                    "50%": { opacity: 0.6 },
                  },
                },
              }}
            />
          );
        })}
      </Box>
    </Box>
  );
}
