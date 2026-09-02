"use client";

import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import EditIcon from "@mui/icons-material/Edit";
import LockIcon from "@mui/icons-material/Lock";
import ViewListIcon from "@mui/icons-material/ViewList";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Link from "next/link";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import DataGrid from "@/components/common/LazyDataGrid";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import { ATTENDANCE_HUE } from "@/lib/theme/tokens";
import ClockWidget from "@/components/attendance/ClockWidget";
import RegularisationQueue from "@/components/attendance/RegularisationQueue";
import PageContainer from "@/components/shell/PageContainer";
import ArrivalClock from "@/components/charts/ArrivalClock";
import SectionCard from "@/components/common/SectionCard";
import PageHeader from "@/components/shell/PageHeader";
import AttendanceCorrectionDialog from "@/components/attendance/AttendanceCorrectionDialog";
import AttendanceCalendarGrid from "@/components/calendar/AttendanceCalendarGrid";
import ShiftManagementModal from "@/components/attendance/ShiftManagementModal";
import EmployeeLink from "@/components/common/EmployeeLink";
import EmptyState from "@/components/common/EmptyState";
import ExportButton from "@/components/common/ExportButton";
import { useArrivalTimes, useAttendanceLogs } from "@/hooks/useAttendance";
import { useAttendanceCalendar } from "@/hooks/useCalendar";
import { useCan } from "@/hooks/useMe";
import SearchField from "@/components/common/SearchField";
import type { AttendanceLog, AttendanceStatus } from "@/types/attendance";
import { todayIso } from "@/lib/format/period";

const STATUS_COLOR: Record<AttendanceStatus, "success" | "warning" | "error" | "default"> = {
  present: "success",
  late: "warning",
  absent: "error",
  half_day: "default",
};

