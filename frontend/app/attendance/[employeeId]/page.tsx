"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BadgeIcon from "@mui/icons-material/Badge";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import ReportIcon from "@mui/icons-material/ReportProblemOutlined";

import RegularisationDialog from "@/components/attendance/RegularisationDialog";
import RegularisationQueue from "@/components/attendance/RegularisationQueue";
import DateText from "@/components/common/DateText";
import PersonAvatar from "@/components/common/PersonAvatar";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useAttendanceLogs } from "@/hooks/useAttendance";
import { useEmployeeDetail } from "@/hooks/useEmployees";
import { useCan, useMe } from "@/hooks/useMe";
import type { AttendanceLog } from "@/types/attendance";

/**
 * One person's attendance, punch by punch.
 *
 * **The only screen that shows the sessions.** `AttendanceSession` holds every
 * in and out — lunch and client visits included — and the clock widget renders
 * them only for the signed-in person, today. The attendance list shows
 * `check_in_time` and `check_out_time`, which are the *first* in and the *last*
 * out, so a day worked straight through and a day with a four-hour gap in the
 * middle look identical there.
 *
 * **Hours are the sum of closed sessions, not last minus first.** Somebody who
 * clocks in at 9, leaves at 11 for four hours and returns until 6 is a
 * five-hour day, and the old columns called it nine. That difference is the
 * whole reason the sessions exist.
 */

const STATUS_TONE: Record<string, "default" | "success" | "warning" | "error"> = {
  present: "success",
  late: "warning",
  absent: "error",
  half_day: "default",
};

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function duration(seconds: number) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * A day drawn as a strip, so the gaps are visible.
 *
 * Anchored to a fixed window rather than to the day's own first and last
 * punch: scaling each row to its own extent would make a two-hour morning and
 * a ten-hour day the same width, which is the failure this is meant to expose.
 */
