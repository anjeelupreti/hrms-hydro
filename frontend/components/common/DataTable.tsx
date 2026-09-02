"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import type {
  DataGridProps,
  GridColDef,
  GridColumnVisibilityModel,
  GridValidRowModel,
} from "@mui/x-data-grid";

import DataGrid from "@/components/common/LazyDataGrid";
import { useMemo, type ReactNode } from "react";

import EmptyState from "@/components/common/EmptyState";
import { useStoredPreference } from "@/hooks/useStoredPreference";

type Props<R extends GridValidRowModel> = Omit<
  DataGridProps<R>,
  "rows" | "columns" | "slots" | "slotProps" | "autoHeight"
> & {
  rows: R[];
  columns: GridColDef<R>[];

  /**
   * Stable id for this table. Column visibility is remembered against it, so
   * hiding a column on the employee list does not hide one on payroll.
   */
  tableId: string;

  /** Row click navigates. Adds the pointer cursor to rows only — not headers. */
  onRowNavigate?: (row: R) => void;

  /** What to show when there is genuinely nothing yet. */
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  /** What to show when a filter matched nothing. Falls back to `empty`. */
  noResults?: { title: string; description?: ReactNode; action?: ReactNode };
  /** True when a search or filter is narrowing the list. Picks which of the two. */
  filtered?: boolean;
  /** Set on a failed fetch. Takes precedence over both. */
  error?: { message: string; onRetry?: () => void } | null;
};

/**
 * One DataGrid wrapper, so table behaviour is decided once.
 *
 * Before this, every page configured its own grid: some had `autoHeight`, some
 * did not; one set `cursor: pointer` on the *root* so the header and the empty
 * overlay claimed to be clickable; the "no rows" message was DataGrid's stock
 * text, which reads identically whether the list is empty, filtered to nothing,
 * or failed to load.
 *
 * Everything here follows the density preference, because a table that ignores
 * it is the one place the setting most obviously should have worked.
 */
/**
 * Column visibility lives in `useStoredPreference`, which is this pattern
 * factored out — three screens were each hand-rolling a localStorage read, and
 * this one was the only one doing it correctly.
 */
const EMPTY_VISIBILITY: GridColumnVisibilityModel = {};

/** A stored model is only usable if it parses to an object of booleans. */
function parseVisibility(raw: string): GridColumnVisibilityModel | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export default function DataTable<R extends GridValidRowModel>({
  rows,
  columns,
  tableId,
  onRowNavigate,
  empty,
  noResults,
  filtered = false,
  error = null,
  loading,
  ...rest
}: Props<R>) {
  const [columnVisibility, handleVisibilityChange] = useStoredPreference<GridColumnVisibilityModel>(
    `hrms-table-cols:${tableId}`,
    EMPTY_VISIBILITY,
    parseVisibility,
    JSON.stringify
  );

  const overlay = useMemo(() => {
    if (error) {
      return (
        <EmptyState
          variant="error"
          title="Couldn't load this"
          description={error.message}
          action={
            error.onRetry ? (
              <Button variant="outlined" onClick={error.onRetry}>
                Try again
              </Button>
            ) : undefined
          }
        />
      );
    }
    if (filtered && noResults) {
      return <EmptyState variant="noResults" title={noResults.title} description={noResults.description} action={noResults.action} />;
    }
    if (empty) {
      return <EmptyState variant={filtered ? "noResults" : "empty"} title={empty.title} description={empty.description} action={empty.action} />;
    }
    return <EmptyState variant="empty" title="Nothing here yet" />;
  }, [error, filtered, noResults, empty]);

  return (
    <DataGrid<R>
      rows={error ? [] : rows}
      columns={columns}
      loading={loading}
      autoHeight
      disableRowSelectionOnClick
      columnVisibilityModel={columnVisibility}
      onColumnVisibilityModelChange={handleVisibilityChange}
      onRowClick={onRowNavigate ? (params) => onRowNavigate(params.row) : undefined}
      slots={{ noRowsOverlay: () => <Box sx={{ height: "100%", display: "grid", placeItems: "center" }}>{overlay}</Box> }}
      sx={{
        // The overlay needs room to breathe; DataGrid's default collapses it.
        "--DataGrid-overlayHeight": "320px",
        // Cursor on rows only, never the root — on the root it also covers
        // the column headers and the empty state, which are not clickable.
        ...(onRowNavigate ? { "& .MuiDataGrid-row": { cursor: "pointer" } } : {}),
        "& .MuiDataGrid-columnHeader:focus, & .MuiDataGrid-cell:focus": { outlineOffset: -2 },
      }}
      {...rest}
    />
  );
}
