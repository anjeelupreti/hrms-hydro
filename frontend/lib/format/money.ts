/**
 * One way to write money.
 *
 * **One formatter, because eight is what happens otherwise.** Left to each
 * screen, `en-NP` here and `en-IN` with a `Rs` prefix there and compact
 * notation somewhere else — and the same salary reads as `45,000.00`,
 * `Rs 45,000` and `45K` on three screens of one product. Three figures, as far
 * as anybody looking can tell.
 *
 * **Digits only by default.** The symbol is the caller's business: a payslip
 * column wants bare figures under a heading that already names them, a summary
 * tile wants the unit. Baking a symbol in here is how two screens come to
 * disagree about whether money has a prefix.
 *
 * **Two decimals, always, for exact figures.** Money that drops its paise reads
 * as an estimate, and the one place people check a payslip against is the bank.
 * `compact` exists for the places that genuinely want magnitude — a filter chip,
 * an axis tick — and is never used for a figure somebody reconciles.
 */

/** The locale money is written in. Fixed rather than `undefined`, so a figure
 *  does not change shape when the same page is opened on a different machine. */
const LOCALE = "en-IN";

/**
 * An exact figure: `45,000.00`.
 *
 * Non-numeric input formats as zero rather than `NaN` — a blank field in a form
 * is a legitimate "nothing yet", and `NaN` on a payslip is alarming in a way the
 * underlying state is not.
 */
export function money(value: string | number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0.00";
  return amount.toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Magnitude, for somewhere narrow: `45K`, `1.2M`.
 *
 * For filter chips, axis ticks and stage headers — never for a figure anybody
 * reconciles against a bank statement.
 */
export function moneyCompact(value: string | number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount === 0) return "0";
  return Intl.NumberFormat(LOCALE, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

/** The symbol, where a figure needs to carry its own unit. */
export const CURRENCY_PREFIX = "Rs ";

/** A whole-rupee figure, for places where paise are noise: `Rs 45,000`. */
export function moneyRounded(value: string | number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString(LOCALE, { maximumFractionDigits: 0 });
}
