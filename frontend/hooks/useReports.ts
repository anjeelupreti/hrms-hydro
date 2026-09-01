"use client";

import { useQuery } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

/**
 * A chart the server decided on, rather than one the browser guessed.
 *
 * **The shape belongs with the query.** Only the builder knows whether its rows
 * are a sequence (payroll periods, months of net change) or a ranking
 * (departments by headcount), and that is exactly the choice between columns
 * and bars. Inferring it here from the column headers would be a guess that is
 * wrong the first time a report has two numeric columns.
 *
 * `null` means this report has no picture worth drawing — an empty result, or
 * a register that is simply a list. That is different from an empty chart,
 * which reads as a broken one.
 */
export type ReportChart = {
  kind: "columns" | "bars";
  title: string;
  unit: "count" | "currency" | string;
  points: { label: string; value: number }[];
};

export type ReportData = {
  type: string;
  start: string;
  end: string;
  summary: { label: string; value: number }[];
  columns: string[];
  rows: (string | number)[][];
  chart: ReportChart | null;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, res.status));
  }
  return res.json();
}

export function useReport(
  type: string,
  start: string,
  end: string,
  enabled = true,
  department?: number | null,
) {
  const params = new URLSearchParams({ type, start, end });
  // Only when set. Sending `department=` empty would have the server parse an
  // empty string, and "no filter" is better said by not saying it.
  if (department) params.set("department", String(department));

  return useQuery({
    // `department` is in the key, or switching team would show the previous
    // team's rows from cache while the new ones load.
    queryKey: ["reports", type, start, end, department ?? null],
    queryFn: () => fetchJson<ReportData>(`/api/proxy/reports?${params.toString()}`),
    // Off until the browser has decided what "this month" is. The default range
    // is clock-derived and therefore cannot be computed during prerender — see
    // `lib/reports/ranges.defaultRange` — so without this the page would fire a
    // request for `start=&end=` first.
    enabled,
  });
}
