import type { SxProps, Theme } from "@mui/material/styles";

/**
 * One shape for every analytics card, so a row of them cannot come out ragged.
 *
 * A grid row takes its height from its tallest member, so a card holding two
 * lines of "nothing yet" beside a card holding a chart leaves a few hundred
 * pixels of blank page between them: each card fine on its own, the page
 * looking broken.
 *
 * Two rules, and they only work together:
 *
 * **`height: 100%`** — stretch to the row, so a short card never leaves a void
 * beside a tall neighbour.
 *
 * **`minHeight`** — a floor, so a row where *everything* is empty is still a
 * row of cards rather than a strip of captions. Without this the first rule
 * does nothing: stretching to match a neighbour that is also empty still
 * collapses.
 *
 * The content stays free to be empty — an empty card with a sentence in the
 * middle of it is an honest state, and `CardEmpty` centres it deliberately.
 * What is fixed here is the *frame*, which is the part the eye reads as layout.
 */
export const ANALYTICS_CARD_MIN_HEIGHT = 268;

/**
 * The body has to stretch too, or the floor does nothing useful.
 *
 * A `minHeight` on the card alone gives a tall frame with its content pinned to
 * the top and blank space beneath — which is the *original* complaint ("empty
 * cards weighted like full ones") reproduced inside the card instead of between
 * cards. Making the body a growing flex column lets `CardEmpty` centre in the
 * space the floor created.
 */
const stretchBody = {
  "& > .MuiCardContent-root": {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
  },
} as const;

/** For a card that carries a chart or a list and sits in a grid row. */
export const analyticsCard: SxProps<Theme> = {
  height: "100%",
  minHeight: ANALYTICS_CARD_MIN_HEIGHT,
  display: "flex",
  flexDirection: "column",
  ...stretchBody,
};

/**
 * For the shorter cards — a person strip, a compact panel.
 *
 * Deliberately a second size rather than one universal floor: forcing a strip
 * of face cards to 268px would put the void *inside* the card instead of
 * between them, which trades one gap for another.
 */
export const compactCard: SxProps<Theme> = {
  height: "100%",
  minHeight: 200,
  display: "flex",
  flexDirection: "column",
  ...stretchBody,
};
