"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import { ATTENDANCE_HUE } from "@/lib/theme/tokens";
import AttendanceCalendarGrid from "@/components/calendar/AttendanceCalendarGrid";
import ExportButton from "@/components/common/ExportButton";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useAttendanceCalendar } from "@/hooks/useCalendar";

const LEGEND = [
  { status: "present", color: ATTENDANCE_HUE.present, label: "Present" },
  { status: "late", color: ATTENDANCE_HUE.late, label: "Late" },
  { status: "absent", color: ATTENDANCE_HUE.absent, label: "Absent" },
  { status: "half_day", color: ATTENDANCE_HUE.half_day, label: "Half day" },
  { status: "on_leave", color: ATTENDANCE_HUE.on_leave, label: "On leave" },
  { status: "holiday", color: ATTENDANCE_HUE.holiday, label: "Holiday" },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function AttendanceCalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const daysInMonth = new Date(year, month, 0).getDate();
  const start = `${year}-${pad(month)}-01`;
  const end = `${year}-${pad(month)}-${pad(daysInMonth)}`;

  const { data, isLoading } = useAttendanceCalendar(start, end);

  function shiftMonth(delta: number) {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    } else if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    setMonth(newMonth);
    setYear(newYear);
  }

  return (
    <PageContainer>
      <Button component={Link} href="/attendance" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1 }}>
        Attendance
      </Button>

      <PageHeader
        title="Attendance Calendar"
        subtitle="Day-by-day status across the team"
        icon={<CalendarMonthIcon />}
        actions={
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <IconButton onClick={() => shiftMonth(-1)} size="small">
              <ChevronLeftIcon />
            </IconButton>
            <Typography variant="subtitle1" sx={{ minWidth: 140, textAlign: "center" }}>
              {new Date(year, month - 1, 1).toLocaleString("default", { month: "long", year: "numeric" })}
            </Typography>
            <IconButton onClick={() => shiftMonth(1)} size="small">
              <ChevronRightIcon />
            </IconButton>
            <ExportButton
              path="attendance/logs"
              size="small"
              baseQuery={`date__gte=${start}&date__lte=${end}`}
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
        }
      />

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 2.5, flexWrap: "wrap" }}>
            {LEGEND.map((item) => (
              <Chip key={item.status} size="small" label={item.label} sx={{ bgcolor: item.color, color: "common.white" }} />
            ))}
          </Stack>

          {isLoading ? (
            <Stack sx={{ alignItems: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : (
            <AttendanceCalendarGrid data={data} year={year} month={month} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
