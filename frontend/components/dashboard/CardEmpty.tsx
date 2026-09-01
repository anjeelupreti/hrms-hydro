"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/**
 * The empty state for a dashboard card that has a height to fill.
 *
 * An empty card drawn at the weight of a full one is what makes a dashboard
 * look unfinished — same frame, same height (cards stretch to match their
 * tallest neighbour), a line of grey text pinned to the top and 150px of blank
 * beneath it. Six of those on a page read as a rendering fault rather than as
 * six things that happen to have no data today.
 *
 * `EmptyState` already had the argument written on its `fill` prop — *"without
 * it the copy pins itself to the top of a tall empty column, which reads as a
 * rendering fault rather than as a state"* — and the dashboard cards did not
 * use it.
 *
 * So: centred on both axes, so the blank space is obviously deliberate; and
 * lighter than the content it replaces, so a page of empty cards recedes
 * instead of shouting. Not hidden — a card that vanishes when empty teaches
 * people the dashboard is missing sections.
 */
export default function CardEmpty({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        flexGrow: 1,
        minHeight: 96,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        px: 2,
        py: 3,
      }}
    >
      <Typography variant="body2" sx={{ color: "text.disabled", maxWidth: 260 }}>
        {children}
      </Typography>
    </Box>
  );
}
