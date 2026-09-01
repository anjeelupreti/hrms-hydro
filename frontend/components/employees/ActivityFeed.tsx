"use client";

import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import BeachAccessIcon from "@mui/icons-material/BeachAccess";
import ReceiptIcon from "@mui/icons-material/Receipt";
import ScheduleIcon from "@mui/icons-material/Schedule";
import SchoolIcon from "@mui/icons-material/School";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import DateText from "@/components/common/DateText";
import { useEmployeeActivity, type ActivityEvent } from "@/hooks/useEmployees";

/**
 * What somebody has been doing.
 *
 * What somebody *did*: leave they asked for, hours they logged, expenses they
 * claimed, training they finished, tasks they closed.
 *
 * Deliberately not `EmployeeLog` — "department changed from Operations to Plant
 * Operations, by HR Admin" is an audit of edits made to their record, and
 * nobody opens their own profile to find out which of their fields an
 * administrator touched. That audit is drawn by Record history and
 * the position timeline. This one becomes the feed it was named after; the
 * other two keep the audit, which is what they are for.
 *
 * **One icon per kind, and the icon is the only colour.** A feed mixing six
 * modules needs the eye to sort it without reading, and six differently
 * coloured cards would be a fruit salad. Status colour is reserved for status,
 * as everywhere else.
 */

const KIND_META: Record<ActivityEvent["kind"], { icon: ReactNode; label: string }> = {
  leave: { icon: <BeachAccessIcon fontSize="small" />, label: "Leave" },
  timesheet: { icon: <ScheduleIcon fontSize="small" />, label: "Timesheet" },
  expense: { icon: <ReceiptIcon fontSize="small" />, label: "Expense" },
  training: { icon: <SchoolIcon fontSize="small" />, label: "Training" },
  task: { icon: <AssignmentTurnedInIcon fontSize="small" />, label: "Task" },
  lifecycle: { icon: <TrendingUpIcon fontSize="small" />, label: "Career" },
};

export default function ActivityFeed({
  employeeId,
  mine = false,
}: {
  employeeId: number | null;
  mine?: boolean;
}) {
  const { data: events, isPending } = useEmployeeActivity(employeeId);

  return (
    <Card>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {mine ? "What I have been doing" : "What they have been doing"}
        </Typography>

        {isPending ? null : !events || events.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Nothing recorded yet — leave, timesheets, expenses, training and finished tasks all
            appear here.
          </Typography>
        ) : (
          <Stack spacing={0} sx={{ mt: 1.5 }}>
            {events.map((event, i) => {
              const meta = KIND_META[event.kind];
              return (
                <Stack key={`${event.date}-${event.text}-${i}`} direction="row" spacing={2}>
                  <Stack sx={{ alignItems: "center", width: 28, flexShrink: 0 }}>
                    <Box
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        display: "grid",
                        placeItems: "center",
                        bgcolor: "action.hover",
                        color: "text.secondary",
                        flexShrink: 0,
                      }}
                    >
                      {meta?.icon}
                    </Box>
                    {i < events.length - 1 && (
                      <Box sx={{ flex: 1, width: "2px", bgcolor: "divider", my: 0.5, minHeight: 12 }} />
                    )}
                  </Stack>

                  <Box sx={{ pb: i < events.length - 1 ? 2 : 0, minWidth: 0 }}>
                    <Typography variant="body2">{event.text}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {meta?.label} · <DateText value={event.date} />
                    </Typography>
                  </Box>
                </Stack>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
