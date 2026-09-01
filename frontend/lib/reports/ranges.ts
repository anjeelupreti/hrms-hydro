/**
 * Date ranges for the reports page.
 *
 * **Local date components, never `toISOString`.** In Kathmandu (UTC+05:45)
 * `new Date().toISOString().slice(0, 10)` returns *yesterday* between 00:00 and
 * 05:44 local — a report range that starts and ends a day early for anybody
 * working early, missing the row they just entered and ran the report to check.
 *
 * **Quick ranges exist because two date pickers are not a range control.**
 * Nobody reads a report for "12 August to 30 August"; they read it for last
 * month, or this quarter, or the year so far. Typing the boundaries of a month
 * by hand is a chore with an off-by-one in it.
 */

import { toIsoDate } from "@/lib/format/period";

/** Re-exported so existing callers keep their name. See `toIsoDate`. */
export const isoOf = toIsoDate;

export type Range = { start: string; end: string };

export type QuickRange = {
  key: string;
  label: string;
  build: () => Range;
  /** Ranges that look ahead — offered for reports about what is scheduled. */
  forward?: boolean;
};

function monthRange(offset: number): Range {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { start: isoOf(start), end: isoOf(end) };
}

export const QUICK_RANGES: QuickRange[] = [
  {
    key: "mtd",
    label: "This month",
    build: () => {
      const now = new Date();
      return { start: isoOf(new Date(now.getFullYear(), now.getMonth(), 1)), end: isoOf(now) };
    },
  },
  { key: "last-month", label: "Last month", build: () => monthRange(-1) },
  {
    key: "quarter",
    label: "Last 3 months",
    build: () => {
      const now = new Date();
      return {
        start: isoOf(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
        end: isoOf(now),
      };
    },
  },
  {
    key: "year",
    label: "Last 12 months",
    build: () => {
      const now = new Date();
      return {
        start: isoOf(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())),
        end: isoOf(now),
      };
    },
  },
  {
    key: "ahead",
    label: "Next 90 days",
    forward: true,
    build: () => {
      const now = new Date();
      return {
        start: isoOf(now),
        end: isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90)),
      };
    },
  },
];

/**
 * The default range, and why it cannot be a `useState` initialiser.
 *
 * Next prerenders client components, so `new Date()` runs once in the
 * container (UTC) and once in the browser (Kathmandu, UTC+05:45). Just after
 * local midnight those are *different days*, and the two renders disagree.
 *
 * There is no "correct" value to render on the server — the server does not
 * know the reader's clock — so the honest answer is to render no range until
 * the browser has one, and to keep the report query switched off until then.
 */
export function defaultRange(): Range {
  const now = new Date();
  return { start: isoOf(new Date(now.getFullYear(), now.getMonth(), 1)), end: isoOf(now) };
}

/** Which quick range a `{start, end}` pair *is*, so the chip can show selected. */
export function matchQuickRange(range: Range) {
  return QUICK_RANGES.find((quick) => {
    const built = quick.build();
    return built.start === range.start && built.end === range.end;
  })?.key;
}
