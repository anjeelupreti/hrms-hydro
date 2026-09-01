"use client";

import { DATA_PALETTE } from "@/lib/theme/tokens";

/** How many distinct hues the validated palette actually guarantees. */
export const MAX_SERIES = DATA_PALETTE.categorical.length;

/**
 * The colour for series `index`, as a CSS variable.
 *
 * A variable rather than a hex so the value follows the colour scheme —
 * `--hrms-data-*` is emitted per scheme, and dark is stepped separately
 * because the light blue fails contrast on a dark surface.
 *
 * Returns undefined past the palette, deliberately. `palette[i % length]`
 * gives series 9 the same colour as series 1 — two different things painted
 * identically, which is worse than running out. Use `foldSeries` to group the
 * tail into "Other" instead.
 */
export function seriesColor(index: number): string | undefined {
  return index < MAX_SERIES ? `var(--hrms-data-${index + 1})` : undefined;
}

/**
 * Cap a categorical series list at the palette size, summing the remainder
 * into a single "Other" slice.
 *
 * Nine departments on a donut is nine wedges nobody reads anyway; the top
 * seven plus "Other" is both honest and legible.
 */
export function foldSeries<T>(
  items: T[],
  valueOf: (item: T) => number,
  labelOf: (item: T) => string
): { label: string; value: number; isOther: boolean }[] {
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  if (sorted.length <= MAX_SERIES) {
    return sorted.map((i) => ({ label: labelOf(i), value: valueOf(i), isOther: false }));
  }
  const head = sorted.slice(0, MAX_SERIES - 1);
  const tail = sorted.slice(MAX_SERIES - 1);
  return [
    ...head.map((i) => ({ label: labelOf(i), value: valueOf(i), isOther: false })),
    { label: "Other", value: tail.reduce((sum, i) => sum + valueOf(i), 0), isOther: true },
  ];
}
