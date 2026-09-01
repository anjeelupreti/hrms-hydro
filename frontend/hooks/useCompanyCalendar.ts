"use client";

import { useQuery } from "@tanstack/react-query";

import { useCompanyProfile } from "@/hooks/useOrganization";

/**
 * The company's calendar, and the data to render a month of it.
 *
 * **Why the server serves the grid.** A date picker needs month lengths and
 * conversions locally to feel responsive, and the obvious move is a JavaScript
 * BS converter. That would put a *second* conversion table in the product —
 * and a converter disagreeing with the server by one day is a payroll period
 * boundary in the wrong place, which nothing downstream can detect.
 *
 * This codebase has been bitten four times by one question having two answers.
 * One month is one small request and BS month lengths for a past year never
 * change, so it caches indefinitely.
 */

export type CalendarDay = {
  day: number;
  /** What actually gets submitted. Storage stays Gregorian everywhere. */
  gregorian: string;
  weekday: number;
};

export type CalendarMonth = {
  calendar: "BS" | "AD";
  year: number;
  month: number;
  month_name: string;
  /** All twelve, so anything that needs to *offer* a month — the payroll
   *  period picker, a filter — can, without the browser keeping its own
   *  list of Nepali month names to fall out of step with this one. */
  month_names: string[];
  days: CalendarDay[];
  today: { gregorian: string; year: number; month: number; day: number };
};

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

/** Which calendar this company chose at setup. Defaults to Gregorian while the
 *  profile is loading, so a picker never renders BS chrome and then swaps. */
export function useCalendarKey(): "BS" | "AD" {
  const { data: profile } = useCompanyProfile();
  return profile?.calendar ?? "AD";
}

export function useCalendarMonth(year?: number, month?: number, enabled = true) {
  const params = new URLSearchParams();
  if (year) params.set("year", String(year));
  if (month) params.set("month", String(month));

  return useQuery({
    queryKey: ["calendar-month", year ?? "current", month ?? "current"],
    queryFn: () =>
      json<CalendarMonth>(`/api/proxy/organization/calendar/month?${params.toString()}`),
    enabled,
    // A past month's shape is a fact about a table, not about our data.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * The month `offset` months from the current one, in the company's calendar.
 *
 * **Lifted out of `BikramMonthGrid`.** The grid owned this, which meant the
 * only component that knew *which month is on screen* was the one drawing it —
 * so the agenda beside it could not summarise the month the reader was looking
 * at. Here it is shared, and both queries are cached forever, so the second
 * caller costs nothing.
 *
 * The roll into a real `(year, month)` pair matters: asking the server for
 * month 13 or month 0 is a 400, and `offset` is a plain counter that walks off
 * both ends of a year.
 */
export function useResolvedMonth(offset: number) {
  const { data: current } = useCalendarMonth();

  const monthNumber = current ? current.month + offset : undefined;
  const rolled =
    current !== undefined && monthNumber !== undefined
      ? {
          year: current.year + Math.floor((monthNumber - 1) / 12),
          month: ((((monthNumber - 1) % 12) + 12) % 12) + 1,
        }
      : undefined;

  return useCalendarMonth(rolled?.year, rolled?.month, rolled !== undefined);
}

export type LocalDate = {
  year: number;
  month: number;
  day: number;
  month_name: string;
  label: string;
};

export type ConvertedDate = {
  calendar: "BS" | "AD";
  gregorian: string;
  local: LocalDate | null;
};

/** One stored date, rendered in the company's calendar. */
export function useConvertedDate(gregorian: string | null | undefined) {
  return useQuery({
    queryKey: ["calendar-convert", gregorian],
    queryFn: () =>
      json<ConvertedDate>(`/api/proxy/organization/calendar/convert?date=${gregorian}`),
    enabled: Boolean(gregorian),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * The same conversion, for dates that arrive one component at a time.
 *
 * A table of fifty rows renders fifty `<DateText>`s, each of which knows only
 * its own date — so the naive version is fifty requests, and the browser only
 * runs six at once. This collects everything asked for within a single tick
 * and sends one request for the lot.
 *
 * It is a batching *transport*, not a second conversion table: the server
 * still answers every date, and the answer for a given date is identical
 * whichever call shape asked for it.
 */
let pending: string[] = [];
let inFlight: Promise<Record<string, LocalDate | null>> | null = null;

function loadBatch(): Promise<Record<string, LocalDate | null>> {
  if (!inFlight) {
    inFlight = new Promise((resolve, reject) => {
      // A microtask, so every DateText mounted in this render lands in the
      // same batch — they all queue before the browser gets a turn.
      queueMicrotask(() => {
        const dates = pending;
        pending = [];
        inFlight = null;
        if (dates.length === 0) {
          resolve({});
          return;
        }
        json<{ dates: Record<string, LocalDate | null> }>(
          `/api/proxy/organization/calendar/convert?dates=${encodeURIComponent(dates.join(","))}`
        )
          .then((body) => resolve(body.dates))
          .catch(reject);
      });
    });
  }
  return inFlight;
}

export function useConvertedDateBatched(gregorian: string | null | undefined) {
  return useQuery({
    // The same key space as `useConvertedDate` would be wrong — that one
    // caches a whole response envelope, this one caches the local date alone.
    queryKey: ["calendar-local", gregorian],
    queryFn: async () => {
      pending.push(gregorian as string);
      const batch = await loadBatch();
      return batch[gregorian as string] ?? null;
    },
    enabled: Boolean(gregorian),
    staleTime: Infinity,
    gcTime: Infinity,
    // A date that failed to convert is not worth hammering: the answer will
    // not have changed by the second attempt.
    retry: false,
  });
}
