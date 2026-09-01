"use client";

/**
 * "When was I actually in?" — an employee's own punches, day by day.
 *
 * **Days with no record are absent, not blank rows.** A day nobody clocked in
 * on is a weekend, a holiday or an absence, and which of those it is belongs to
 * the calendar and the absence sweep. Listing every date would put "no punches"
 * against every Saturday and bury the day somebody actually forgot to clock
 * out — which is the one row worth finding here.
 *
 * **Each day shows its punches, not just a total.** A day is a run of
 * sessions, and a lunch break is only visible in them — a total for the day
 * hides the shape it is made of.
 */

import AccessTimeIcon from "@mui/icons-material/AccessTime";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import { useMyPunchHistory, type DaySummary } from "@/hooks/useAttendance";

/** Seconds as "7h 20m" — never "7.33h", which nobody reads as a working day. */
function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  present: "success",
  late: "warning",
  half_day: "warning",
  absent: "error",
  on_leave: "default",
  holiday: "default",
  weekend: "default",
};

function DayRow({ day }: { day: DaySummary }) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        py: 1.25,
        alignItems: "flex-start",
        borderTop: "1px solid",
        borderColor: "divider",
      }}
    >
      <Box sx={{ minWidth: 96 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          <DateText value={day.date} />
        </Typography>
        {day.status ? (
          <Chip
            size="small"
            variant="outlined"
            color={STATUS_COLOR[day.status] ?? "default"}
            label={day.status.replace("_", " ")}
            sx={{ height: 18, fontSize: 10, mt: 0.25, textTransform: "capitalize" }}
          />
        ) : null}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }} useFlexGap>
          {day.sessions.map((session) => (
            <Tooltip
              key={session.id}
              title={
                session.auto_closed
                  ? "Nobody clocked out — the system closed this at the end of the day. Report a problem if the time is wrong."
                  : ""
              }
              disableHoverListener={!session.auto_closed}
            >
              <Chip
                size="small"
                variant={session.is_open ? "filled" : "outlined"}
                // Amber where the system guessed. A tidy end-of-day time that
                // looks like a real punch is the one thing the sweep must not
                // produce, so the guess is marked wherever it is shown.
                color={
                  session.is_open ? "primary" : session.auto_closed ? "warning" : "default"
                }
                label={
                  session.check_out_time
                    ? `${clockTime(session.check_in_time)} – ${clockTime(session.check_out_time)}${
                        session.auto_closed ? " ·  auto" : ""
                      }`
                    : `${clockTime(session.check_in_time)} – still in`
                }
              />
            </Tooltip>
          ))}
        </Stack>
      </Box>

      <Box sx={{ textAlign: "right", minWidth: 72 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {duration(day.seconds_worked)}
        </Typography>
        {/* Said plainly rather than left as a smaller-looking total. */}
        {day.is_clocked_in ? (
          <Typography variant="caption" color="primary.main">
            still counting
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}

export default function PunchHistory() {
  const { data, isLoading } = useMyPunchHistory();

  if (isLoading) return <CircularProgress size={22} />;

  const days = data?.days ?? [];

  if (days.length === 0) {
    return (
      <EmptyState
        compact
        title="No punches in the last 30 days"
        description="Days you clocked in appear here, with each stretch you were in for."
      />
    );
  }

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.5 }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          <AccessTimeIcon fontSize="small" color="disabled" />
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Last 30 days
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {duration(data?.seconds_worked ?? 0)} across {data?.days_with_punches ?? 0} days
        </Typography>
      </Stack>

      {/* Capped and scrolled. Unbounded, a month of real attendance runs to
          about 800px and leaves the column beside it empty for most of that —
          the list grows to whatever the data is and drags the page with it.

          The cap matters because the pairing with the month grid is the point (the
          month says *which days*, this says *what happened on one*), and a
          pairing only works while the two are the same size. */}
      <Box
        sx={{
          maxHeight: 340,
          overflowY: "auto",
          scrollbarWidth: "thin",
          "&::-webkit-scrollbar": { width: 6 },
          "&::-webkit-scrollbar-thumb": { borderRadius: 3, background: "rgba(0,0,0,.18)" },
        }}
      >
        {days.map((day) => (
          <DayRow key={day.date} day={day} />
        ))}
      </Box>
    </Box>
  );
}
