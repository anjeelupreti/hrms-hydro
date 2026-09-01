"use client";

import GridViewIcon from "@mui/icons-material/GridView";
import TableRowsIcon from "@mui/icons-material/TableRows";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import SearchField from "@/components/common/SearchField";

export type ViewMode = "list" | "grid";

type Props = {
  /** Omit both to hide the search field entirely. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;

  /** Selects, date ranges — anything that narrows the list. */
  filters?: ReactNode;
  /** Active filters, so what is being excluded is visible and removable. */
  activeFilters?: { label: string; onClear: () => void }[];
  onClearAll?: () => void;

  view?: ViewMode;
  onViewChange?: (view: ViewMode) => void;

  /** Export, bulk actions — things that act on the list rather than narrow it. */
  actions?: ReactNode;

  /** "12 of 240" — shown once a filter is doing something. */
  count?: { shown: number; total: number };
};

/**
 * The band between a page's header and its content: search, filters, view
 * switch, list actions.
 *
 * Every list page was building this by hand, which is why some had search and
 * some did not, some put the filters above the table and some beside it, and
 * no two agreed on order. One component, one order, everywhere:
 *
 *   [ search ] [ filters ] … [ count ] [ view ] [ actions ]
 *
 * Active filters render as removable chips underneath. A filter you cannot see
 * is a filter you will forget you set, and then the empty list looks like a
 * bug rather than a query.
 */
export default function PageToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  searchLabel,
  filters,
  activeFilters,
  onClearAll,
  view,
  onViewChange,
  actions,
  count,
}: Props) {
  const hasSearch = search !== undefined && onSearchChange !== undefined;
  const showCount = count && count.shown !== count.total;

  return (
    <Box sx={{ mb: 2 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        useFlexGap
        sx={{ alignItems: { md: "center" }, flexWrap: "wrap" }}
      >
        {hasSearch && (
          <SearchField
            value={search}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            label={searchLabel ?? searchPlaceholder}
          />
        )}

        {filters && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            {filters}
          </Stack>
        )}

        <Box sx={{ flex: 1, display: { xs: "none", md: "block" } }} />

        {showCount && (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            <Box component="span" className="hrms-num" sx={{ fontWeight: 700, color: "text.primary" }}>
              {count.shown}
            </Box>{" "}
            of <span className="hrms-num">{count.total}</span>
          </Typography>
        )}

        {view && onViewChange && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v: ViewMode | null) => v && onViewChange(v)}
            aria-label="View mode"
          >
            <ToggleButton value="list" aria-label="List view">
              <TableRowsIcon sx={{ fontSize: 18 }} />
            </ToggleButton>
            <ToggleButton value="grid" aria-label="Grid view">
              <GridViewIcon sx={{ fontSize: 18 }} />
            </ToggleButton>
          </ToggleButtonGroup>
        )}

        {actions && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            {actions}
          </Stack>
        )}
      </Stack>

      {activeFilters && activeFilters.length > 0 && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.5, flexWrap: "wrap", alignItems: "center" }}>
          {activeFilters.map((f) => (
            <Chip key={f.label} label={f.label} size="small" onDelete={f.onClear} variant="outlined" />
          ))}
          {onClearAll && activeFilters.length > 1 && (
            <Chip label="Clear all" size="small" onClick={onClearAll} variant="outlined" color="primary" />
          )}
        </Stack>
      )}
    </Box>
  );
}