const LEGEND = [
  { color: ATTENDANCE_HUE.present, label: "Present" },
  { color: ATTENDANCE_HUE.late, label: "Late" },
  { color: ATTENDANCE_HUE.absent, label: "Absent" },
  { color: ATTENDANCE_HUE.half_day, label: "Half day" },
  { color: ATTENDANCE_HUE.on_leave, label: "On leave" },
  { color: ATTENDANCE_HUE.holiday, label: "Holiday" },
];

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isToday(dateStr: string) {
  return dateStr === todayIso();
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function AttendancePage() {
  const canManage = useCan("attendance.manage");
  const { data: arrivals, isLoading: arrivalsLoading } = useArrivalTimes();

  // Calendar is the primary view; the flat log list is the alternate.
  const [view, setView] = useState<"calendar" | "list">("calendar");

  // Calendar state
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const calStart = `${year}-${pad(month)}-01`;
  const calEnd = `${year}-${pad(month)}-${pad(daysInMonth)}`;
  const { data: calendar, isLoading: calLoading } = useAttendanceCalendar(calStart, calEnd);

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m > 12) {
      m = 1;
      y += 1;
    } else if (m < 1) {
      m = 12;
      y -= 1;
    }
    setMonth(m);
    setYear(y);
  }

  // List state
  const [status, setStatus] = useState<AttendanceStatus | "">("");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [correcting, setCorrecting] = useState<AttendanceLog | null>(null);
  const { data: logs, isLoading } = useAttendanceLogs({
    page: paginationModel.page + 1,
    pageSize: paginationModel.pageSize,
    status: status || undefined,
    date: date || undefined,
    search: search || undefined,
  });

  const [managingShifts, setManagingShifts] = useState(false);

  const columns: GridColDef<AttendanceLog>[] = [
    { field: "employee_code", headerName: "Code", width: 110 },
    {
      field: "employee_name",
      headerName: "Name",
      flex: 1,
      minWidth: 160,
      renderCell: (params) => <EmployeeLink id={params.row.employee} name={params.value as string} />,
    },
    { field: "date", headerName: "Date", width: 120 },
    // "First in" / "Last out" rather than "In" / "Out", because that is what
    // they are: a day with a lunch break has punches between the two. The
    // detail page shows all of them.
    { field: "check_in_time", headerName: "First in", width: 92, valueGetter: (_, row) => formatTime(row.check_in_time) },
    { field: "check_out_time", headerName: "Last out", width: 92, valueGetter: (_, row) => formatTime(row.check_out_time) },
    {
      field: "sessions",
      headerName: "Punches",
      width: 100,
      sortable: false,
      renderCell: (params: { row: AttendanceLog }) => {
        const count = params.row.sessions?.length ?? 0;
        return (
          <Tooltip title={count > 1 ? "Left and came back — open for the detail" : ""}>
            <Box
              component={Link}
              href={`/attendance/${params.row.employee}`}
              sx={{
                textDecoration: "none",
                color: count > 1 ? "primary.main" : "text.secondary",
                fontWeight: count > 1 ? 700 : 400,
              }}
            >
              {count || "—"}
            </Box>
          </Tooltip>
        );
      },
    },
    { field: "source", headerName: "Source", width: 110 },
    {
      field: "status",
      headerName: "Status",
      width: 130,
      renderCell: (params) => (
        <Chip size="small" label={params.value.replace("_", " ")} color={STATUS_COLOR[params.value as AttendanceStatus]} />
      ),
    },
    ...(canManage
      ? [
          {
            field: "actions",
            headerName: "",
            width: 60,
            sortable: false,
            filterable: false,
            renderCell: (params: { row: AttendanceLog }) =>
              isToday(params.row.date) ? (
                <IconButton size="small" onClick={() => setCorrecting(params.row)} title="Correct today's log">
                  <EditIcon fontSize="small" />
                </IconButton>
              ) : (
                <Tooltip title="Locked — only today's attendance can be corrected">
                  <LockIcon fontSize="small" color="disabled" />
                </Tooltip>
              ),
          } satisfies GridColDef<AttendanceLog>,
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Attendance"
        subtitle="Punches, days and who is in today"
        icon={<EventAvailableIcon />}
        actions={
          <>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v) => v && setView(v)}
            aria-label="Attendance view"
          >
            <ToggleButton value="calendar">
              <CalendarMonthIcon fontSize="small" sx={{ mr: 0.5 }} /> Calendar
            </ToggleButton>
            <ToggleButton value="list">
              <ViewListIcon fontSize="small" sx={{ mr: 0.5 }} /> List
            </ToggleButton>
          </ToggleButtonGroup>
          {canManage && (
            <Button variant="outlined" size="small" onClick={() => setManagingShifts(true)}>
              Manage Shifts
            </Button>
          )}
          <ExportButton
            path="attendance/logs"
            size="small"
            baseQuery={view === "calendar" ? `date__gte=${calStart}&date__lte=${calEnd}` : undefined}
            filters={[
              { type: "daterange", field: "date", label: "Date" },
              {
                type: "select",
                param: "status",
                label: "Status",
                options: [
                  { value: "present", label: "Present" },
                  { value: "late", label: "Late" },
                  { value: "absent", label: "Absent" },
                  { value: "half_day", label: "Half day" },
                ],
              },
            ]}
          />

        </Stack>
      
          </>
        }
      />

      {/* **The question is not how many were late.**
          That is a percentage; it goes in a report and changes nothing. The
          question is whether the start time the system publishes is the one
          people actually keep — and that is a shape, not a number. An office
          whose arrivals bunch forty minutes past its own start does not have a
          lateness problem, it has a start-time problem, and no amount of
          counting late arrivals will ever show that. */}
      {canManage ? (
        <Box sx={{ mb: 3 }}>
          <SectionCard
            title="When the office actually starts"
            subtitle="Every check-in of the last four weeks, by time of day"
          >
            {arrivalsLoading ? (
              <Skeleton variant="rounded" height={300} />
            ) : (
              <ArrivalClock
                slots={arrivals?.slots ?? []}
                officeStart={arrivals?.office_start ?? null}
                median={arrivals?.median ?? null}
                total={arrivals?.total ?? 0}
                afterStart={arrivals?.after_start ?? null}
              />
            )}
          </SectionCard>
        </Box>
      ) : null}

      {/* Your own punch, on the page you came to for punches. Shown to
          everyone — HR clock in too — and needed here because employees
          cannot open the dashboard the other clock lives on. */}
      <Box sx={{ mb: 3 }}>
        <ClockWidget />
      </Box>

      {/* Disputes, for whoever decides them. The queue existed only on an
          individual's page, so an approver had to already know who had raised
          something in order to go and look — which is the wrong way round: the
          point of a queue is that it tells you. Shown only to somebody who can
          act on it; an employee sees their own on their own page. */}
      {canManage ? (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
            Reported problems
          </Typography>
          <RegularisationQueue canDecide />
        </Box>
      ) : null}


      {view === "calendar" ? (
        <Card>
          <CardContent>
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ alignItems: "center", justifyContent: "space-between", mb: 2, flexWrap: "wrap", gap: 1 }}
            >
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                {LEGEND.map((item) => (
                  <Chip key={item.label} size="small" label={item.label} sx={{ bgcolor: item.color, color: "common.white" }} />
                ))}
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <IconButton onClick={() => shiftMonth(-1)} size="small">
                  <ChevronLeftIcon />
                </IconButton>
                <Typography variant="subtitle1" sx={{ minWidth: 150, textAlign: "center" }}>
                  {new Date(year, month - 1, 1).toLocaleString("default", { month: "long", year: "numeric" })}
                </Typography>
                <IconButton onClick={() => shiftMonth(1)} size="small">
                  <ChevronRightIcon />
                </IconButton>
              </Stack>
            </Stack>

            {calLoading ? (
              <Stack sx={{ alignItems: "center", py: 4 }}>
                <CircularProgress size={24} />
              </Stack>
            ) : (
              <AttendanceCalendarGrid data={calendar} year={year} month={month} />
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
            <SearchField
              value={search}
              onChange={(v) => {
                setSearch(v);
                // A narrower result set almost never has the page you were on.
                setPaginationModel((m) => ({ ...m, page: 0 }));
              }}
              placeholder="Search employees…"
              label="Search attendance by employee name or code"
            />
            <TextField
              select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as AttendanceStatus | "")}
              size="small"
              fullWidth
              sx={{ maxWidth: { sm: 180 } }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="present">Present</MenuItem>
              <MenuItem value="late">Late</MenuItem>
              <MenuItem value="absent">Absent</MenuItem>
              <MenuItem value="half_day">Half Day</MenuItem>
            </TextField>
            <DateField
              label="Date"
              value={date}
              onChange={setDate}
              size="small"
              sx={{ maxWidth: { sm: 200 } }}
            />
          </Stack>

          {/* **A filtered miss and an empty month are different facts.** The
              grid's own "No rows" says neither, and the second is the one a new
              company sees — which is the screen this product is judged on. */}
          {!isLoading && (logs?.results?.length ?? 0) === 0 ? (
            <EmptyState
              surface
              variant={status || date ? "noResults" : "empty"}
              title={
                status || date
                  ? "Nothing matches those filters"
                  : "No attendance recorded yet"
              }
              description={
                status || date
                  ? "Try a different date, or clear the status."
                  : "Once people start clocking in — from the system or a reader — their days appear here. HR can also record a day by hand."
              }
              action={
                status || date ? (
                  <Button
                    onClick={() => {
                      setStatus("");
                      setDate("");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
          <DataGrid
            rows={logs?.results ?? []}
            columns={columns}
            loading={isLoading}
            paginationMode="server"
            rowCount={logs?.count ?? 0}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[10, 25, 50, 100]}
            disableRowSelectionOnClick
            autoHeight
            getRowId={(row) => row.id}
          />
          )}
        </>
      )}

      <AttendanceCorrectionDialog open={correcting !== null} onClose={() => setCorrecting(null)} log={correcting} />
      {managingShifts && <ShiftManagementModal open={managingShifts} onClose={() => setManagingShifts(false)} />}
    </PageContainer>
  );
}
