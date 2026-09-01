"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import { usePersonAttendanceSummary } from "@/hooks/useAttendance";
import { useMyLeaveBalances } from "@/hooks/useLeave";
import { useProjectMetrics } from "@/hooks/useProjects";
import { useEnrollments } from "@/hooks/useTraining";

/**
 * Where somebody stands right now, in four numbers.
 *
 * **The Overview tab was four cards of facts that never change** — contact
 * details, skills, past employers, which team. All true, none of it answering
 * the question an overview is *for*: how is this person doing at the moment.
 * Every other tab had to be opened one at a time to find out.
 *
 * **Stat tiles, not charts.** Each of these is a single headline value, and a
 * single value has no shape to plot — a four-slice donut of unrelated measures
 * is decoration. The numbers wear ink tokens, not colour: nothing here is a
 * series, so nothing here earns a hue. The one exception is where a value is
 * genuinely a *state* worth flagging, and that arrives with words attached
 * rather than as colour alone.
 *
 * Everything is read from endpoints the other tabs already use, so this costs
 * no new server work and cannot disagree with the tab it summarises.
 */

function Tile({
  value,
  label,
  hint,
  tone = "normal",
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  /** `alarm` only where the value is a state somebody should act on. */
  tone?: "normal" | "alarm";
}) {
  return (
    <Box sx={{ flex: "1 1 0", minWidth: 120 }}>
      <Typography
        component="div"
        sx={{
          fontSize: "1.6rem",
          fontWeight: 800,
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
          color: tone === "alarm" ? "error.main" : "text.primary",
        }}
      >
        {value}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, display: "block" }}>
        {label}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

export default function AtAGlance({
  employeeId,
  mine = false,
}: {
  employeeId: number | null;
  mine?: boolean;
}) {
  const { data: attendance } = usePersonAttendanceSummary(employeeId, 30);
  const { data: balancePage } = useMyLeaveBalances(employeeId ?? undefined);
  // Paginated, not an array — `.length` on the envelope is `undefined`, which
  // is falsy, so the tile would simply never appear rather than error.
  const balances = balancePage?.results ?? [];
  const { data: projects } = useProjectMetrics(employeeId);
  const { data: enrollments } = useEnrollments(employeeId ? { employee: employeeId } : {});

  if (!employeeId) return null;

  const leaveLeft = balances.reduce((sum, b) => sum + Number(b.remaining_days || 0), 0);
  const training = (enrollments ?? []).filter(
    (e) => e.status !== "cancelled" && e.status !== "declined",
  );
  const completed = training.filter((e) => e.status === "completed").length;

  // Nothing to show is better than four dashes. A card of empty tiles reads as
  // broken; its absence reads as "this person is new", which is the truth.
  const hasAnything =
    (attendance?.recorded ?? 0) > 0 ||
    balances.length > 0 ||
    training.length > 0 ||
    (projects?.tasks?.open ?? 0) > 0;
  if (!hasAnything) return null;

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {mine ? "Where I stand" : "Where they stand"}
        </Typography>
        <Stack
          direction="row"
          spacing={2}
          sx={{ mt: 1.5, flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}
        >
          {attendance && attendance.punctuality != null ? (
            <Tile
              value={`${attendance.punctuality}%`}
              label="On time"
              hint={`last ${attendance.days} days`}
            />
          ) : null}

          {balances.length > 0 ? (
            <Tile
              value={leaveLeft % 1 === 0 ? leaveLeft : leaveLeft.toFixed(1)}
              label="Leave days left"
              hint={leaveLeft <= 0 ? "nothing remaining" : "across all types"}
              tone={leaveLeft <= 0 ? "alarm" : "normal"}
            />
          ) : null}

          {projects?.tasks ? (
            <Tile
              value={projects.tasks.open}
              label="Open tasks"
              hint={
                projects.tasks.overdue_open > 0
                  ? `${projects.tasks.overdue_open} past their date`
                  : "none overdue"
              }
              tone={projects.tasks.overdue_open > 0 ? "alarm" : "normal"}
            />
          ) : null}

          {training.length > 0 ? (
            <Tile
              value={`${completed}/${training.length}`}
              label="Training done"
              hint={completed === training.length ? "all finished" : "still enrolled"}
            />
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
