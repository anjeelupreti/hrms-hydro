"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export type PickerOption = {
  id: number;
  /** What the user reads and types against. */
  label: string;
  /** Disambiguates duplicates — an employee code, a client's industry. */
  secondary?: string;
  /** Person pickers only; falls back to initials. */
  avatarUrl?: string | null;
};

type PaginatedResponse<T> = {
  count: number;
  results: T[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}


/** How many options one dropdown shows before you are expected to keep typing. */
const PAGE_SIZE = 25;

type Args<T> = {
  /** Proxy path without query string, e.g. `/api/proxy/employees/employees`. */
  endpoint: string;
  /** Shape one API row into something the picker can render. */
  toOption: (row: T) => PickerOption;
  /** Ids currently chosen, so their labels can be resolved even when unlisted. */
  selectedIds: number[];
  /** Skip the network entirely until a dialog actually opens. */
  enabled?: boolean;
  /** Extra query params — scoping a designation list to a department, say. */
  params?: Record<string, string | number | undefined>;
};

/**
 * Server-side search for a picker, plus label resolution for the selection.
 *
 * The naive alternative — load the list once and filter it in the browser —
 * looks identical on seed data and breaks silently in production: the API caps
 * a page at 100 rows, so on a 500-person company the other 400 simply cannot be
 * chosen, with no error to notice. Search has to happen where the rows are.
 *
 * That creates a second problem this hook also solves. The selected row is
 * usually *not* in the page currently on screen — reopen a form and the picker
 * has page one while the saved value is #204. So the selection is resolved by a
 * separate `?ids=` request and kept regardless of what the search returns,
 * which is why chips keep their names while you type something that matches
 * none of them.
 */
export function useEntitySearch<T>({
  endpoint,
  toOption,
  selectedIds,
  enabled = true,
  params,
}: Args<T>) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);

  const extra = Object.entries(params ?? {})
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);

  const optionsUrl = (() => {
    const search = new URLSearchParams([["page_size", String(PAGE_SIZE)], ...extra]);
    if (debouncedQuery.trim()) search.set("search", debouncedQuery.trim());
    return `${endpoint}?${search.toString()}`;
  })();

  const optionsQuery = useQuery({
    queryKey: ["picker", endpoint, debouncedQuery, extra],
    queryFn: () => fetchJson<PaginatedResponse<T>>(optionsUrl),
    enabled,
    // Keep the previous page visible while the next one loads, so the list does
    // not blink to empty on every keystroke.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });

  // Sorted and joined so ["3","1"] and ["1","3"] share one cache entry.
  const idsKey = [...selectedIds].sort((a, b) => a - b).join(",");

  const selectedQuery = useQuery({
    queryKey: ["picker", endpoint, "ids", idsKey],
    queryFn: () => fetchJson<PaginatedResponse<T>>(`${endpoint}?ids=${idsKey}`),
    enabled: enabled && idsKey.length > 0,
    staleTime: 5 * 60_000,
  });

  const options = (optionsQuery.data?.results ?? []).map(toOption);
  const selected = (selectedQuery.data?.results ?? []).map(toOption);

  // The search page and the resolved selection overlap whenever a chosen row
  // also matches the current query; de-dupe so Autocomplete does not warn about
  // repeated keys.
  const byId = new Map<number, PickerOption>();
  for (const option of [...selected, ...options]) byId.set(option.id, option);

  return {
    query,
    setQuery,
    /** Everything renderable right now: the current page plus the selection. */
    options: [...byId.values()],
    selected,
    loading: optionsQuery.isFetching || selectedQuery.isFetching,
    error: optionsQuery.error as Error | null,
    /** True when the server has more rows than this page shows. */
    hasMore: (optionsQuery.data?.count ?? 0) > (optionsQuery.data?.results.length ?? 0),
    total: optionsQuery.data?.count ?? 0,
  };
}
