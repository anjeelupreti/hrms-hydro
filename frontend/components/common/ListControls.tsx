"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import type { ReactNode } from "react";

import SearchField from "@/components/common/SearchField";

type Props = {
  /** Omit both to render the card without a search box. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;

  /** Pickers and selects that narrow the list — they sit beside the search. */
  filters?: ReactNode;
  /** Pushed to the right of the same row: view switches, export buttons. */
  trailing?: ReactNode;
  /** The status chips. Rendered on their own line under the search row. */
  chips?: ReactNode;
  /** Tabs — "Current / Past" — between the search row and the chips. */
  tabs?: ReactNode;
};

/**
 * The band under a page header where a list is narrowed: search, then filters,
 * then the status chips.
 *
 * **Why this exists.** Twenty-three list pages put their search box inside
 * `PageHeader actions`, wedged between the title and the "New …" button. That
 * put the control that narrows the list in the row reserved for the actions
 * that add to it, made the header wrap on any page with two buttons, and — the
 * real cost — separated search from the filters it works with, which were
 * somewhere below. The employees page did it the other way and was the one
 * people liked, so its arrangement is the one every list now gets:
 *
 *     ┌ search ┆ filters ……………………………… trailing ┐
 *     │ ‹tabs›                                   │
 *     └ chips                                    ┘
 *
 * A component rather than a convention, because a convention is what the last
 * twenty-three pages were following.
 *
 * The card is `mb: 2` and the chips `mt: 2` — fixed here so the gap between a
 * header and its list is the same everywhere. Pages were each choosing their
 * own, which is why the top of every list sat at a slightly different height.
 */
export default function ListControls({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  searchLabel,
  filters,
  trailing,
  chips,
  tabs,
}: Props) {
  const hasSearch = search !== undefined && onSearchChange !== undefined;
  // Nothing to draw is better than an empty card taking up a band of space at
  // the top of the list.
  if (!hasSearch && !filters && !trailing && !chips && !tabs) return null;

  return (
    <Card sx={{ p: 2, mb: 2 }}>
      {hasSearch || filters || trailing ? (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          useFlexGap
          sx={{ flexWrap: "wrap", alignItems: { sm: "center" } }}
        >
          {hasSearch ? (
            <SearchField
              value={search}
              onChange={onSearchChange}
              placeholder={searchPlaceholder}
              label={searchLabel}
              sx={{ width: "100%", maxWidth: { sm: 260 } }}
            />
          ) : null}
          {filters}
          {trailing ? (
            <>
              <Box sx={{ flex: 1 }} />
              {trailing}
            </>
          ) : null}
        </Stack>
      ) : null}

      {tabs}

      {chips ? <Box sx={{ mt: 2 }}>{chips}</Box> : null}
    </Card>
  );
}
