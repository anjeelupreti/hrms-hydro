"use client";

import { useCalendarKey, useConvertedDateBatched } from "@/hooks/useCompanyCalendar";

/**
 * A stored date, *shown* in the calendar the company chose.
 *
 * `DateField` fixed the dates people type. This fixes the ones they read —
 * which is the larger half: a company on Bikram Sambat entered a BS join date
 * and then saw it come back as "17/08/2026" in every table that displayed it.
 *
 * Renders bare text, so it drops into a `TableCell`, a `Typography` or a
 * sentence without bringing a wrapper element along.
 *
 * **While the conversion is in flight it shows the Gregorian date**, not a
 * skeleton and not nothing. The date is already known and already true; the
 * only thing missing is which calendar it is being said in. A spinner where a
 * date belongs makes a table jump for no gain.
 */
export default function DateText({
  value,
  format = "long",
  fallback = "—",
  withTime = false,
}: {
  /** `YYYY-MM-DD`, or a full ISO timestamp — the date part is what is used. */
  value: string | null | undefined;
  /** `long` → "2 Bhadra 2083". `short` → "2 Bhadra", for tables and chips. */
  format?: "long" | "short";
  fallback?: string;
  /**
   * Append the clock time.
   *
   * **For a log, where the order of the day is the point.** Two recommendations
   * on the same afternoon are indistinguishable by date alone, and which came
   * first is exactly what somebody reads an action log to find out. Rendered
   * here rather than by each caller because the clock is the same in either
   * calendar — only the date converts — so every caller was writing the same
   * three lines beside this component.
   *
   * Silently ignored when the value carries no time.
   */
  withTime?: boolean;
}) {
  const calendar = useCalendarKey();

  /** " · 15:32", or nothing when the value is a bare date. */
  const clock = (() => {
    if (!withTime || !value || value.length <= 10) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return ` · ${parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  })();

  // Only the date part converts. A timestamp's clock is the same number in
  // either calendar, and callers that want the time render it themselves.
  const day = value ? value.slice(0, 10) : "";
  const { data: local } = useConvertedDateBatched(calendar === "BS" ? day || null : null);

  if (!value) return <>{fallback}</>;

  if (calendar !== "BS") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return <>{fallback}</>;
    return (
      <>
        {parsed.toLocaleDateString(
          undefined,
          format === "short"
            ? { month: "short", day: "numeric" }
            : { year: "numeric", month: "short", day: "numeric" }
        )}
        {clock}
      </>
    );
  }

  // Not converted yet, or outside the table's range. Either way the Gregorian
  // date is the honest thing to show — a plausible wrong BS date would be
  // worse, because nothing downstream could tell it apart from a right one.
  if (!local) return <>{(day || fallback) + clock}</>;

  return (
    <>
      {format === "short"
        ? `${local.day} ${local.month_name}${clock}`
        : `${local.day} ${local.month_name} ${local.year}${clock}`}
    </>
  );
}
