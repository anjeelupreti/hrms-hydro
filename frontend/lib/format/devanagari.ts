/**
 * Nepali script, for the places that are showing a Nepali thing.
 *
 * **What is safe to do in the browser, and what is not.** Digits are a
 * ten-character map with no arithmetic behind them, and the Bikram Sambat month
 * names are a fixed list of twelve — neither can drift. The *conversion* is the
 * dangerous part: BS months are 29 to 32 days and the length of a given month
 * varies by year, from a published table rather than a formula. That stays on
 * the server, where the table lives, and every date the browser renders has
 * already been converted there. This file translates script, never dates.
 *
 * The font is loaded in `app/layout.tsx` as `--font-devanagari` (Noto Sans
 * Devanagari), because the body face has no Devanagari coverage at all: without
 * it Nepali falls through to whatever the machine happens to have, which is a
 * different face on Windows and a Mac, and on a machine with none, boxes.
 */

const NP_DIGITS = "०१२३४५६७८९";

/** `2083` becomes `२०८३`. Leaves everything that is not a digit alone. */
export function toDevanagari(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => NP_DIGITS[Number(digit)]);
}

/**
 * The twelve Bikram Sambat months in Devanagari, in order from Baishakh.
 *
 * Indexed from zero, so month 5 (Bhadra) is `BS_MONTHS_NE[4]`. The server sends
 * the romanised name and a one-based month number; this maps the number, not
 * the name, because a spelling that changes on the server would silently miss.
 */
export const BS_MONTHS_NE = [
  "बैशाख",
  "जेठ",
  "असार",
  "साउन",
  "भदौ",
  "असोज",
  "कात्तिक",
  "मंसिर",
  "पुष",
  "माघ",
  "फागुन",
  "चैत",
] as const;

/** Sunday first, the way a Nepali calendar is printed. */
export const BS_WEEKDAYS_NE = ["आइत", "सोम", "मंगल", "बुध", "बिहि", "शुक्र", "शनि"] as const;

/**
 * `5, 2083` becomes `भदौ २०८३`.
 *
 * Returns an empty string for a month outside 1–12 rather than throwing or
 * rendering `undefined २०८३`: this is a label, and a label is not worth
 * crashing a calendar over.
 */
export function bsMonthLabel(month: number, year: number): string {
  const name = BS_MONTHS_NE[month - 1];
  return name ? `${name} ${toDevanagari(year)}` : "";
}

/**
 * The font stack for Devanagari text.
 *
 * A stack rather than a single family, so a string with Latin in it — a holiday
 * name somebody typed in English — still falls through to the body face instead
 * of being rendered in a Devanagari font that has no opinion about it.
 */
export const DEVANAGARI_FONT = "var(--font-devanagari), var(--font-sans)";
