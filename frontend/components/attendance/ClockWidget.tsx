"use client";

import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import HistoryIcon from "@mui/icons-material/History";
import ReportIcon from "@mui/icons-material/ReportProblemOutlined";
import Card from "@mui/material/Card";
import Link from "next/link";

import LiveTrace from "@/components/attendance/LiveTrace";
import RegularisationDialog from "@/components/attendance/RegularisationDialog";
import { useMe } from "@/hooks/useMe";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState, useSyncExternalStore } from "react";

import { useCheckIn, useCheckOut, useMyTodayAttendance } from "@/hooks/useAttendance";
import type { AttendanceSession } from "@/hooks/useAttendance";

/**
 * Today's clock: one button, a live total, and the day laid out as a bar.
 *
 * **Sessions, not one check-in and one check-out.** A single pair of times
 * cannot answer either question people open this for — *how long have I been
 * here today* and *what happened to my morning* — and a day with a lunch break
 * cannot be drawn from it at all.
 *
 * **The pulse.** The bar is the working day from first punch to now, with the
 * stretches worked filled in and the gaps left open. It is a sparkline for one
 * person's day: you read where the breaks were without reading any numbers.
 */

/** Ticks once a second, only while somebody is actually clocked in.
 *
 * `useSyncExternalStore` rather than setState-in-an-effect: the effect form
 * schedules a second render on mount and trips `react-hooks/set-state-in-effect`.
 * Same pattern as `PageHeader` and the theme customiser. */
