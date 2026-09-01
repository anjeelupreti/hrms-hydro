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
}: {
  /** `YYYY-MM-DD`, or a full ISO timestamp — the date part is what is used. */
  value: string | null | undefined;
  /** `long` → "2 Bhadra 2083". `short` → "2 Bhadra", for tables and chips. */
  format?: "long" | "short";
  fallback?: string;
}) {
  const calendar = useCalendarKey();
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
      </>
    );
  }

  // Not converted yet, or outside the table's range. Either way the Gregorian
  // date is the honest thing to show — a plausible wrong BS date would be
  // worse, because nothing downstream could tell it apart from a right one.
  if (!local) return <>{day || fallback}</>;

  return (
    <>
      {format === "short"
        ? `${local.day} ${local.month_name}`
        : `${local.day} ${local.month_name} ${local.year}`}
    </>
  );
}
