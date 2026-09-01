"use client";

import { useCallback, useState } from "react";

export const DEFAULT_PAGE_SIZE = 25;

/**
 * Page state for a server-paginated list.
 *
 * Every list was reinventing this, or — more often — not having it: the hook
 * asked for `page_size=100`, the server clamped there, and the screen showed a
 * hundred rows while believing it held everything. On the system with two
 * hundred people that is not a display quirk, it is records nobody can reach.
 *
 * 1-indexed, matching DRF, so the number here is the number in the request.
 *
 * Changing the page size returns to the first page, and `reset` exists for
 * filter changes: narrowing a list while sitting on page 7 lands on a page that
 * no longer exists, and an empty screen reads as "no results" rather than
 * "wrong page".
 */
export function usePagedList(initialPageSize: number = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize, setSize] = useState(initialPageSize);

  const setPageSize = useCallback((next: number) => {
    setSize(next);
    setPage(1);
  }, []);

  const reset = useCallback(() => setPage(1), []);

  return { page, pageSize, setPage, setPageSize, reset };
}
