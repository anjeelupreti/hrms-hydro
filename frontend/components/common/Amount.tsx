"use client";

/**
 * A money figure — masked only where masking is the point.
 *
 * **What this is for, narrowly.** Somebody's *own pay* on a shared screen: a
 * payslip, a net-pay headline, a salary on a profile. Those are the figures
 * that cannot be un-seen once a colleague reads them over a shoulder, and they
 * are the reason the mask exists.
 *
 * **Masking is opt-in through `personal`; the default renders a plain number.**
 * Company totals — an expense report, a payroll run's gross, the fund
 * reconciliation — are the job of the page, and the person looking at them is
 * looking on purpose. Masking those turns a finance screen into a wall of dots
 * that has to be clicked open one figure at a time.
 *
 * **The eye is always drawn**, and the icon carries the state: struck through
 * while hidden, plain while shown. Fading it in on hover leaves a revealed
 * amount with no visible way back and nothing on screen saying the control
 * exists.
 */

import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";

import { useAmountsHidden } from "@/lib/store/privacy";

export default function Amount({
  value,
  /** Rendered before the digits — a currency mark, usually. */
  prefix = "",
  /**
   * This is one person's pay, so it may be masked.
   *
   * Off by default. A figure that belongs to the *company* rather than to a
   * person — a total, a report line, a budget — is not sensitive in the way
   * this mask is for, and hiding it only gets in the way of the work.
   */
  personal = false,
}: {
  value: string | number;
  prefix?: string;
  personal?: boolean;
}) {
  // Masked through the hydration render whatever the stored preference says —
  // see `useAmountsHidden`. Reading the store directly would paint every figure
  // for a frame before hiding it, which is the one outcome this avoids.
  const hiddenByDefault = useAmountsHidden();
  // `null` follows the default; once somebody decides for this figure, their
  // choice stands. Per figure rather than global, so uncovering one payslip
  // does not uncover a table of them.
  const [override, setOverride] = useState<boolean | null>(null);
  const hidden = personal && (override ?? hiddenByDefault);

  const text =
    typeof value === "number"
      ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : value;

  // A company figure is just a number. No control, no dots, no ceremony.
  if (!personal) {
    return (
      <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {prefix}
        {text}
      </Box>
    );
  }

  const digits = Math.max(3, String(text).replace(/[^\d]/g, "").length);

  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Box
        component="span"
        sx={
          hidden
            ? { letterSpacing: "0.08em", color: "text.disabled", userSelect: "none" }
            : undefined
        }
      >
        {prefix}
        {hidden ? "•".repeat(digits) : text}
      </Box>

      <Tooltip title={hidden ? "Show this amount" : "Hide this amount"}>
        <Box
          component="button"
          type="button"
          aria-label={hidden ? "Show amount" : "Hide amount"}
          aria-pressed={hidden}
          onClick={(e: React.MouseEvent) => {
            // These often sit inside a clickable row; revealing one must not
            // also open the record behind it.
            e.stopPropagation();
            setOverride(!hidden);
          }}
          sx={{
            all: "unset",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            color: "text.disabled",
            borderRadius: 0.5,
            transition: "color 120ms",
            "&:hover": { color: "text.secondary" },
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
          }}
        >
          {/* The icon *is* the state: struck through while hidden, plain while
              shown. Always present, so there is never a revealed figure with no
              visible way back. */}
          {hidden ? (
            <VisibilityOffIcon sx={{ fontSize: 14 }} />
          ) : (
            <VisibilityIcon sx={{ fontSize: 14 }} />
          )}
        </Box>
      </Tooltip>
    </Box>
  );
}