function subscribeToSeconds(callback: () => void) {
  const id = window.setInterval(callback, 1000);
  return () => window.clearInterval(id);
}
function getNow() {
  return Math.floor(Date.now() / 1000);
}
function getServerNow() {
  return 0;
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The day as a bar: worked stretches filled, breaks left open.
 *
 * Scaled from the first punch to now rather than to a fixed 9-to-5, because a
 * night shift and an early finish are both ordinary and a fixed axis would
 * squash one and stretch the other.
 */
function DayPulse({ sessions, nowSeconds }: { sessions: AttendanceSession[]; nowSeconds: number }) {
  if (sessions.length === 0) return null;

  const start = new Date(sessions[0].check_in_time).getTime() / 1000;

  // The bar ends where the day ends — the last clock-out — and only runs to
  // *now* while something is still open. Reading the wall clock here instead
  // was both impure during render and wrong: a finished day's bar would keep
  // stretching all evening, shrinking the stretches somebody actually worked.
  const last = sessions[sessions.length - 1];
  const lastEnd = last.check_out_time
    ? new Date(last.check_out_time).getTime() / 1000
    : nowSeconds;
  const end = Math.max(lastEnd, start + 60);
  const span = Math.max(end - start, 1);

  return (
    <Box
      role="img"
      aria-label={`${sessions.length} punch${sessions.length > 1 ? "es" : ""} today`}
      sx={{
        display: "flex",
        height: 10,
        borderRadius: 999,
        overflow: "hidden",
        bgcolor: "action.hover",
        mt: 1.5,
      }}
    >
      {sessions.map((session, index) => {
        const inAt = new Date(session.check_in_time).getTime() / 1000;
        const outAt = session.check_out_time
          ? new Date(session.check_out_time).getTime() / 1000
          : end;

        // The gap before this stretch — a break, drawn as nothing.
        const previousEnd =
          index === 0
            ? inAt
            : new Date(sessions[index - 1].check_out_time ?? sessions[index - 1].check_in_time).getTime() / 1000;
        const gap = Math.max(inAt - previousEnd, 0);
        const worked = Math.max(outAt - inAt, 0);

        return (
          <Box key={session.id} sx={{ display: "contents" }}>
            {gap > 0 && <Box sx={{ flex: `${gap / span} 0 0` }} />}
            <Tooltip
              title={`${formatTime(session.check_in_time)} – ${
                session.check_out_time ? formatTime(session.check_out_time) : "now"
              }${session.note ? ` · ${session.note}` : ""}`}
            >
              <Box
                sx={{
                  flex: `${worked / span} 0 0`,
                  bgcolor: session.is_open ? "success.main" : "primary.main",
                  // The open stretch breathes, so "still running" is visible
                  // without reading the clock.
                  animation: session.is_open ? "clockPulse 2s ease-in-out infinite" : "none",
                  "@keyframes clockPulse": {
                    "0%, 100%": { opacity: 1 },
                    "50%": { opacity: 0.55 },
                  },
                }}
              />
            </Tooltip>
          </Box>
        );
      })}
    </Box>
  );
}

export default function ClockWidget() {
  const { data: today, isLoading } = useMyTodayAttendance();
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const [error, setError] = useState<string | null>(null);

  // Only subscribe while something is running — an idle card should not
  // re-render once a second for no reason.
  const clockedIn = Boolean(today?.is_clocked_in);
  const [reporting, setReporting] = useState(false);
  const { data: me } = useMe();
  const employeeId = me?.employee_id ?? null;
  const nowSeconds = useSyncExternalStore(
    clockedIn ? subscribeToSeconds : () => () => {},
    clockedIn ? getNow : getServerNow,
    getServerNow
  );

  if (isLoading) return <Skeleton variant="rounded" height={132} />;
  // No employee record behind this account, so there is no clock to punch.
  // Drawing a check-in button here would only offer a refusal.
  if (today === null) return null;

  const sessions = today?.sessions ?? [];
  const openFor =
    today?.open_since && nowSeconds > 0
      ? Math.max(nowSeconds - new Date(today.open_since).getTime() / 1000, 0)
      : 0;
  const totalSeconds = (today?.seconds_worked ?? 0) + openFor;

  async function punch(direction: "in" | "out") {
    setError(null);
    try {
      await (direction === "in" ? checkIn.mutateAsync() : checkOut.mutateAsync());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const busy = checkIn.isPending || checkOut.isPending;

  return (
    <Card>
      <CardContent>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
              <Typography variant="overline" color="text.secondary">
                {clockedIn ? "Clocked in" : sessions.length > 0 ? "Clocked out" : "Not started"}
                {today?.status ? ` · ${today.status.replace("_", " ")}` : ""}
              </Typography>
              {/* Only while the clock is actually running. A trace that draws
                  when somebody has clocked out would be saying the opposite of
                  the word next to it. */}
              {clockedIn ? (
                <Box sx={{ color: "success.main", lineHeight: 0 }}>
                  <LiveTrace width={168} height={26} period={2.8} />
                </Box>
              ) : null}
            </Stack>
            {/* The number people open this for. Tabular figures so the last
                digit does not shift the whole line every second. */}
            <Typography
              variant="h4"
              sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}
            >
              {formatDuration(totalSeconds)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {sessions.length === 0
                ? "No punches yet today"
                : `${sessions.length} punch${sessions.length > 1 ? "es" : ""} · since ${formatTime(
                    sessions[0].check_in_time
                  )}`}
            </Typography>
          </Box>

          <Button
            variant="contained"
            color={clockedIn ? "warning" : "primary"}
            size="large"
            disabled={busy}
            startIcon={clockedIn ? <LogoutIcon /> : <LoginIcon />}
            onClick={() => punch(clockedIn ? "out" : "in")}
            sx={{ minWidth: 148, flexShrink: 0 }}
          >
            {busy ? "…" : clockedIn ? "Clock out" : "Clock in"}
          </Button>
        </Stack>

        <DayPulse sessions={sessions} nowSeconds={nowSeconds} />

        {sessions.length > 0 && (
          <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: "wrap" }} useFlexGap>
            {sessions.map((session) => (
              <Chip
                key={session.id}
                size="small"
                variant={session.is_open ? "filled" : "outlined"}
                color={session.is_open ? "success" : "default"}
                label={`${formatTime(session.check_in_time)} – ${
                  session.check_out_time ? formatTime(session.check_out_time) : "now"
                }`}
              />
            ))}
          </Stack>
        )}

        {/* The two doors this widget was missing.
            "Report a problem" and the full record both existed only on
            `/attendance/[id]`, which was reachable from a small punch count in
            the attendance list — so an employee whose badge failed had to find
            their own row in a table of a hundred to say so. This widget is on
            the portal, the dashboard and the attendance page, which is
            everywhere they already are. */}
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap" }} useFlexGap>
          <Button
            size="small"
            startIcon={<ReportIcon fontSize="small" />}
            onClick={() => setReporting(true)}
          >
            Report a problem
          </Button>
          {employeeId ? (
            <Button
              size="small"
              component={Link}
              href={`/attendance/${employeeId}`}
              startIcon={<HistoryIcon fontSize="small" />}
            >
              My attendance
            </Button>
          ) : null}
        </Stack>

        <RegularisationDialog open={reporting} onClose={() => setReporting(false)} />

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