function DayStrip({ log }: { log: AttendanceLog }) {
  // `sessions` is guarded everywhere it is read. The field is new on this
  // serializer, so a response cached before it existed — or any older client
  // — has the key absent, and `.map` on undefined takes the whole page down
  // rather than losing one row.
  const DAY_START = 6 * 3600; // 06:00
  const DAY_END = 22 * 3600; // 22:00
  const span = DAY_END - DAY_START;

  const secondsInto = (iso: string) => {
    const d = new Date(iso);
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() - DAY_START;
  };

  return (
    <Box sx={{ position: "relative", height: 18, borderRadius: "9px", bgcolor: "action.hover" }}>
      {(log.sessions ?? []).map((session) => {
        const from = Math.max(0, secondsInto(session.check_in_time));
        // An open session runs to now, so the bar keeps growing while somebody
        // is still in — but the *number* beside it does not, because that
        // counts closed sessions only.
        const to = session.check_out_time
          ? secondsInto(session.check_out_time)
          : Math.min(span, secondsInto(new Date().toISOString()));

        return (
          <Tooltip
            key={session.id}
            title={`${clock(session.check_in_time)} – ${
              session.check_out_time ? clock(session.check_out_time) : "still in"
            }${session.source ? ` · ${session.source}` : ""}`}
          >
            <Box
              sx={{
                position: "absolute",
                left: `${(from / span) * 100}%`,
                width: `${Math.max(0.8, ((to - from) / span) * 100)}%`,
                top: 0,
                height: 18,
                borderRadius: "9px",
                bgcolor: session.check_out_time ? "primary.main" : "success.main",
              }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
}

export default function EmployeeAttendancePage() {
  const params = useParams<{ employeeId: string }>();
  const employeeId = Number(params.employeeId);

  const { data: me } = useMe();
  const canManage = useCan("attendance.manage");
  const { data: employee } = useEmployeeDetail(employeeId);
  const [page, setPage] = useState(1);
  const [reporting, setReporting] = useState(false);

  const { data, isLoading } = useAttendanceLogs({
    employee: employeeId,
    page,
    pageSize: 31,
  });

  // A fresh `[]` on every render otherwise, which makes the `useMemo` over it
  // recompute every time — a memo that memoises nothing.
  const logs = useMemo(() => data?.results ?? [], [data]);

  // Own record always; anybody else's needs the capability. The server scopes
  // this too — `scope_to_visible` — so this is the message rather than the gate.
  const isSelf = me?.employee_id === employeeId;
  const allowed = isSelf || canManage;

  const totals = useMemo(() => {
    const worked = logs.reduce((sum, l) => sum + l.seconds_worked, 0);
    const punches = logs.reduce((sum, l) => sum + (l.sessions?.length ?? 0), 0);
    const split = logs.filter((l) => (l.sessions?.length ?? 0) > 1).length;
    return { worked, punches, split };
  }, [logs]);

  if (!allowed) {
    return (
      <PageContainer>
        <Alert severity="info">
          You can only see your own attendance in this detail. Ask an administrator if you need
          somebody else&apos;s.
        </Alert>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={employee?.full_name ?? "Attendance"}
        subtitle="Every punch, and the hours they actually add up to"
        icon={<BadgeIcon />}
        actions={
          <Stack direction="row" spacing={1}>
            {/* Only on your own record. Reporting somebody else's attendance
                as wrong is not a dispute, it is an HR correction — which has
                its own route through the log's edit history. */}
            {isSelf ? (
              <Button variant="contained" startIcon={<ReportIcon />} onClick={() => setReporting(true)}>
                Report a problem
              </Button>
            ) : null}
            <Button component={Link} href="/attendance" startIcon={<ArrowBackIcon />}>
              All attendance
            </Button>
          </Stack>
        }
      />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <PersonAvatar
              name={employee?.full_name ?? "?"}
              photo={employee?.photo}
              size={44}
              variant="outlined"
            />
            <Box>
              <Typography variant="caption" color="text.secondary">
                Hours worked
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {duration(totals.worked)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Punches
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {totals.punches}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Days with a break
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {totals.split}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {isLoading ? (
        <Stack spacing={1}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={64} />
          ))}
        </Stack>
      ) : logs.length === 0 ? (
        <Alert severity="info">No attendance recorded for this person yet.</Alert>
      ) : (
        <Stack spacing={1}>
          {logs.map((log) => (
            <Card key={log.id} variant="outlined">
              <CardContent sx={{ py: 1.5 }}>
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={2}
                  sx={{ alignItems: { md: "center" } }}
                >
                  <Box sx={{ minWidth: 150 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      <DateText value={log.date} format="short" />
                    </Typography>
                    <Chip
                      size="small"
                      label={log.status.replace("_", " ")}
                      color={STATUS_TONE[log.status] ?? "default"}
                      sx={{ textTransform: "capitalize", mt: 0.5 }}
                    />
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <DayStrip log={log} />
                    <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: "wrap" }}>
                      {(log.sessions?.length ?? 0) === 0 ? (
                        <Typography variant="caption" color="text.disabled">
                          No punches
                        </Typography>
                      ) : (
                        (log.sessions ?? []).map((session) => (
                          <Typography
                            key={session.id}
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {clock(session.check_in_time)}–
                            {session.check_out_time ? clock(session.check_out_time) : "…"}
                          </Typography>
                        ))
                      )}
                    </Stack>
                  </Box>

                  <Box sx={{ textAlign: { md: "right" }, minWidth: 96 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {duration(log.seconds_worked)}
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      {log.sessions?.length ?? 0} punch{(log.sessions?.length ?? 0) === 1 ? "" : "es"}
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* The disputes for this person, and — for an approver — the decision.
          The model, the workflow and the endpoints have existed since
          regularisation landed; nothing in the product reached them, so an
          employee whose badge failed still had to ask somebody in person. */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
          Reported problems
        </Typography>
        <RegularisationQueue canDecide={canManage} employee={employeeId} />
      </Box>

      <RegularisationDialog open={reporting} onClose={() => setReporting(false)} />

      {data && data.count > logs.length ? (
        <Stack direction="row" spacing={1} sx={{ mt: 2, justifyContent: "center" }}>
          <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <Button disabled={page * 31 >= data.count} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </Stack>
      ) : null}
    </PageContainer>
  );
}
