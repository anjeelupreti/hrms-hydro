"use client";

import { useQuery } from "@tanstack/react-query";

export type TodayCalendar = {
  date: string;
  label: string;
  fiscal_year: string;
  fiscal_year_np?: string;
};

export type Today = {
  timezone: string;
  gregorian: TodayCalendar;
  /** Null when the date falls outside the Bikram Sambat conversion table. */
  nepali: TodayCalendar | null;
};

/**
 * Today, as the company's calendars see it.
 *
 * **Why this comes from the server.** Bikram Sambat conversion is a ~100-year
 * lookup table with no formula behind it (see `core/calendars.py`). Shipping a
 * second copy to the browser would be a second table that can disagree with the
 * one payroll uses — on a date shown in the top bar of every page.
 *
 * **Why it is cached hard.** The answer changes at most once a day, so an hour
 * of `staleTime` is one request per session rather than one per navigation.
 * The live seconds come from the browser clock; only the *date* comes from
 * here.
 */
export function useToday() {
  return useQuery<Today>({
    queryKey: ["today"],
    queryFn: async () => {
      const res = await fetch("/api/proxy/organization/today");
      if (!res.ok) throw new Error("Could not load today");
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
