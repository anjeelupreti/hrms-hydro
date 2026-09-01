"use client";

import AddIcon from "@mui/icons-material/Add";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { enUS } from "date-fns/locale/en-US";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Calendar, dateFnsLocalizer, type View } from "react-big-calendar";
import withDragAndDrop, { type EventInteractionArgs } from "react-big-calendar/lib/addons/dragAndDrop";

import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

import { EVENT_HUE } from "@/lib/theme/tokens";
import BikramMonthGrid from "@/components/calendar/BikramMonthGrid";
import CalendarAgenda from "@/components/calendar/CalendarAgenda";
import CompanyEventDialog from "@/components/calendar/CompanyEventDialog";
import PageHeader from "@/components/shell/PageHeader";
import { useCompanyEvents, useUpdateCompanyEvent } from "@/hooks/useCalendar";
import { useHolidays } from "@/hooks/useHolidays";
import { useCan } from "@/hooks/useMe";
import { useCompanyProfile } from "@/hooks/useOrganization";
import { useCalendarKey, useResolvedMonth } from "@/hooks/useCompanyCalendar";
import type { CompanyEvent, CompanyEventType } from "@/types/calendar";

/**
 * The company calendar.
 *
 * Holidays and the working week are what make one day different from another
 * here — `Holiday` (settings → holidays) and `CompanyProfile.working_days`
 * (settings → company) — so both are fetched here and handed to whichever grid
 * is showing.
 *
 * The type chips are filters. A row of coloured pills above a grid is a control
 * by every convention there is, so a legend in that position is a control that
 * does nothing when pressed.
 */

// Tag colour per event type — turns the plain blue blocks into a legible,
// colour-coded board.
const EVENT_META: Record<CompanyEventType, { label: string; color: string }> = {
  meeting: { label: "Meeting", color: EVENT_HUE.meeting },
  interview: { label: "Interview", color: EVENT_HUE.interview },
  announcement: { label: "Announcement", color: EVENT_HUE.announcement },
  other: { label: "Other", color: EVENT_HUE.other },
};

/** Holidays are filterable alongside the event types — they are drawn on the
 *  same grid and compete for the same glance, so hiding one and not the other
 *  would be an arbitrary distinction. */
type FilterKey = CompanyEventType | "holiday";

const ALL_FILTERS: FilterKey[] = ["meeting", "interview", "announcement", "other", "holiday"];

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: enUS }),
  getDay,
  locales,
});

const DnDCalendar = withDragAndDrop<RbcEvent>(Calendar);

/**
 * Whether the browser has taken over from the prerender.
 *
 * `react-big-calendar` marks "today" from its own `new Date()`, and nothing
 * here can pass the grid a timezone. The container (UTC) and the browser
 * (Kathmandu, UTC+05:45) name different days for the first 5h45m of every local
 * day, so prerendering the grid puts `rbc-now` on a different cell on each side
 * and React reports the tree as unpatchable.
 *
 * Only the Gregorian grid needs this. `BikramMonthGrid` gets "today" from the
 * server in the response body, which is one answer both sides render the same.
 *
 * **`useSyncExternalStore`, not `setState` in an effect** — that is the React
 * idiom for "did the server render this", and the lint rule that rejects the
 * effect version is right to. Both snapshots return a *constant*, so there is
 * nothing to cache and nothing to compare: the fault that took the system
 * down earlier in this project was a `getSnapshot` returning `Date.now()`,
 * which is a new value every call and therefore an infinite render loop.
 */
const NEVER_CHANGES = () => () => {};
const ON_CLIENT = () => true;
const ON_SERVER = () => false;

function useMounted() {
  return useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER);
}

type RbcEvent = {
  id: number;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CompanyEvent;
};

