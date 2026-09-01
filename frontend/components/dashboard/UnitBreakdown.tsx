"use client";

import Box from "@mui/material/Box";

import { analyticsCard } from "@/lib/theme/cards";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import CardEmpty from "@/components/dashboard/CardEmpty";

/**
 * A whole, broken into named parts — as a hundred squares rather than a bar.
 *
 * One form for one question: *what is this made of?* Left to each page, that
 * arrives as a big percentage over a four-colour bar in one place and a stacked
 * bar with a legend in another — two visual languages for the same idea.
 *
 * **A waffle, because the unit is the point.** A stacked bar at these sizes
 * turns a 4% slice into three pixels — visible as a colour change and not as a
 * quantity. A hundred squares makes "four in a hundred" literally countable,
 * and it degrades honestly: the eye reads the block, and anyone who cares can
 * count the row.
 *
 * **One hue, stepped by order, not four colours.** Four categorical hues imply
 * four unrelated things; these are parts of one total, and the only relationship
 * that matters is size. The first slice is the darkest because it is almost
 * always the one somebody is looking for — days present, the commonest leave
 * type — and the tail fades into the ground it sits on.
 *
 * **Every part is labelled with its own count.** A legend that only carries
 * colours makes the reader hold a key in their head while looking at the
 * squares; putting the number on the label removes that entirely.
 */

export type Part = { label: string; value: number };

const CELLS = 100;

export default function UnitBreakdown({
  title,
  subtitle,
  parts,
  empty,
  unit = "",
  headline,
}: {
  title: string;
  subtitle?: string;
  parts: Part[];
  empty: string;
  /** Singular noun for the tooltip — "day", "request". */
  unit?: string;
  /** Optional big figure. Omit and the card leads with the waffle. */
  headline?: { value: string; caption: string };
}) {
  const ranked = [...parts].filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const total = ranked.reduce((sum, p) => sum + p.value, 0);

  // Largest-remainder allocation. Rounding each share independently gives 99 or
  // 101 squares, and a hundred-square grid that is not a hundred squares is the
  // one mistake this chart cannot survive.
  const exact = ranked.map((p) => (p.value / total) * CELLS);
  const floors = exact.map(Math.floor);
  let left = CELLS - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  const counts = [...floors];
  for (const { index } of order) {
    if (left <= 0) break;
    counts[index] += 1;
    left -= 1;
  }

  const cells: { part: Part; shade: number }[] = [];
  ranked.forEach((part, index) => {
    // Steps of one hue. Floors at 0.18 so the smallest slice is still visible
    // against the card rather than fading into it.
    const shade = Math.max(0.18, 1 - index * (0.8 / Math.max(ranked.length - 1, 1)));
    for (let i = 0; i < counts[index]; i += 1) cells.push({ part, shade });
  });

  return (
    <Card sx={analyticsCard}>
      <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        ) : null}

        {total === 0 ? (
          <CardEmpty>{empty}</CardEmpty>
        ) : (
          <>
            {headline ? (
              <Box sx={{ mt: 1.5 }}>
                <Typography sx={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1, letterSpacing: "-.03em" }}>
                  {headline.value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {headline.caption}
                </Typography>
              </Box>
            ) : null}

            <Box
              sx={{
                mt: 2,
                display: "grid",
                gridTemplateColumns: "repeat(20, 1fr)",
                gap: "3px",
                maxWidth: 320,
              }}
            >
              {cells.map((cell, index) => (
                <Tooltip
                  key={index}
                  title={`${cell.part.label} — ${cell.part.value}${unit ? ` ${unit}${cell.part.value === 1 ? "" : "s"}` : ""}`}
                >
                  <Box
                    sx={{
                      aspectRatio: "1",
                      borderRadius: "2px",
                      bgcolor: "primary.main",
                      opacity: cell.shade,
                    }}
                  />
                </Tooltip>
              ))}
            </Box>

            <Stack spacing={0.6} sx={{ mt: 2 }}>
              {ranked.map((part, index) => {
                const shade = Math.max(0.18, 1 - index * (0.8 / Math.max(ranked.length - 1, 1)));
                return (
                  <Stack key={part.label} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Box
                      sx={{
                        width: 9,
                        height: 9,
                        borderRadius: "2px",
                        bgcolor: "primary.main",
                        opacity: shade,
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="caption" sx={{ flexGrow: 1 }} noWrap>
                      {part.label}
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {part.value}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 34, textAlign: "right" }}>
                      {Math.round((part.value / total) * 100)}%
                    </Typography>
                  </Stack>
                );
              })}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
