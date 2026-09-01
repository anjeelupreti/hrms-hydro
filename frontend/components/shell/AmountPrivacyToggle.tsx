"use client";

import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";

import { useAmountsHidden, usePrivacyStore } from "@/lib/store/privacy";

/**
 * One switch for whether money is shown on screen.
 *
 * The one control over `usePrivacyStore.amountsHidden`, which defaults to
 * *hidden* and persists — so the system that puts salaries on a projector sets
 * it once.
 *
 * Without it that default is permanent: every personal figure stays masked and
 * the only way to read one is its own small eye, which turns a payslip history
 * into six rows of dots and six clicks, and is exactly
 * the obstacle course `Amount`'s own docstring warns against. The wall of dots
 * was not the masking being wrong; it was the switch being missing.
 *
 * **In the top bar, beside the colour-mode toggle**, because it is the same
 * kind of thing: a per-viewer display preference that belongs to the person and
 * the device, not to the company or the data. Somebody at a shared desk turns
 * it on; somebody alone with a payroll run to check turns it off once.
 *
 * The per-figure eyes stay. They are the override — reveal *this* number
 * without revealing the table it sits in — and the owner asked for that control
 * to sit beside the amount. This is the other half of the pair, not a
 * replacement for it.
 */
export default function AmountPrivacyToggle() {
  const hidden = useAmountsHidden();
  const setHidden = usePrivacyStore((state) => state.setAmountsHidden);

  return (
    <Tooltip title={hidden ? "Show amounts" : "Hide amounts"}>
      <IconButton
        size="small"
        aria-label={hidden ? "Show amounts" : "Hide amounts"}
        aria-pressed={hidden}
        onClick={() => setHidden(!hidden)}
        color="inherit"
      >
        {/* The icon carries the state the same way `Amount`'s does: struck
            through while hidden, plain while shown. Two controls that mean the
            same thing should not read differently. */}
        {hidden ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
