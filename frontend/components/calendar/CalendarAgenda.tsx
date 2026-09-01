"use client";

import EventBusyIcon from "@mui/icons-material/EventBusy";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import DateText from "@/components/common/DateText";
import type { CalendarMonth } from "@/hooks/useCompanyCalendar";
import { EVENT_HUE } from "@/lib/theme/tokens";
import type { CompanyEvent, CompanyEventType } from "@/types/calendar";
import type { Holiday } from "@/types/holidays";

/**
 * What is actually coming up, beside the grid.
 *
 * The reading list beside the grid: the next fortnight or so of holidays and
 * events in one column, in date order, so the page is useful before anybody has
 * looked at a single cell. A month grid says where things are rather than what
 * they are, and on a month with nothing booked it says nothing at all.
 *
 * **Holidays and events are merged, not two lists.** They compete for the same
 * attention — "is anything happening on the 19th" does not care which table
 * the answer came out of — and a holiday is the one entry that reliably
 * exists, so splitting them would leave the events list permanently empty on a
 * quiet month while a Dashain sat unread underneath it.
 *
 * Everything is forward-looking from today. A calendar's past is the grid's
 * job; a rail that opens on last month's standup is a rail nobody reads.
 */

const TYPE_LABEL: Record<CompanyEventType, string> = {
  meeting: "Meeting",
  interview: "Interview",
  announcement: "Announcement",
  other: "Event",
};

type Entry = {
  key: string;
  date: string;
  title: string;
  detail: string;
  color: string;
  onClick?: () => void;
};

/** How far ahead the rail looks. Long enough to catch the next festival on a
 *  quiet month, short enough that it is a list and not an archive. */
const HORIZON_DAYS = 60;
const MAX_ENTRIES = 8;

/**
 * What the month on screen is actually made of.
 *
 * **The one number a company calendar is asked for.** "How many working days is
 * Bhadra" decides the payroll divisor on a working-day basis, what a month's
 * leave costs, and whether a deadline is reachable — and the product could
 * compute it from two settings it already had (`working_days` and `Holiday`)
 * and never did. A holiday landing on the weekly off is counted once, not
 * twice, which is the whole reason this is derived rather than added up.
 */
