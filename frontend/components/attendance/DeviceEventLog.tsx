"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Punches a terminal sent that never became attendance.
 *
 * Where staged device events are looked up. `process_attendance_device_events`
 * catches a `PunchError` and records it on the event rather than dropping it —
 * "a device that replays an event, or swipes out twice, is a fact worth being
 * able to look up" — and this is the screen that looks them up.
 *
 * What that costs: a terminal sends a punch for a PIN that maps to no employee,
 * or for somebody whose workspace has biometric turned off, and the punch is
 * held with an explanation nobody reads. To the employee their attendance
 * simply did not register, and to HR the day looks like an absence. The record
 * needed to explain it existed the whole time.
 *
 * **Failures first, and by default the only thing shown.** A processed event is
 * a punch that worked and is already visible as attendance — listing thousands
 * of those would bury the handful that need a person. The successes are one
 * click away for when somebody is proving a device is alive.
 *
 * **The reported identifiers are shown verbatim**, because the fix is almost
 * always mapping `external_employee_id` to a person, and that is a value
 * somebody has to read off this screen and type into a device mapping.
 */

type DeviceEvent = {
  id: number;
  device: number | null;
  device_name: string | null;
  reported_device_id: string;
  external_employee_id: string;
  event_type: string;
  raw_timestamp: string;
  processed: boolean;
  processed_at: string | null;
  error: string;
};

type Paginated<T> = { count: number; results: T[] };

function useDeviceEvents(processed: boolean) {
  return useQuery({
    queryKey: ["device-events", processed],
    queryFn: async () => {
      const res = await fetch(
        `/api/proxy/attendance/device-events?processed=${processed ? "true" : "false"}&page_size=100`,
      );
      if (!res.ok) throw new Error("Could not load device events");
      const data = (await res.json()) as Paginated<DeviceEvent> | DeviceEvent[];
      return Array.isArray(data) ? data : data.results;
    },
  });
}

export default function DeviceEventLog() {
  const [showProcessed, setShowProcessed] = useState(false);
  const { data: events, isLoading } = useDeviceEvents(showProcessed);

  const rows = events ?? [];
  // An unprocessed event with no error has not been through the processor yet;
  // one with an error has been tried and refused. Different problems.
  const failed = rows.filter((event) => event.error);
  const waiting = rows.filter((event) => !event.error && !event.processed);

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Punches that did not land
          </Typography>
          <Button size="small" onClick={() => setShowProcessed((v) => !v)}>
            {showProcessed ? "Show problems" : "Show accepted"}
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {isLoading
            ? "…"
            : showProcessed
              ? `${rows.length} accepted event${rows.length === 1 ? "" : "s"} from your terminals.`
              : failed.length === 0 && waiting.length === 0
                ? "Every punch a terminal sent became attendance."
                : failed.length > 0
                  ? `${failed.length} punch${failed.length === 1 ? "" : "es"} were refused and never became attendance — to the employee it looks like they never clocked in.`
                  : `${waiting.length} event${waiting.length === 1 ? "" : "s"} waiting to be processed.`}
        </Typography>

        {isLoading ? (
          <Skeleton variant="rounded" height={140} />
        ) : rows.length === 0 ? (
          <Box sx={{ py: 3, textAlign: "center" }}>
            <Typography variant="body2" sx={{ color: "text.disabled" }}>
              {showProcessed ? "No accepted events recorded." : "Nothing held."}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>When</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Terminal</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Reported ID</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Event</TableCell>
                  {showProcessed ? null : <TableCell sx={{ fontWeight: 700 }}>Why it was held</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Typography sx={{ fontSize: 13 }}>
                        {new Date(event.raw_timestamp).toLocaleString(undefined, {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: 13 }}>
                        {event.device_name ?? (
                          <Tooltip title="This serial is not a registered device in this system.">
                            <Box component="span" sx={{ color: "var(--hrms-status-warning-fg)" }}>
                              {event.reported_device_id || "unknown"}
                            </Box>
                          </Tooltip>
                        )}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {/* Monospace: this is an identifier somebody copies into
                          a device mapping, and 0O/1l matter when they do. */}
                      <Typography sx={{ fontSize: 12, fontFamily: "monospace" }}>
                        {event.external_employee_id || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                        {event.event_type === "check_in" ? "in" : "out"}
                      </Typography>
                    </TableCell>
                    {showProcessed ? null : (
                      <TableCell>
                        <Typography
                          sx={{
                            fontSize: 12,
                            color: event.error ? "var(--hrms-status-danger-fg)" : "text.disabled",
                          }}
                        >
                          {event.error || "not processed yet"}
                        </Typography>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
