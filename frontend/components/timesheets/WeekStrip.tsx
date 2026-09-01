"use client";

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { TimesheetWeek } from "@/hooks/useTimesheets";

/**
 * The week, as seven days rather than as a list of entries.
 *
 * **This exists to show absence.** Everything else on a timesheet page is a
 * record of work somebody remembered to log; the failure mode of a timesheet is
 * the day they didn't, and a list of rows cannot render a row that isn't there.
 * Seven fixed columns can: the gap is a column with nothing in it, in the same
 * place it would have been.
 *
 * **A blank is not automatically a gap.** Three different blanks are drawn
 * three different ways, because conflating them makes the warning worthless:
 *
 * - a non-working day (Saturday here, or a festival) is dimmed and silent — the
 *   company does not work it, so nothing is owed;
 * - a working day still in the future is plain and silent — nobody is late for
 *   Thursday on Tuesday;
 * - a working day already past with nothing on it is the only one marked, and
 *   it is marked in the attention colour because it is the one thing on this
 *   page a person needs to act on.
 *
 * Which days fall in which bucket is decided on the server, from the company's
 * configured week and its holidays. Nepal works Sunday to Friday, and a
 * hardcoded Monday-to-Friday would flag every Saturday until people stopped
 * reading the warning at all.
 *
 * The bar height is hours against a nominal eight, capped: it is a shape to
 * scan across, not a value to read off, and a fourteen-hour day should look
 * long rather than rescale the other six.
 */

const NOMINAL_DAY = 8;

export default function WeekStrip({
  week,
  onPickDay,
  onShiftWeek,
  onThisWeek,
  selectedDate,
}: {
  week: TimesheetWeek;
  /** Clicking a day pre-fills the log form with that date. */
  onPickDay: (date: string) => void;
  onShiftWeek: (deltaDays: number) => void;
  onThisWeek: () => void;
  selectedDate?: string;
}) {
  // Local, not UTC — see `localISO` in the timesheets page. `toISOString()`
  // here would mark the wrong column as today for every user east of
  // Greenwich, which includes every user this product has.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const isThisWeek = week.start <= today && today <= week.end;

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "background.paper",
        mb: 3,
        overflow: "hidden",
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" }, px: 2.5, py: 2 }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            component="div"
            sx={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}
          >
            {week.total_hours}h logged
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {week.missing_days > 0 ? (
              <Box component="span" sx={{ color: "error.main", fontWeight: 600 }}>
                {week.missing_days} working day{week.missing_days === 1 ? "" : "s"} with nothing on{" "}
                {week.missing_days === 1 ? "it" : "them"}
              </Box>
            ) : (
              `across ${week.working_days} working day${week.working_days === 1 ? "" : "s"} — nothing missing`
            )}
            {Number(week.billable_hours) !== Number(week.total_hours)
              ? ` · ${week.billable_hours}h billable`
              : null}
          </Typography>
        </Box>

        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexShrink: 0 }}>
          <IconButton size="small" aria-label="Previous week" onClick={() => onShiftWeek(-7)}>
            <ChevronLeftIcon />
          </IconButton>
          <Button
            size="small"
            onClick={onThisWeek}
            disabled={isThisWeek}
            sx={{ minWidth: 96, fontVariantNumeric: "tabular-nums" }}
          >
            {isThisWeek ? "This week" : new Date(week.start).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </Button>
          <IconButton size="small" aria-label="Next week" onClick={() => onShiftWeek(7)}>
            <ChevronRightIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderTop: "1px solid",
          borderColor: "divider",
        }}
      >
        {week.days.map((day) => {
          const hours = Number(day.hours);
          const fill = Math.min(hours / NOMINAL_DAY, 1);
          const isToday = day.date === today;
          const isSelected = day.date === selectedDate;
          const date = new Date(day.date);

          return (
            <Tooltip
              key={day.date}
              arrow
              title={
                !day.working_day
                  ? "Not a working day"
                  : day.missing
                    ? "Nothing logged — click to add it"
                    : `${day.hours}h across ${day.entries} ${day.entries === 1 ? "entry" : "entries"}`
              }
            >
              <Box
                role="button"
                tabIndex={0}
                aria-label={`${date.toDateString()}, ${day.hours} hours`}
                onClick={() => onPickDay(day.date)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPickDay(day.date);
                  }
                }}
                sx={{
                  px: 1,
                  pt: 1.5,
                  pb: 1.25,
                  cursor: "pointer",
                  borderLeft: "1px solid",
                  borderColor: "divider",
                  "&:first-of-type": { borderLeft: "none" },
                  // Non-working days recede rather than disappear: the week has
                  // to keep its shape or the columns stop lining up with the
                  // days people have in their heads.
                  bgcolor: isSelected
                    ? "action.selected"
                    : day.working_day
                      ? "transparent"
                      : "action.hover",
                  transition: "background-color 120ms",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    textAlign: "center",
                    fontWeight: isToday ? 700 : 500,
                    color: day.working_day ? "text.secondary" : "text.disabled",
                  }}
                >
                  {date.toLocaleDateString(undefined, { weekday: "short" })}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    textAlign: "center",
                    color: isToday ? "primary.main" : "text.disabled",
                    fontWeight: isToday ? 700 : 400,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {date.getDate()}
                </Typography>

                {/* The bar sits in a fixed-height well so every column has the
                    same baseline — otherwise a short day reads as a missing one. */}
                <Box
                  sx={{
                    height: 56,
                    mt: 1,
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                  }}
                >
                  {hours > 0 ? (
                    <Box
                      sx={{
                        width: "62%",
                        height: `${Math.max(fill * 100, 8)}%`,
                        borderRadius: 1,
                        backgroundColor: `color-mix(in srgb, var(--mui-palette-primary-main) ${
                          30 + Math.round(fill * 70)
                        }%, var(--mui-palette-background-paper))`,
                      }}
                    />
                  ) : day.missing ? (
                    <Box
                      sx={{
                        width: "62%",
                        height: "100%",
                        borderRadius: 1,
                        border: "1px dashed",
                        borderColor: "error.main",
                        display: "grid",
                        placeItems: "center",
                        color: "error.main",
                      }}
                    >
                      <WarningAmberIcon fontSize="small" />
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        width: "62%",
                        height: "100%",
                        borderRadius: 1,
                        border: "1px dashed",
                        borderColor: "divider",
                      }}
                    />
                  )}
                </Box>

                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    textAlign: "center",
                    mt: 0.75,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: day.missing ? "error.main" : hours > 0 ? "text.primary" : "text.disabled",
                  }}
                >
                  {hours > 0 ? `${day.hours}h` : "—"}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}
