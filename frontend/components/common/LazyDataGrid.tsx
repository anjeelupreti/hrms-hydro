"use client";

import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import type { DataGridProps, GridValidRowModel } from "@mui/x-data-grid";
import dynamic from "next/dynamic";

/**
 * `DataGrid`, kept out of every page that does not draw one.
 *
 * **The measurement that produced this file.** Reading the scripts each
 * prerendered route actually loads, `@mui/x-data-grid` — 474K, the largest
 * single dependency in the app — was in the *first load of every route in the
 * product*. Not the twelve that show a grid: all of them. The login page, the
 * calendar, the dashboard, the memoranda desk. None of those render a grid and
 * every one of them paid for it.
 *
 * Nothing was wrong with any individual import. Twelve client modules reached
 * `@mui/x-data-grid` synchronously, and a module that many entry points share
 * is exactly what the bundler's shared-chunk heuristic promotes into the common
 * bundle — correctly, by its own rules. The heuristic optimises for *not
 * downloading it twice*; it has no way to know that most routes should not be
 * downloading it once.
 *
 * An async boundary is what tells it. With every path to the grid going through
 * this module, it becomes an on-demand chunk instead of a shared one: the pages
 * that draw grids fetch it when they mount, and the pages that do not never see
 * it.
 *
 * **Why a re-export rather than pushing everyone through `DataTable`.** Eleven
 * pages use `DataGrid` directly and only one goes through the wrapper. Moving
 * eleven working tables onto a different component to win back some kilobytes
 * is a refactor with real risk and no user-visible upside; changing an import
 * path is neither.
 *
 * `ssr: false` because the grid measures its own container to decide how many
 * rows fit — the server has no viewport, so its output is discarded and rebuilt
 * on hydration.
 */
const Grid = dynamic(() => import("@mui/x-data-grid").then((mod) => mod.DataGrid), {
  ssr: false,
  loading: () => (
    // Header bar plus rows, at the grid's own default row height, so the page
    // does not jump when the real one arrives.
    <Stack spacing={0.5} sx={{ p: 1 }}>
      <Skeleton variant="rounded" height={56} />
      {Array.from({ length: 6 }).map((_, row) => (
        <Skeleton key={row} variant="rounded" height={52} />
      ))}
    </Stack>
  ),
});

/**
 * `dynamic` cannot carry the row-type parameter across the import boundary, so
 * the signature is restored here and call sites keep inferring `R` from their
 * own `rows` exactly as they did. The cast is confined to this line.
 */
export default Grid as <R extends GridValidRowModel>(
  props: DataGridProps<R>
) => React.JSX.Element;
