"use client";

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import {
  BS_WEEKDAYS_NE,
  DEVANAGARI_FONT,
  bsMonthLabel,
  toDevanagari,
} from "@/lib/format/devanagari";

import { EVENT_HUE } from "@/lib/theme/tokens";
import type { CalendarMonth } from "@/hooks/useCompanyCalendar";

/**
 * A month of the company's own calendar, as a grid.
 *
 * **Why this is not a locale setting on the existing calendar.**
 * `react-big-calendar` is built on a Gregorian month: twelve months of known
 * lengths, weeks that start on a fixed weekday, a grid derived from
 * `new Date()`. Bikram Sambat months are 29–32 days and the length of a given
 * month varies *by year* — it comes from a published table, not a formula. You
 * cannot express that as a date-fns locale; it is a different grid.
 *
 * So the company calendar gets its own grid, and the Gregorian one is kept
 * beside it under a toggle. A company on Bikram Sambat still books meetings
 * with people who use Gregorian dates, so neither view can be the only one.
 *
 * **The month shape comes from the server.** The browser has no conversion
 * table and must not grow one — a converter disagreeing with the server by a
 * day puts a payroll period boundary in the wrong place, and nothing
 * downstream can detect it. Every day carries its Gregorian date, which is
 * what events are matched on.
 *
 * Holidays and the working week arrive as props, from the same tables the rest
 * of the product reads: `Holiday` (settings → holidays) and
 * `CompanyProfile.working_days` (settings → company). They are what distinguish
 * one day from another here — without them Vijaya Dashami renders as an
 * ordinary Tuesday and the day nobody works looks like the days everybody does.
 */

export type DayEvent = {
  id: number;
  title: string;
  /** `YYYY-MM-DD` — the Gregorian day this belongs to. */
  date: string;
  color: string;
};

/**
 * Columns run Sunday-first, the way a Nepali calendar is printed.
 *
 * **The server does not index days that way, and getting this wrong shifted
 * the whole month.** `calendar_api` sends Python's `date.weekday()`, where
 * Monday is 0 — `core/calendars.py` says so in as many words. Reading that as
 * Sunday-0 put Bhadra 1 (a Monday) in the Sunday column and every day after it
 * one place early, so Bhadra 3 showed as Tuesday when it is a Wednesday.
 *
 * The conversion lives here, once, rather than at each use.
 */
/** Rendered in Devanagari; the Latin names stay as the React keys, which are
 *  never shown and must not change when the script does. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Python's Monday-0 into this grid's Sunday-0. */
function toSundayFirst(pythonWeekday: number) {
  return (pythonWeekday + 1) % 7;
}

/** Python's Monday-0 into the ISO Monday-1 that `working_days` is stored in. */
function toIsoWeekday(pythonWeekday: number) {
  return pythonWeekday + 1;
}

/** Which ISO weekday each grid column is, so the header can mark the day off. */
const COLUMN_ISO = [7, 1, 2, 3, 4, 5, 6];

