"use client";

import { useMemo, useState } from "react";

/**
 * Client-side "type to narrow" for a loaded list.
 *
 * These pages already hold their whole page of rows in memory, so filtering
 * in the browser is both instant and honest — no extra round trip, and the
 * count you see is the count you have. Anything that outgrows a single page
 * of results should move its search to the API instead; this hook is for
 * the list-in-hand case, which is most of the app.
 *
 * The needle is matched against the concatenated `fields` of each row, so a
 * query like "laptop LAP-001" narrows across columns rather than requiring
 * the user to guess which one is searchable.
 */
export function useTextFilter<T>(
  items: T[],
  fields: (item: T) => (string | number | null | undefined)[]
) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return items;
    return items.filter((item) => {
      const haystack = fields(item)
        .filter((v) => v !== null && v !== undefined)
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    // `fields` is an inline lambda at every call site, so it is a new
    // reference each render — depending on it would defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query]);

  return {
    query,
    setQuery,
    filtered,
    /** True when a query is active but nothing matched — drives empty copy. */
    isEmptyResult: filtered.length === 0 && query.trim().length > 0,
  };
}