export default function CompanyCalendarPage() {
  const canManage = useCan("settings.manage");
  const mounted = useMounted();

  const [range, setRange] = useState(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
      end: new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString(),
    };
  });
  const { data: events } = useCompanyEvents(range.start, range.end);
  const updateEvent = useUpdateCompanyEvent();
  const { data: holidayPage } = useHolidays();
  const { data: profile } = useCompanyProfile();

  const calendarKey = useCalendarKey();
  // Defaults to the company's own calendar where there is one — a Bikram
  // Sambat workspace opening on a Gregorian grid is the complaint this fixes.
  const [showLocal, setShowLocal] = useState(true);
  const [hidden, setHidden] = useState<FilterKey[]>([]);
  // Which month the grid is on. Held here rather than inside the grid so the
  // agenda can summarise the month the reader is actually looking at.
  const [monthOffset, setMonthOffset] = useState(0);
  const { data: shownMonth } = useResolvedMonth(monthOffset);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogRange, setDialogRange] = useState<{ start: Date; end: Date } | null>(null);
  const [editingEvent, setEditingEvent] = useState<CompanyEvent | null>(null);

  const isShown = (key: FilterKey) => !hidden.includes(key);
  function toggle(key: FilterKey) {
    setHidden((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    );
  }

  const allEvents = useMemo(
    () =>
      (events?.results ?? []).map((event) => ({
        id: event.id,
        title: event.title,
        start: new Date(event.start_datetime),
        end: new Date(event.end_datetime),
        allDay: event.all_day,
        resource: event,
      })),
    [events]
  );

  const calendarEvents: RbcEvent[] = useMemo(
    () => allEvents.filter((e) => isShown(e.resource.event_type)),
    // `hidden` is what actually changes the result; `isShown` closes over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allEvents, hidden]
  );

  /** Gregorian `YYYY-MM-DD` → holiday name, for whichever grid is showing. */
  const holidayMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!isShown("holiday")) return map;
    for (const holiday of holidayPage?.results ?? []) map.set(holiday.date, holiday.name);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidayPage, hidden]);

  const workingDays = profile?.working_days ?? [];

  function handleSelectSlot({ start, end }: { start: Date; end: Date }) {
    if (!canManage) return;
    setEditingEvent(null);
    setDialogRange({ start, end });
    setDialogOpen(true);
  }

  function handleSelectEvent(rbcEvent: RbcEvent) {
    if (!canManage) return;
    setEditingEvent(rbcEvent.resource);
    setDialogRange(null);
    setDialogOpen(true);
  }

  function openEvent(event: CompanyEvent) {
    if (!canManage) return;
    setEditingEvent(event);
    setDialogRange(null);
    setDialogOpen(true);
  }

  function handleEventDrop({ event, start, end }: EventInteractionArgs<RbcEvent>) {
    if (!canManage) return;
    updateEvent.mutate({
      id: event.id,
      values: { start_datetime: new Date(start).toISOString(), end_datetime: new Date(end).toISOString() },
    });
  }

  function handleRangeChange(newRange: Date[] | { start: Date; end: Date }, view?: View) {
    if (Array.isArray(newRange)) {
      const start = newRange[0];
      const end = newRange[newRange.length - 1];
      setRange({ start: start.toISOString(), end: end.toISOString() });
    } else {
      setRange({ start: newRange.start.toISOString(), end: newRange.end.toISOString() });
    }
    void view;
  }

  function openCreate() {
    const start = new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setEditingEvent(null);
    setDialogRange({ start, end });
    setDialogOpen(true);
  }

  // Events, flattened to the Gregorian day they fall on. The Bikram Sambat
  // grid matches on that: storage stays Gregorian everywhere, and only the
  // *labelling* changes with the company's calendar.
  const localEvents = useMemo(
    () =>
      calendarEvents.map((e) => ({
        id: e.id,
        title: e.title,
        // Local midnight, not `toISOString()` — that shifts a Kathmandu
        // evening back a day, which puts a 6pm meeting on the wrong cell.
        date: `${e.start.getFullYear()}-${`${e.start.getMonth() + 1}`.padStart(2, "0")}-${`${e.start.getDate()}`.padStart(2, "0")}`,
        color: EVENT_META[e.resource.event_type]?.color ?? EVENT_META.other.color,
      })),
    [calendarEvents]
  );

  const eventPropGetter = (event: RbcEvent) => {
    const color = EVENT_META[event.resource.event_type]?.color ?? EVENT_META.other.color;
    return { style: { backgroundColor: color, borderColor: color } };
  };

  /** The Gregorian grid gets the same two facts the BS grid does. */
  const dayPropGetter = (date: Date) => {
    const iso = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
    if (holidayMap.has(iso)) {
      return {
        style: { backgroundColor: `color-mix(in srgb, ${EVENT_HUE.holiday} 9%, transparent)` },
      };
    }
    // `getDay()` is Sunday-0; `working_days` is stored ISO, Monday-1.
    const isoWeekday = date.getDay() === 0 ? 7 : date.getDay();
    if (workingDays.length > 0 && !workingDays.includes(isoWeekday)) {
      return { style: { backgroundColor: "var(--mui-palette-action-hover)" } };
    }
    return {};
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 4 } }}>
      <PageHeader
        title="Company Calendar"
        subtitle={
          canManage
            ? "Click a day to create an event, drag to reschedule, or click an event to edit."
            : "Company-wide meetings, interviews, and announcements."
        }
        icon={<CalendarMonthIcon />}
        actions={
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            {/* Shown only where the two differ. On a Gregorian workspace a
                toggle between Gregorian and Gregorian is a control that does
                nothing, which is worse than no control. */}
            {calendarKey === "BS" ? (
              <ToggleButtonGroup
                size="small"
                exclusive
                value={showLocal ? "bs" : "ad"}
                onChange={(_, next) => next && setShowLocal(next === "bs")}
                aria-label="Calendar system"
              >
                {/* "BS" and "AD", not "Bikram Sambat" and "Gregorian".
                    These are the abbreviations Nepali users actually read and
                    write — on a payslip, a filing, a date stamp — and the two
                    long names in a toggle set the control's width by its
                    labels rather than its job. The `aria-label` and the
                    tooltips keep the full names available to anyone who wants
                    them. */}
                <ToggleButton value="bs" title="Bikram Sambat">
                  BS
                </ToggleButton>
                <ToggleButton value="ad" title="Gregorian (AD)">
                  AD
                </ToggleButton>
              </ToggleButtonGroup>
            ) : null}
            {canManage ? (
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                New Event
              </Button>
            ) : null}
          </Stack>
        }
      />

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
        {ALL_FILTERS.map((key) => {
          const meta =
            key === "holiday"
              ? { label: "Holidays", color: EVENT_HUE.holiday }
              : EVENT_META[key];
          const shown = isShown(key);
          return (
            <Chip
              key={key}
              size="small"
              clickable
              onClick={() => toggle(key)}
              icon={
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: meta.color,
                    ml: "8px !important",
                    opacity: shown ? 1 : 0.35,
                  }}
                />
              }
              label={meta.label}
              variant={shown ? "filled" : "outlined"}
              sx={{
                fontWeight: 600,
                color: shown ? "text.primary" : "text.disabled",
                bgcolor: shown ? `color-mix(in srgb, ${meta.color} 16%, transparent)` : "transparent",
                borderColor: "divider",
              }}
            />
          );
        })}
      </Stack>

      <Stack direction={{ xs: "column", lg: "row" }} spacing={2} sx={{ alignItems: "stretch" }}>
        <Card
          sx={{
            flexGrow: 1,
            minWidth: 0,
            height: { xs: "auto", lg: 700 },
            p: 2,
            display: "flex",
            flexDirection: "column",
            // Theme-aware react-big-calendar: its default CSS is light-only and
            // clashes with the app shell, so map its classes onto MUI tokens
            // (works in light and dark, rounded, subtle borders).
            "& .rbc-toolbar": { mb: 2, gap: 1, flexWrap: "wrap" },
            "& .rbc-toolbar-label": { fontWeight: 800, fontSize: "1.05rem" },
            "& .rbc-btn-group button": {
              color: "text.primary",
              borderColor: "divider",
              bgcolor: "background.paper",
            },
            "& .rbc-btn-group button:hover": { bgcolor: "action.hover" },
            "& .rbc-btn-group button.rbc-active": {
              bgcolor: "primary.main",
              color: "primary.contrastText",
              borderColor: "primary.main",
            },
            "& .rbc-btn-group button.rbc-active:hover": { bgcolor: "primary.dark" },
            "& .rbc-month-view, & .rbc-time-view, & .rbc-agenda-view": {
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              overflow: "hidden",
            },
            "& .rbc-header": {
              py: 1,
              fontWeight: 600,
              color: "text.secondary",
              borderColor: "divider",
            },
            "& .rbc-header + .rbc-header, & .rbc-day-bg + .rbc-day-bg, & .rbc-month-row + .rbc-month-row, & .rbc-time-content, & .rbc-timeslot-group, & .rbc-time-header-content, & .rbc-time-content > * + * > *":
              { borderColor: "divider" },
            "& .rbc-off-range-bg": { bgcolor: "action.hover" },
            "& .rbc-today": { bgcolor: "action.selected" },
            "& .rbc-date-cell": { p: 0.5, fontSize: "0.8rem" },
            "& .rbc-event": {
              borderRadius: "6px",
              border: "none",
              padding: "2px 6px",
              fontSize: "0.72rem",
              fontWeight: 600,
              boxShadow: "0 1px 2px rgba(15,23,42,0.2)",
            },
            "& .rbc-event:focus": { outline: "none" },
            "& .rbc-event.rbc-selected": { filter: "brightness(0.92)" },
            "& .rbc-show-more": { color: "primary.main", fontWeight: 600, bgcolor: "transparent" },
          }}
        >
          {calendarKey === "BS" && showLocal ? (
            // The company's own months. Drag-to-reschedule belongs to the
            // Gregorian view: react-big-calendar owns that interaction, and
            // reimplementing it on a second grid would be two behaviours to keep
            // in step. Clicking a day still opens the create dialog.
            <BikramMonthGrid
              month={shownMonth}
              offset={monthOffset}
              onOffsetChange={setMonthOffset}
              events={localEvents}
              holidays={holidayMap}
              workingDays={workingDays}
              onSelectDay={
                canManage
                  ? (gregorian) => {
                      const start = new Date(`${gregorian}T09:00:00`);
                      handleSelectSlot({ start, end: new Date(start.getTime() + 3600_000) });
                    }
                  : undefined
              }
            />
          ) : mounted ? (
            <DnDCalendar
              localizer={localizer}
              events={calendarEvents}
              startAccessor="start"
              endAccessor="end"
              style={{ height: "100%", minHeight: 560 }}
              popup
              selectable={canManage}
              resizable={canManage}
              eventPropGetter={eventPropGetter}
              dayPropGetter={dayPropGetter}
              onSelectSlot={handleSelectSlot}
              onSelectEvent={handleSelectEvent}
              onEventDrop={handleEventDrop}
              onEventResize={handleEventDrop}
              onRangeChange={handleRangeChange}
            />
          ) : (
            // The prerender's placeholder. Sized to the grid so the card does
            // not resize under the reader when the real one mounts.
            <Skeleton variant="rounded" sx={{ flexGrow: 1, minHeight: 560 }} />
          )}
        </Card>

        <Card
          sx={{
            width: { xs: "100%", lg: 320 },
            flexShrink: 0,
            height: { xs: "auto", lg: 700 },
            p: 2,
            overflowY: "auto",
          }}
        >
          <CalendarAgenda
            // The month summary follows the Bikram Sambat grid. On the
            // Gregorian view it is left off rather than shown for a month the
            // reader is not looking at — a "working days" figure for the wrong
            // month is worse than none.
            month={calendarKey === "BS" && showLocal ? shownMonth : undefined}
            monthHolidays={holidayMap}
            workingDays={workingDays}
            events={calendarEvents.map((e) => e.resource)}
            holidays={isShown("holiday") ? (holidayPage?.results ?? []) : []}
            onSelectEvent={canManage ? openEvent : undefined}
          />
        </Card>
      </Stack>

      <CompanyEventDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initialStart={dialogRange?.start ?? null}
        initialEnd={dialogRange?.end ?? null}
        editingEvent={editingEvent}
      />
    </Box>
  );
}
