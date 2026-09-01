"use client";

import { useState } from "react";
import { Box, Typography, Card, Table, TableBody, TableCell, TableHead, TableRow, IconButton, Tooltip } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useAttendanceCalendar } from "@/hooks/useAttendance";
import { toIsoDate } from "@/lib/format/period";

function getDaysInMonth(year: number, month: number) {
  const date = new Date(year, month, 1);
  const days = [];
  // Use UTC to avoid timezone shifting issues when rendering days
  while (date.getMonth() === month) {
    days.push(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

export default function ShiftCalendar() {
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const days = getDaysInMonth(year, month);
  // Local, not UTC: `days` are local dates, and `toISOString()` would push
  // the first of the month back into the previous one.
  const startDateStr = toIsoDate(days[0]);
  const endDateStr = toIsoDate(days[days.length - 1]);

  const { data, isLoading } = useAttendanceCalendar(startDateStr, endDateStr);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  if (isLoading) {
    return <Typography sx={{ p: 4 }}>Loading Calendar...</Typography>;
  }

  const employees = data?.employees || [];
  const cells = data?.cells || [];

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'present': return 'success.main';
      case 'absent': return 'error.main';
      case 'late': return 'warning.main';
      case 'half_day': return 'info.main';
      case 'holiday': return 'secondary.main';
      case 'on_leave': return 'primary.main';
      default: return 'text.disabled';
    }
  };

  return (
    <Card sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', p: 2, justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</Typography>
        <Box>
          <IconButton onClick={prevMonth}><ChevronLeftIcon /></IconButton>
          <IconButton onClick={nextMonth}><ChevronRightIcon /></IconButton>
        </Box>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 800 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 200, position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 2 }}>Employee</TableCell>
              {days.map(day => (
                <TableCell key={day.toISOString()} align="center" sx={{ minWidth: 32, p: 0.5, borderLeft: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="caption" sx={{ display: "block" }}>{day.getUTCDate()}</Typography>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {employees.map((emp) => (
              <TableRow key={emp.id} hover>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, borderRight: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="body2" noWrap>{emp.full_name}</Typography>
                </TableCell>
                {days.map(day => {
                  const dayStr = toIsoDate(day);
                  const cell = cells.find((c) => c.employee === emp.id && c.date === dayStr);
                  return (
                    <TableCell key={dayStr} align="center" sx={{ p: 0, borderLeft: '1px solid', borderColor: 'divider' }}>
                      {cell && (
                        <Tooltip title={cell.status} placement="top">
                          <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: getStatusColor(cell.status), mx: 'auto', cursor: 'pointer' }} />
                        </Tooltip>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {employees.length === 0 && (
              <TableRow>
                <TableCell colSpan={days.length + 1} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No employees found.</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
    </Card>
  );
}
