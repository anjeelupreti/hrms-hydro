# Calendar UI

Phase 8. Pairs with `hooks/useCalendar.ts` and `types/calendar.ts`.

- **`AttendanceCalendarGrid.tsx`** — a custom grid (plain `Box`es on CSS
  grid, not a table), not a general-purpose calendar library — this is a
  status *matrix* (employee rows × day columns), a different shape than
  an event calendar, so `react-big-calendar` (used for `CompanyEvent`
  below) doesn't fit it. Reused by both `app/attendance/calendar/page.tsx`
  (full month, all visible employees) and
  `components/dashboard/MyAttendanceWidget.tsx` (current month, one row).
- **`CompanyEventDialog.tsx`** — create/edit a `CompanyEvent`. Split into
  an outer component (owns the always-mounted `Dialog`, so MUI's close
  transition still animates) and an inner form keyed by the event/slot
  identity — the same shape `components/employees/EmployeeFormDialog.tsx`
  uses, for the same reason: initializing `useState` from a `useEffect`
  here tripped `react-hooks/set-state-in-effect`. Copy this shape for any
  future "one dialog edits whichever of several records was clicked" UI.

## `app/calendar/page.tsx` — Company Calendar

Uses `react-big-calendar` + its `dragAndDrop` addon (`date-fns` as the
localizer) — the first calendar/UI library in this frontend beyond
MUI/motion/TanStack Query, a deliberate scope decision (see
`docs/development-plan.md`) over hand-rolling drag-and-drop. HR/superuser
(`useMe().role`) can click-drag a slot to create an event, drag an
existing event to reschedule (`onEventDrop`/`onEventResize` →
`PATCH company-events/{id}/`), or click one to edit/delete. Everyone else
gets a read-only calendar (`selectable`/`resizable` gated off `canManage`).
