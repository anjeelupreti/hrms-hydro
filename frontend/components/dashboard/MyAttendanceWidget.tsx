"use client";

import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";

import AttendanceCalendarGrid from "@/components/calendar/AttendanceCalendarGrid";
import { useAttendanceCalendar } from "@/hooks/useCalendar";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function MyAttendanceWidget({
  employeeId,
  /**
   * Whose record this is. The widget was written for the dashboard, where it is
   * always the reader's own, and the heading said "My attendance this month" —
   * which then appeared verbatim on an HR screen above somebody else's month.
   * A page that calls another person's record "mine" is a small lie in the one
   * place accuracy is the entire point.
   */
  mine = true,
}: {
  employeeId: number;
  mine?: boolean;
}) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const start = `${year}-${pad(month)}-01`;
  const end = `${year}-${pad(month)}-${pad(daysInMonth)}`;

  const { data } = useAttendanceCalendar(start, end, employeeId);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <CalendarMonthIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1">{mine ? "My attendance this month" : "Attendance this month"}</Typography>
          </Stack>
          <Link component={NextLink} href="/attendance/calendar" variant="body2">
            View full calendar
          </Link>
        </Stack>
        <Box sx={{ "& > div": { minWidth: "auto" } }}>
          <AttendanceCalendarGrid data={data} year={year} month={month} />
        </Box>
      </CardContent>
    </Card>
  );
}
