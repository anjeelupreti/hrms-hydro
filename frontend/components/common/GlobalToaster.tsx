"use client";

import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import type { SxProps, Theme } from "@mui/material/styles";

import { useToastStore } from "@/lib/store/toast";

/**
 * Where a toast appears, defined once.
 *
 * **Bottom-right, above the chat launcher.** The launcher is in that corner
 * too, and a toast on top of it covers the button somebody just pressed — so
 * the collision is solved by *height*, lifting the toast clear, rather than by
 * banishing it to the opposite corner.
 *
 * `LAUNCHER_CLEARANCE` is that lift: the launcher sits at `bottom: 24` and is
 * at most 56px tall (`size="large"`, which is what it becomes when there are
 * unread messages — the taller of its two states is the one that has to fit),
 * plus a gap. Hard-coding 24 here and 24 there is how the two drift apart, so
 * the arithmetic is written down.
 *
 * Four components had their own snackbar at bottom-centre while this one was
 * bottom-left, so an export failure and a save confirmation appeared in
 * different places. They all import from here now: one position, changed in one
 * file.
 */

const LAUNCHER_BOTTOM = 24;
const LAUNCHER_MAX_HEIGHT = 56;
const GAP = 12;

export const TOAST_CLEARANCE = LAUNCHER_BOTTOM + LAUNCHER_MAX_HEIGHT + GAP;

export const TOAST_ANCHOR = { vertical: "bottom", horizontal: "right" } as const;

/**
 * Position for any snackbar in the app.
 *
 * On mobile it stays edge-to-edge, which is the convention there — but still
 * lifted, because the launcher does *not* give way at small sizes: it is fixed
 * at 24/24 at every breakpoint, and a full-width toast at the bottom sat
 * underneath it.
 */
export const toastSx: SxProps<Theme> = {
  left: { xs: 8, sm: "auto" },
  right: { xs: 8, sm: 24 },
  // Written per breakpoint, and it has to be. MUI's own Snackbar styles set
  // `bottom: 24` inside a `min-width: 600px` media query, and a flat `bottom`
  // in `sx` has the same specificity while losing the cascade to it — the lift
  // would be emitted, ignored, and the toast would land on top of the chat
  // launcher it is meant to clear.
  bottom: { xs: `${TOAST_CLEARANCE}px`, sm: `${TOAST_CLEARANCE}px` },
  maxWidth: { sm: 420 },
};

export default function GlobalToaster() {
  const { open, message, severity, hide } = useToastStore();

  return (
    <Snackbar
      open={open}
      autoHideDuration={4000}
      onClose={(_, reason) => reason !== "clickaway" && hide()}
      anchorOrigin={TOAST_ANCHOR}
      className="no-print"
      sx={toastSx}
    >
      <Alert
        severity={severity}
        variant="filled"
        onClose={hide}
        sx={{ boxShadow: 6, width: "100%" }}
      >
        {message}
      </Alert>
    </Snackbar>
  );
}
