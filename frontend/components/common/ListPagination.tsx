"use client";

import MenuItem from "@mui/material/MenuItem";
import Pagination from "@mui/material/Pagination";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

export const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Page controls for lists that are not a DataGrid.
 *
 * DataGrid brings its own footer, so tables were the only lists in the product
 * that could be paged at all. Everything rendered as cards, as a kanban board,
 * or as a hand-rolled `<Table>` — the roster's card view, expenses, timesheets,
 * training, reviews, surveys, remote work — showed whatever the first response
 * happened to contain and gave no way to reach the rest. On the system with
 * two hundred people that is not a missing convenience; it is records the user
 * cannot get to.
 *
 * Rendering nothing on a single page is deliberate: controls that can only ever
 * say "1 of 1" are furniture, and every list in the app would carry them.
 *
 * `page` is 1-indexed to match DRF, so a page number here is the page number in
 * the request. DataGrid is the one that counts from zero, and converting at its
 * edge is better than every caller remembering which convention it is holding.
 */
export default function ListPagination({
  page,
  pageSize,
  count,
  onPageChange,
  onPageSizeChange,
  noun = "records",
}: {
  page: number;
  pageSize: number;
  /** Total across all pages — the server's count, never `rows.length`. */
  count: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** Plural, for the summary line: "201 employees". */
  noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (count === 0) return null;

  // One page that fits inside the smallest page size has nothing to control:
  // no page to go to, and no point offering "per page" when every record is
  // already on it. Returning null keeps the bar off the two thirds of lists
  // that are short, which is what made it look like stray furniture under
  // every card grid.
  if (pages === 1 && count <= PAGE_SIZES[0]) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, count);

  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{
        // A surface, not floating text. Underneath a card grid the bare row
        // read as a caption that had come loose; on a table it collided with
        // the last border. Same radius and divider as the controls card at the
        // top, so a list is bracketed by two bands that match.
        mt: 2,
        px: 2,
        py: 1.25,
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        alignItems: { xs: "stretch", sm: "center" },
        justifyContent: "space-between",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {/* The range, not just the page number. "26–50 of 201" answers where
            you are; "page 2" only answers it if you remember the page size. */}
        {first.toLocaleString()}–{last.toLocaleString()} of {count.toLocaleString()} {noun}
      </Typography>

      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "center", justifyContent: { xs: "space-between", sm: "flex-end" } }}
      >
        {onPageSizeChange ? (
          <TextField
            select
            size="small"
            label="Per page"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            sx={{ minWidth: 104 }}
          >
            {PAGE_SIZES.map((size) => (
              <MenuItem key={size} value={size}>
                {size}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {/* No placeholder when there is only one page. The empty `<Box />`
            that used to sit here reserved the width of a pager that was not
            there, which is what left the gap beside "Per page". */}
        {pages > 1 ? (
          <Pagination
            page={Math.min(page, pages)}
            count={pages}
            onChange={(_, next) => onPageChange(next)}
            shape="rounded"
            color="primary"
            siblingCount={1}
          />
        ) : null}
      </Stack>
    </Stack>
  );
}
