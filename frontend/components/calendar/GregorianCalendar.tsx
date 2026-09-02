"use client";

import { enUS } from "date-fns/locale/en-US";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { Calendar, dateFnsLocalizer, type View } from "react-big-calendar";
import withDragAndDrop, {
  type EventInteractionArgs,
} from "react-big-calendar/lib/addons/dragAndDrop";

import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

import type { CompanyEvent } from "@/types/calendar";

/**
 * The Gregorian month grid — `react-big-calendar` and everything it drags in.
 *
 * **Why it is a file of its own.** This is the only place in the product that
 * uses `react-big-calendar`, its drag-and-drop addon, and their two stylesheets
 * — the heaviest thing on the page by a wide margin. And the calendar opens in
 * **Bikram Sambat by default** (`showLocal` starts `true`), which is drawn by
 * `BikramMonthGrid`, a hand-rolled table that needs none of this. So the
 * library was downloaded, parsed and its CSS applied on every visit to
 * `/calendar` for a grid that most visits never display.
 *
 * Pulling it behind its own module lets the page load it only when somebody
 * actually switches to AD. The page keeps the mount guard and the skeleton it
 * already had, so nothing about the layout changes.
 *
 * Everything here was lifted from `app/calendar/page.tsx` unchanged, including
 * the module-scope `withDragAndDrop(Calendar)` call — which is exactly the
 * thing that could not be deferred while it sat at the top of a page module.
 */

export type RbcEvent = {
  id: number;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CompanyEvent;
};

const locales = { "en-US": enUS };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: enUS }),
  getDay,
  locales,
});

const DnDCalendar = withDragAndDrop<RbcEvent>(Calendar);

export type GregorianCalendarProps = {
  events: RbcEvent[];
  canManage: boolean;
  eventPropGetter: (event: RbcEvent) => { style: React.CSSProperties };
  dayPropGetter: (date: Date) => { style?: React.CSSProperties };
  onSelectSlot: (slot: { start: Date; end: Date }) => void;
  onSelectEvent: (event: RbcEvent) => void;
  onEventDrop: (args: EventInteractionArgs<RbcEvent>) => void;
  onRangeChange: (range: Date[] | { start: Date; end: Date }, view?: View) => void;
};

export default function GregorianCalendar({
  events,
  canManage,
  eventPropGetter,
  dayPropGetter,
  onSelectSlot,
  onSelectEvent,
  onEventDrop,
  onRangeChange,
}: GregorianCalendarProps) {
  return (
    <DnDCalendar
      localizer={localizer}
      events={events}
      startAccessor="start"
      endAccessor="end"
      style={{ height: "100%", minHeight: 560 }}
      popup
      selectable={canManage}
      resizable={canManage}
      eventPropGetter={eventPropGetter}
      dayPropGetter={dayPropGetter}
      onSelectSlot={onSelectSlot}
      onSelectEvent={onSelectEvent}
      onEventDrop={onEventDrop}
      onEventResize={onEventDrop}
      onRangeChange={onRangeChange}
    />
  );
}
