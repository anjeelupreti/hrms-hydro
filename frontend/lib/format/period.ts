/**
 * One way to write a date-only bucket on a chart axis.
 *
 * **Every trend endpoint in this product serves buckets as date-only ISO
 * strings** — `"2026-08-01"` for a month, the Sunday's date for a week — and
 * every chart that draws one has to turn that into something a reader can put
 * against a column. Left to each call site, that produced two failures within
 * the same week, both of which reached the screen:
 *
 * 1. **The expenses trend labelled all twelve columns `202`.** It did
 *    `String(m.month).slice(0, 3)`, which is the first three characters of
 *    `"2026-08-01"` — not the first three letters of a month name. Every column
 *    carried the same label, so the chart drew a shape with no way to tell
 *    which month any part of it was.
 *
 * 2. **`PeriodMatrix` was a month early west of UTC.** It did `new Date(iso)`,
 *    which reads a date-only string as *UTC* midnight, and then `getMonth()`,
 *    which reads back in local time. At any negative offset that lands on the
 *    last day of the month before.
 *
 * Both are the same mistake underneath — treating an ISO date as a string to
 * cut up, or as an instant — and both are why this lives in one place.
 *
 * **Parsed from its parts, never through `new Date(iso)`.** A bucket is a
 * calendar date, not a moment: the month a claim was filed in does not change
 * because the reader is in Toronto. Splitting the string and building a local
 * date is what keeps it that way.
 */

const MONTH_SHORT = new Intl.DateTimeFormat(undefined, { month: "short" });
const MONTH_LONG = new Intl.DateTimeFormat(undefined, { month: "long" });

/**
 * A date-only ISO string as a local calendar date.
 *
 * Returns `null` for anything that is not one, so a caller can fall back to
 * printing the raw value rather than rendering `Invalid Date` at the reader.
 */
export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [year, month, day] = String(iso).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `"2026-08-01"` → `"Aug"`. The axis label for a monthly bucket. */
export function monthLabel(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? MONTH_SHORT.format(date) : String(iso);
}

/**
 * `"2026-08-01"` → `"2026"`, but only in January.
 *
 * The second line under a month label, for a run of buckets that crosses a
 * year boundary. Printing the year under all twelve is noise — it is the same
 * answer eleven times — but a twelve-month window that starts in Bhadra ends
 * in the *next* Bhadra, and without a marker the two look like one month drawn
 * twice.
 */
export function yearMarker(iso: string): string | undefined {
  const date = parseIsoDate(iso);
  return date && date.getMonth() === 0 ? String(date.getFullYear()) : undefined;
}

/** `"2026-08-17"` → `"17/8"`. The axis label for a weekly bucket. */
export function weekLabel(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? `${date.getDate()}/${date.getMonth() + 1}` : String(iso);
}

/** `"2026-08-01"` → `"August 2026"`. For a tooltip or a caption, not an axis. */
export function monthTitle(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? `${MONTH_LONG.format(date)} ${date.getFullYear()}` : String(iso);
}

/**
 * A `Date` as a local `YYYY-MM-DD`, never through `toISOString()`.
 *
 * `toISOString()` converts to UTC first, so it reports the wrong calendar day
 * for part of every day. In Kathmandu (UTC+05:45) that is **00:00 to 05:44
 * local** — a date field defaulting to "today" at 2am fills in yesterday, and
 * an "is this overdue?" comparison flips for the same hours.
 *
 * The window moves with the offset but never closes: any zone east of UTC
 * breaks in the early morning, any zone west of it breaks in the evening.
 */
export function toIsoDate(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/** Today, as the reader's calendar has it. See `toIsoDate`. */
export function todayIso(): string {
  return toIsoDate(new Date());
}
