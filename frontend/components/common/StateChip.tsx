"use client";

import Chip from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";

/**
 * A record's state, drawn to one rule.
 *
 * Weight carries the meaning, not colour. "Active" is not an achievement, it is
 * the default condition of almost every row in the product, and a solid green
 * badge on each of a hundred employees is a wall the eye stops reading — taking
 * the genuinely alarming states down with it.
 *
 * So there are two questions, answered separately:
 *
 * - **Is this the normal state?** Filled if so, outlined if not. That is the
 *   distinction somebody scans for, and weight carries it better than hue.
 * - **Does this state need attention?** Only then does colour say anything —
 *   and it says it in the *status* palette, which is reserved and never used
 *   for decoration. A terminated employee is red because that is a fact worth
 *   flagging; an active one is the accent because it is simply the norm.
 *
 * The normal state wears the company's accent rather than green: it is the
 * house colour, it follows the company's own choice, and it leaves green free
 * to mean something.
 */

export type ChipTone = "normal" | "muted" | "caution" | "alarm";

const TONE: Record<ChipTone, { color: "primary" | "warning" | "error" | "default"; filled: boolean }> = {
  // The default condition — filled, in the accent.
  normal: { color: "primary", filled: true },
  // Ended, closed, archived. Real but not urgent, and not the norm.
  muted: { color: "default", filled: false },
  // Temporary and worth noticing.
  caution: { color: "warning", filled: false },
  // Worth acting on.
  alarm: { color: "error", filled: false },
};

export default function StateChip({
  label,
  tone = "normal",
  size = "small",
  sx,
}: {
  label: string;
  tone?: ChipTone;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
}) {
  const { color, filled } = TONE[tone];
  return (
    <Chip
      size={size}
      label={label}
      color={color}
      variant={filled ? "filled" : "outlined"}
      sx={{ textTransform: "capitalize", ...sx }}
    />
  );
}

/**
 * The tone for a status word, decided once for the whole product.
 *
 * The one place the product's status vocabulary is mapped. Left to each module,
 * `leave` calls approved `success`, `expenses` calls approved `info` and
 * *reimbursed* `success`, `crm/invoices` calls paid `success` — each defensible
 * alone, and together they mean green has no fixed meaning and the same word is
 * two colours on two screens.
 * The question is never "what colour
 * is 'approved'" but the two questions `StateChip` asks: **is this the normal
 * resting state of a row** (filled, in the accent), and **does it need
 * attention** (and only then, a status hue).
 *
 * Unknown words fall to `normal` rather than throwing — a module that adds a
 * status gets a sensible chip and can add its word here when somebody notices.
 */
const TONE_BY_STATUS: Record<string, ChipTone> = {
  // The settled, ordinary outcome. The row is fine; nothing is owed.
  active: "normal",
  approved: "normal",
  paid: "normal",
  reimbursed: "normal",
  resolved: "normal",
  done: "normal",
  completed: "normal",
  finalized: "normal",
  published: "normal",
  accepted: "normal",
  submitted: "normal",

  // Somebody still has to do something. Worth noticing, not worth alarm.
  pending: "caution",
  requested: "caution",
  open: "caution",
  in_progress: "caution",
  in_review: "caution",
  on_leave: "caution",
  processing: "caution",
  awaiting: "caution",
  trialing: "caution",

  // Ended, closed, filed away. Real, but not the norm and not urgent.
  draft: "muted",
  closed: "muted",
  cancelled: "muted",
  archived: "muted",
  withdrawn: "muted",
  superseded: "muted",
  resigned: "muted",
  planning: "muted",
  on_hold: "muted",
  todo: "muted",

  // Worth acting on.
  rejected: "alarm",
  failed: "alarm",
  overdue: "alarm",
  terminated: "alarm",
  blocked: "alarm",
  breached: "alarm",
  suspended: "alarm",
};

export function toneFor(status: string | null | undefined): ChipTone {
  if (!status) return "muted";
  return TONE_BY_STATUS[String(status).toLowerCase()] ?? "normal";
}

/**
 * The employment states, mapped once.
 *
 * Exported so the directory, the dashboard card and anything else showing a
 * person's state read from one map. A second copy drifts, and the drift shows
 * up as the same employee in two different colours on two screens.
 */
export const EMPLOYMENT_TONE: Record<string, ChipTone> = {
  active: "normal",
  on_leave: "caution",
  resigned: "muted",
  terminated: "alarm",
};
