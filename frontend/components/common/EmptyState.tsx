"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

type Variant = "empty" | "noResults" | "error";

type Props = {
  /** What kind of nothing this is. Drives the artwork and the default copy. */
  variant?: Variant;
  title: string;
  /** One or two sentences: what this list is for, or what went wrong. */
  description?: ReactNode;
  /** The one thing to do next. */
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
  /**
   * Wrap in a bordered panel spanning the container.
   *
   * Use for a *page-level* empty list, so it reads as the content area rather
   * than as text floating where rows would have been. Leave off inside a
   * table cell or a dialog, which already provide the frame.
   */
  surface?: boolean;
  /**
   * Fill the parent and centre in it, both axes.
   *
   * For a *pane* that already has a frame and a height — a mail list column, a
   * reader pane, a dialog body. Without it the copy pins itself to the top of a
   * tall empty column, which reads as a rendering fault rather than as a state.
   */
  fill?: boolean;
};

/**
 * The one empty state.
 *
 * An empty list is the screen a new customer sees most often, so every one gets
 * artwork, a sentence of explanation and the primary action. "No assets yet."
 * in grey 14px tells a first-time user nothing about what assets are for or how
 * to get one.
 *
 * Three variants, because they are genuinely different situations and blurring
 * them is why people re-run a search that was never going to match:
 *
 *   empty      — nothing exists yet. Explain the feature, offer to create.
 *   noResults  — things exist, this filter matched none. Offer to clear.
 *   error      — we failed. Offer to retry.
 */
export default function EmptyState({
  variant = "empty",
  title,
  description,
  action,
  icon,
  compact = false,
  surface = false,
  fill = false,
}: Props) {
  /**
   * Used *inside* cards, where the card already provides the frame, the title
   * and the context — so it is a line and a small mark, not trimmed padding
   * around 96px of artwork. A dashboard of in-card empty states at ~220px each
   * is most of a screen spent on "No leave taken yet", "Nothing contributed
   * yet", "Nothing is assigned to you".
   *
   * A page-level empty state is the screen a new customer sees most often and
   * deserves artwork and a sentence. An empty state inside a card that already
   * says what it is deserves one line and a small mark beside it.
   */
  if (compact) {
    return (
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "flex-start", py: 2, px: 0.5 }}
        role={variant === "error" ? "alert" : undefined}
      >
        <Box sx={{ flexShrink: 0, mt: 0.25 }}>{icon ?? <Mark variant={variant} />}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          {description && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
              {description}
            </Typography>
          )}
          {action && <Box sx={{ pt: 1 }}>{action}</Box>}
        </Box>
      </Stack>
    );
  }

  const content = (
    <Stack
      spacing={1.5}
      sx={{ alignItems: "center", textAlign: "center", py: 7, px: 3 }}
      role={variant === "error" ? "alert" : undefined}
    >
      <Box sx={{ mb: 0.5 }}>{icon ?? <Artwork variant={variant} />}</Box>

      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>

      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      )}

      {action && <Box sx={{ pt: 1 }}>{action}</Box>}
    </Stack>
  );

  if (!surface && !fill) return content;

  return (
    <Box
      sx={{
        width: "100%",
        display: "grid",
        placeItems: "center",
        px: 2,
        // A pane owns its height, so take all of it and centre inside. A page
        // panel has no height of its own, so claim a deliberate one — enough to
        // look composed, not so much that it pushes the fold on a laptop.
        ...(fill
          ? { flex: 1, minHeight: 0, height: "100%" }
          : { minHeight: { xs: 300, sm: 420 } }),
        ...(surface && {
          borderRadius: 3,
          border: "1px dashed",
          borderColor: "divider",
          bgcolor: "background.paper",
        }),
      }}
    >
      {content}
    </Box>
  );
}

/** The compact mark: the same idea as `Artwork` at a quarter of the room. */
function Mark({ variant }: { variant: Variant }) {
  const tone = variant === "error" ? "danger" : variant === "noResults" ? "info" : "neutral";
  return (
    <Box
      aria-hidden
      sx={{
        width: 30,
        height: 30,
        display: "grid",
        placeItems: "center",
        borderRadius: "50%",
        bgcolor: `var(--hrms-status-${tone}-bg)`,
        color: `var(--hrms-status-${tone}-fg)`,
        border: "1px solid",
        borderColor: `var(--hrms-status-${tone}-border)`,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 42 42" fill="none" aria-hidden>
        <rect x="7" y="10" width="28" height="24" rx="3" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
        <path d="M7 17h28" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
        <path d="M13 24h9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </Box>
  );
}

/**
 * Inline SVG rather than an image file: it inherits the theme, costs no
 * request, and is correct in both colour schemes without a second asset.
 */
function Artwork({ variant }: { variant: Variant }) {
  const tone = variant === "error" ? "danger" : variant === "noResults" ? "info" : "neutral";

  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        width: 96,
        height: 96,
        display: "grid",
        placeItems: "center",
        borderRadius: "50%",
        bgcolor: `var(--hrms-status-${tone}-bg)`,
        color: `var(--hrms-status-${tone}-fg)`,
        border: "1px solid",
        borderColor: `var(--hrms-status-${tone}-border)`,
        boxShadow: `0 0 0 10px color-mix(in srgb, ${theme.vars.palette.background.default} 60%, transparent)`,
      })}
    >
      <svg width="42" height="42" viewBox="0 0 42 42" fill="none" aria-hidden>
        {variant === "empty" && (
          <>
            <rect x="7" y="10" width="28" height="24" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.5" />
            <path d="M7 17h28" stroke="currentColor" strokeWidth="2" opacity="0.5" />
            <path d="M13 24h9M13 29h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
        {variant === "noResults" && (
          <>
            <circle cx="19" cy="19" r="10" stroke="currentColor" strokeWidth="2" opacity="0.6" />
            <path d="M26.5 26.5 34 34" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M15 19h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
        {variant === "error" && (
          <>
            <path
              d="M21 8.5 36 32.5H6L21 8.5Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              opacity="0.6"
            />
            <path d="M21 18v6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="21" cy="28" r="1.5" fill="currentColor" />
          </>
        )}
      </svg>
    </Box>
  );
}