export default function BikramMonthGrid({
  month,
  offset,
  onOffsetChange,
  events,
  holidays,
  workingDays,
  onSelectDay,
}: {
  /**
   * The month to draw, resolved by the page.
   *
   * Resolved by the page, not here. `useResolvedMonth` owns it so the agenda
   * beside this grid can summarise the same month — resolved inside the grid,
   * it would be the only component that knew what was on screen.
   */
  month: CalendarMonth | undefined;
  offset: number;
  onOffsetChange: (next: number) => void;
  events: DayEvent[];
  /** Gregorian `YYYY-MM-DD` → holiday name. */
  holidays: Map<string, string>;
  /**
   * ISO weekday numbers the company works (Mon 1 … Sun 7). Empty means the
   * company has not said, and every day is drawn as a working day — the same
   * reading `leave.services.working_day_set` takes, and for the same reason:
   * an empty set would mean nobody ever works.
   */
  workingDays: number[];
  onSelectDay?: (gregorianDate: string) => void;
}) {
  if (!month) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const byDate = new Map<string, DayEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.date) ?? [];
    list.push(event);
    byDate.set(event.date, list);
  }

  const worksOn = (pythonWeekday: number) =>
    workingDays.length === 0 || workingDays.includes(toIsoWeekday(pythonWeekday));

  // The first day's weekday decides how much blank space the grid opens with.
  const lead = month.days.length > 0 ? toSundayFirst(month.days[0].weekday) : 0;
  // …and how much it needs at the end to finish on a whole week. Without this
  // the last row simply stopped after the 31st, leaving a ragged edge and a
  // border that ran out halfway across the card.
  const trail = (7 - ((lead + month.days.length) % 7)) % 7;

  // The Gregorian span, said once at the top. A Bikram Sambat month has no
  // Gregorian name and "Bhadra 2083" tells a visiting reader nothing about
  // when it is; the per-day `30/08` labels answer that one day at a time.
  const span =
    month.days.length > 0
      ? `${gregorianLabel(month.days[0].gregorian)} – ${gregorianLabel(
          month.days[month.days.length - 1].gregorian
        )}`
      : "";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1.5 }}
      >
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <IconButton size="small" onClick={() => onOffsetChange(offset - 1)} aria-label="Previous month">
            <ChevronLeftIcon />
          </IconButton>
          <IconButton size="small" onClick={() => onOffsetChange(offset + 1)} aria-label="Next month">
            <ChevronRightIcon />
          </IconButton>
          {offset !== 0 ? (
            <Button size="small" onClick={() => onOffsetChange(0)}>
              Today
            </Button>
          ) : null}
        </Stack>

        {/* Nepali first, romanised underneath.
            This is the Bikram Sambat grid — the whole reason it exists is that
            the company works in this calendar — and it was rendering "Bhadra
            2083" in Latin, which is the calendar described rather than the
            calendar shown. The romanisation stays on the second line so nobody
            who does not read Devanagari is stranded. */}
        <Box sx={{ textAlign: "right" }}>
          <Typography
            sx={{
              fontWeight: 800,
              fontSize: "1.15rem",
              lineHeight: 1.2,
              fontFamily: DEVANAGARI_FONT,
            }}
          >
            {bsMonthLabel(month.month, month.year) || `${month.month_name} ${month.year}`}
          </Typography>
          <Typography sx={{ fontSize: "0.72rem", color: "text.secondary", lineHeight: 1.3 }}>
            {month.month_name} {month.year}
          </Typography>
          <Typography sx={{ fontSize: "0.68rem", color: "text.disabled" }}>{span}</Typography>
        </Box>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          // The rows share whatever height the card has left, so the grid
          // finishes flush with the card instead of leaving a band of nothing
          // under it — and a 31-day month is not visibly shorter than a 32.
          gridAutoRows: "minmax(96px, 1fr)",
          flexGrow: 1,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {WEEKDAYS.map((label, column) => {
          const off = workingDays.length > 0 && !workingDays.includes(COLUMN_ISO[column]);
          return (
            <Box
              key={label}
              sx={{
                py: 0.9,
                textAlign: "center",
                fontSize: "0.78rem",
                fontWeight: 600,
                fontFamily: DEVANAGARI_FONT,
                color: off ? "text.disabled" : "text.secondary",
                bgcolor: off ? "action.hover" : undefined,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              {BS_WEEKDAYS_NE[column] ?? label}
              {/* Named, not just tinted. A grey column is a hint; "off" is the
                  answer, and the tint alone is invisible to some readers. */}
              {off ? (
                <Box component="span" sx={{ fontSize: "0.62rem", ml: 0.5, fontWeight: 500 }}>
                  off
                </Box>
              ) : null}
            </Box>
          );
        })}

        {Array.from({ length: lead }).map((_, i) => (
          <Box key={`lead-${i}`} sx={{ bgcolor: "action.hover", opacity: 0.55 }} />
        ))}

        {month.days.map((day) => {
          const dayEvents = byDate.get(day.gregorian) ?? [];
          const isToday = day.gregorian === month.today.gregorian;
          const holiday = holidays.get(day.gregorian);
          const isOff = !worksOn(day.weekday);

          return (
            <Box
              key={day.gregorian}
              onClick={onSelectDay ? () => onSelectDay(day.gregorian) : undefined}
              sx={{
                p: 0.75,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                borderTop: "1px solid",
                borderLeft: "1px solid",
                borderColor: "divider",
                // A holiday reads first, then a non-working day, then an
                // ordinary one. Today is no longer a whole-cell wash — that
                // competed with both of these and won, so a Dashain falling on
                // a Saturday looked like neither.
                bgcolor: holiday
                  ? `color-mix(in srgb, ${EVENT_HUE.holiday} 9%, transparent)`
                  : isOff
                    ? "action.hover"
                    : undefined,
                cursor: onSelectDay ? "pointer" : "default",
                transition: "background-color .15s",
                "&:hover": onSelectDay
                  ? { bgcolor: "action.selected" }
                  : undefined,
              }}
            >
              <Stack direction="row" sx={{ alignItems: "center", gap: 0.6, mb: 0.5 }}>
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    // Today is a filled disc on the number itself — the
                    // convention every calendar app uses, and it survives a
                    // tinted cell underneath it.
                    bgcolor: isToday ? "primary.main" : "transparent",
                    color: isToday ? "primary.contrastText" : isOff ? "text.secondary" : "text.primary",
                    fontWeight: isToday ? 800 : 600,
                    fontSize: "0.9rem",
                    fontFamily: DEVANAGARI_FONT,
                  }}
                >
                  {toDevanagari(day.day)}
                </Box>
                <Typography sx={{ fontSize: "0.66rem", color: "text.disabled" }}>
                  {day.gregorian.slice(8)}/{day.gregorian.slice(5, 7)}
                </Typography>
              </Stack>

              {holiday ? (
                <Tooltip title={holiday}>
                  <Typography
                    sx={{
                      fontSize: "0.66rem",
                      fontWeight: 700,
                      color: EVENT_HUE.holiday,
                      mb: 0.4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {holiday}
                  </Typography>
                </Tooltip>
              ) : null}

              <Stack spacing={0.35} sx={{ minWidth: 0 }}>
                {dayEvents.slice(0, holiday ? 2 : 3).map((event) => (
                  <Tooltip key={event.id} title={event.title}>
                    <Stack
                      direction="row"
                      sx={{
                        alignItems: "center",
                        gap: 0.5,
                        px: 0.55,
                        py: 0.2,
                        borderRadius: "5px",
                        // Tinted, with the hue carried by a bar rather than a
                        // solid fill. White 11px type on a mid-saturation block
                        // is the least legible thing on the page, and four
                        // solid blocks in one cell read as a colour chart.
                        bgcolor: `color-mix(in srgb, ${event.color} 15%, transparent)`,
                        borderLeft: "2.5px solid",
                        borderColor: event.color,
                        minWidth: 0,
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: "0.68rem",
                          fontWeight: 600,
                          color: "text.primary",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {event.title}
                      </Typography>
                    </Stack>
                  </Tooltip>
                ))}
                {dayEvents.length > (holiday ? 2 : 3) ? (
                  <Typography sx={{ fontSize: "0.66rem", color: "text.secondary", pl: 0.6 }}>
                    +{dayEvents.length - (holiday ? 2 : 3)} more
                  </Typography>
                ) : null}
              </Stack>
            </Box>
          );
        })}

        {Array.from({ length: trail }).map((_, i) => (
          <Box
            key={`trail-${i}`}
            sx={{
              bgcolor: "action.hover",
              opacity: 0.55,
              borderTop: "1px solid",
              borderLeft: "1px solid",
              borderColor: "divider",
            }}
          />
        ))}
      </Box>
    </Box>
  );
}

/** `2026-08-17` → `17 Aug`. Deliberately not localised: it is a caption on a
 *  Bikram Sambat heading, and its whole job is to be the Gregorian reading. */
function gregorianLabel(iso: string) {
  const [, month, day] = iso.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(day)} ${names[Number(month) - 1]}`;
}