function MonthShape({
  month,
  holidays,
  workingDays,
  events,
}: {
  month: CalendarMonth;
  holidays: Map<string, string>;
  workingDays: number[];
  events: CompanyEvent[];
}) {
  let working = 0;
  let weeklyOff = 0;
  let holidayCount = 0;

  // The categories are exclusive, holiday first because it is the more
  // specific fact about the day. A festival that falls on a weekend counted
  // twice gives three numbers that do not add up to the month, which is three
  // numbers nobody can use.
  for (const day of month.days) {
    const isHoliday = holidays.has(day.gregorian);
    // ISO weekday: the API sends Python's Monday-0, `working_days` is Monday-1.
    const isOff = workingDays.length > 0 && !workingDays.includes(day.weekday + 1);
    if (isHoliday) holidayCount += 1;
    else if (isOff) weeklyOff += 1;
    else working += 1;
  }

  const first = month.days[0]?.gregorian ?? "";
  const last = month.days[month.days.length - 1]?.gregorian ?? "";
  const inMonth = events.filter((event) => {
    const day = event.start_datetime.slice(0, 10);
    return day >= first && day <= last;
  }).length;

  const cells: { label: string; value: number; hue?: string }[] = [
    { label: "Working days", value: working },
    // "Weekly off", not "Days off": a holiday is also a day off, and the two
    // labels have to be as exclusive as the counts are.
    { label: "Weekly off", value: weeklyOff },
    { label: "Holidays", value: holidayCount, hue: EVENT_HUE.holiday },
    { label: "Events", value: inMonth },
  ];

  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
        {month.month_name} {month.year}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.25 }}>
        {/* The count is stated so the three categories can be checked against
            it. A summary you cannot verify is a summary you have to trust. */}
        What its {month.days.length} days are made of
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
        {cells.map((cell) => (
          <Box
            key={cell.label}
            sx={{
              px: 1.25,
              py: 1,
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "action.hover",
            }}
          >
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: "1.25rem",
                lineHeight: 1.1,
                color: cell.hue && cell.value > 0 ? cell.hue : "text.primary",
              }}
            >
              {cell.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {cell.label}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default function CalendarAgenda({
  month,
  monthHolidays,
  workingDays,
  events,
  holidays,
  onSelectEvent,
}: {
  /** The month the grid is showing, so the summary follows the reader. */
  month: CalendarMonth | undefined;
  /** Gregorian `YYYY-MM-DD` → holiday name, the same map the grid draws. */
  monthHolidays: Map<string, string>;
  workingDays: number[];
  events: CompanyEvent[];
  holidays: Holiday[];
  onSelectEvent?: (event: CompanyEvent) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = isoOf(today);
  const horizon = new Date(today.getTime() + HORIZON_DAYS * 86_400_000);
  const horizonIso = isoOf(horizon);

  const entries: Entry[] = [
    ...holidays.map((holiday) => ({
      key: `h-${holiday.id}`,
      date: holiday.date,
      title: holiday.name,
      detail: "Company holiday",
      color: EVENT_HUE.holiday,
    })),
    ...events.map((event) => ({
      key: `e-${event.id}`,
      date: event.start_datetime.slice(0, 10),
      title: event.title,
      detail: event.all_day
        ? `${TYPE_LABEL[event.event_type]}${event.location ? ` · ${event.location}` : ""}`
        : `${TYPE_LABEL[event.event_type]} · ${timeOf(event.start_datetime)}${
            event.location ? ` · ${event.location}` : ""
          }`,
      color: EVENT_HUE[event.event_type] ?? EVENT_HUE.other,
      onClick: onSelectEvent ? () => onSelectEvent(event) : undefined,
    })),
  ]
    .filter((entry) => entry.date >= todayIso && entry.date <= horizonIso)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_ENTRIES);

  return (
    <Stack sx={{ height: "100%", minWidth: 0 }}>
      {month ? (
        <MonthShape
          month={month}
          holidays={monthHolidays}
          workingDays={workingDays}
          events={events}
        />
      ) : null}

      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.25 }}>
        Coming up
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5 }}>
        Holidays and company events, next {HORIZON_DAYS} days
      </Typography>

      {entries.length === 0 ? (
        <Stack
          sx={{
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            color: "text.disabled",
            px: 2,
          }}
        >
          <EventBusyIcon sx={{ fontSize: 34, mb: 1 }} />
          <Typography variant="body2" sx={{ fontWeight: 600, color: "text.secondary" }}>
            Nothing scheduled
          </Typography>
          <Typography variant="caption" sx={{ mt: 0.5 }}>
            Click any day in the grid to add an event, or add the year&apos;s holidays in
            Settings → Holidays.
          </Typography>
        </Stack>
      ) : (
        <Stack divider={<Divider flexItem />} sx={{ minWidth: 0 }}>
          {entries.map((entry) => {
            const away = daysAway(todayIso, entry.date);
            return (
              <Stack
                key={entry.key}
                direction="row"
                spacing={1.25}
                onClick={entry.onClick}
                sx={{
                  py: 1.1,
                  alignItems: "flex-start",
                  minWidth: 0,
                  cursor: entry.onClick ? "pointer" : "default",
                  "&:hover": entry.onClick ? { bgcolor: "action.hover" } : undefined,
                  borderRadius: 1,
                }}
              >
                <Box
                  sx={{
                    width: 4,
                    alignSelf: "stretch",
                    borderRadius: 4,
                    bgcolor: entry.color,
                    flexShrink: 0,
                  }}
                />
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography
                    sx={{
                      fontSize: "0.83rem",
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    <DateText value={entry.date} format="short" /> · {entry.detail}
                  </Typography>
                </Box>
                {/* "In 3 days" is the thing people are actually reading for,
                    and it is the one number a date does not give you. */}
                <Typography
                  variant="caption"
                  sx={{
                    flexShrink: 0,
                    fontWeight: 700,
                    color: away === 0 ? "primary.main" : "text.disabled",
                    whiteSpace: "nowrap",
                  }}
                >
                  {away === 0 ? "Today" : away === 1 ? "Tomorrow" : `${away}d`}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

/** Local-midnight ISO date. `toISOString()` would shift a Kathmandu evening
 *  back to the previous day, which is how "today" ends up off by one. */
function isoOf(value: Date) {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function daysAway(fromIso: string, toIso: string) {
  const from = Date.parse(`${fromIso}T00:00:00`);
  const to = Date.parse(`${toIso}T00:00:00`);
  return Math.round((to - from) / 86_400_000);
}

function timeOf(isoTimestamp: string) {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
