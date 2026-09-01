"use client";

import { ATTENDANCE_HUE } from "@/lib/theme/tokens";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import EmployeeLink from "@/components/common/EmployeeLink";
import type { AttendanceCalendarResponse } from "@/types/calendar";

const STATUS_COLOR: Record<string, string> = {
  present: ATTENDANCE_HUE.present,
  late: ATTENDANCE_HUE.late,
  absent: ATTENDANCE_HUE.absent,
  half_day: ATTENDANCE_HUE.half_day,
  on_leave: ATTENDANCE_HUE.on_leave,
  holiday: ATTENDANCE_HUE.holiday,
};

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  half_day: "Half day",
  on_leave: "On leave",
  holiday: "Holiday",
};

type Props = {
  data: AttendanceCalendarResponse | undefined;
  year: number;
  month: number; // 1-12
};

export default function AttendanceCalendarGrid({ data, year, month }: Props) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const cellMap = new Map<string, string>();
  data?.cells.forEach((cell) => {
    cellMap.set(`${cell.employee}-${cell.date}`, cell.status);
  });

  if (!data || data.employees.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        No employees to show for this range.
      </Typography>
    );
  }

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: `160px repeat(${daysInMonth}, 28px)`, minWidth: 160 + daysInMonth * 28 }}>
        <Box sx={{ position: "sticky", left: 0, bgcolor: "background.paper", zIndex: 1, fontWeight: 700, p: 1 }}>
          Employee
        </Box>
        {days.map((day) => (
          <Box
            key={day}
            sx={{ textAlign: "center", fontSize: 11, color: "text.secondary", py: 1 }}
          >
            {day}
          </Box>
        ))}

        {data.employees.map((employee) => (
          <Box key={employee.id} sx={{ display: "contents" }}>
            <Box
              sx={{
                position: "sticky",
                left: 0,
                bgcolor: "background.paper",
                zIndex: 1,
                p: 1,
                fontSize: 13,
                borderTop: "1px solid",
                borderColor: "divider",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <EmployeeLink id={employee.id} name={employee.full_name} />
            </Box>
            {days.map((day) => {
              const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const status = cellMap.get(`${employee.id}-${dateStr}`);
              return (
                <Box
                  key={day}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderTop: "1px solid",
                    borderColor: "divider",
                    py: 1,
                  }}
                >
                  {status && (
                    <Tooltip title={`${dateStr}: ${STATUS_LABEL[status] ?? status}`}>
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: STATUS_COLOR[status] ?? "grey.400",
                        }}
                      />
                    </Tooltip>
                  )}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
