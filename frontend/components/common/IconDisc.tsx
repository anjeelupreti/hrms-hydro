"use client";

import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

/**
 * An icon in a container — and **the one place that decides which container.**
 *
 * The one rule for an icon in a disc. Inlined per call site the app ends up
 * with discs of slightly different sizes and radii on pages that sit next to
 * each other, and with some icons filled, some tinted, some gradient and some
 * outlined for no reason a reader can infer.
 *
 * Three variants, each with a job:
 *
 * - **`solid`** — the identity mark of a screen or a row that is *selected*.
 *   The heaviest thing available, so **at most one per context**. A page
 *   header's icon; the active item in the sidebar. Eight solid discs down a
 *   list read as eight buttons and the eye lands on the decoration instead of
 *   the name beside it.
 * - **`tint`** — a section or card heading. Present, grouped, quieter than the
 *   title it sits next to.
 * - **`outline`** — a row in a list. Carries the same colour and grouping at a
 *   fraction of the weight, which is what a repeated element needs.
 *
 * **Gradients are not on this list, deliberately.** They belong to deliberately
 * decorative surfaces — the hero panel, the auth screen, a celebration card —
 * and nowhere near functional chrome. A gradient on a button or an icon tile is
 * the thing that makes a product look assembled from several.
 */

export type DiscVariant = "solid" | "tint" | "outline";

export default function IconDisc({
  children,
  variant = "tint",
  /** A theme role, or a literal hue for module identity. */
  tone = "primary",
  size = 40,
  rounded = true,
  sx,
}: {
  children: ReactNode;
  variant?: DiscVariant;
  tone?: "primary" | "secondary" | "success" | "warning" | "error" | "info" | string;
  size?: number;
  /** Square-ish for a heading, circular for a person. */
  rounded?: boolean;
  sx?: SxProps<Theme>;
}) {
  // A palette role resolves through the theme; anything else is taken as a
  // literal colour, which is how module hues are passed in.
  const isRole = ["primary", "secondary", "success", "warning", "error", "info"].includes(tone);
  const colour = isRole ? `${tone}.main` : tone;
  const mix = (pct: number) =>
    isRole
      ? (t: Theme) =>
          `color-mix(in srgb, ${t.vars.palette[tone as "primary"].main} ${pct}%, transparent)`
      : `color-mix(in srgb, ${tone} ${pct}%, transparent)`;

  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: rounded ? Math.max(1.5, size / 18) : "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...(variant === "solid"
          ? { bgcolor: colour, color: isRole ? `${tone}.contrastText` : "#fff" }
          : variant === "tint"
            ? { bgcolor: mix(12), color: colour }
            : {
                bgcolor: "transparent",
                color: colour,
                border: "1.5px solid",
                borderColor: mix(45),
              }),
        "& svg": { fontSize: Math.round(size * 0.5) },
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
