# Attendance UI

- `ClockWidget.tsx` — on the dashboard homepage. Shows today's status
  (via `useMyTodayAttendance`) and a Check In/Check Out button. Renders
  nothing (`isError → null`) for accounts with no linked `Employee`
  profile — e.g. an HR-only login with no self-attendance to track.
- `app/attendance/page.tsx` — HR/manager list view: DataGrid with
  status/date filters, server-side pagination (same pattern as
  `components/employees`).
- `AttendanceCorrectionDialog.tsx` — wide modal for HR corrections, shows
  the `AttendanceEditLog` history. **Only rendered for today's rows** —
  the list page shows a lock icon instead of an edit action for any
  non-today row, mirroring the backend's same-day edit lock
  (`attendance.permissions.AttendanceLogPermission`). This is UX
  courtesy, not the real enforcement — the backend still rejects a
  same-day-bypassing request even if the frontend check were somehow
  skipped.

- `app/attendance/calendar/page.tsx` (Phase 8) — month-navigable
  day-by-day grid (all visible employees × day columns), backed by
  `components/calendar/AttendanceCalendarGrid.tsx` (shared with the
  dashboard's `MyAttendanceWidget`). Colored dot per cell, not a filled
  background — keeps the grid readable at a glance without a `Chip` per
  cell.

Data hooks: `hooks/useAttendance.ts`. Types: `types/attendance.ts`.
