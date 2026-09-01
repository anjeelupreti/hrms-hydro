"use client";

/**
 * One person's project work: the figures, then what is actually in front of them.
 *
 * **The figures carry no verdict, and this renders them that way.** No colour
 * that says "bad", no target line, no badge. A completion rate is shown beside
 * the counts it came from, because 4 of 6 and 400 of 600 are the same
 * percentage and not the same fact. HR and the owner read these and form their
 * own view — the system's job is to present, not to judge.
 *
 * **A rate over nothing renders as a dash, not 0%.** Somebody with no tasks has
 * no completion rate; showing 0% next to a new joiner reads as a failure that
 * has not happened. The API sends `null` for exactly this, and collapsing that
 * to a number here would throw away the distinction it went to the trouble of
 * making.
 */

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import DateText from "@/components/common/DateText";
import { useProjectMetrics } from "@/hooks/useProjects";
import { TASK_STATUS_META, isTaskDone, taskStatusColor } from "@/lib/projects/taskStatus";

/** A figure, its denominator, and what it is counting. Never a judgement. */
function Figure({
  label,
  value,
  detail,
  hint,
}: {
  label: string;
  value: string;
  detail?: string;
  hint: string;
}) {
  return (
    <Tooltip title={hint}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" noWrap>
          {label}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          {value}
        </Typography>
        {detail ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            {detail}
          </Typography>
        ) : null}
      </Box>
    </Tooltip>
  );
}

const rate = (value: number | null) => (value === null ? "—" : `${value}%`);

export default function ProjectMetricsPanel({
  employeeId,
}: {
  /** Omit or pass null for the signed-in user's own figures. */
  employeeId?: number | null;
}) {
  const { data, isLoading, error } = useProjectMetrics(employeeId ?? undefined);

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LinearProgress />
        </CardContent>
      </Card>
    );
  }

  // A 403 here means the viewer may not read this person's figures. Said
  // plainly rather than rendered as zeroes, which would read as "this person
  // has done nothing".
  if (error) {
    return (
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            These figures are not yours to see.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const tasks = data?.tasks ?? null;
  const projects = data?.projects ?? null;
  const openTasks = data?.open_tasks ?? [];
  const activeProjects = data?.active_projects ?? [];

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Typography variant="overline" color="text.secondary">
            Project work
          </Typography>
          {tasks === null || tasks.total === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              No tasks recorded yet — there is nothing to count.
            </Typography>
          ) : (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Figure
                  label="Tasks"
                  value={String(tasks.total)}
                  detail={`${tasks.open} still open`}
                  hint="Every task assigned to this person."
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Figure
                  label="Completed"
                  value={rate(tasks.completion_rate)}
                  detail={`${tasks.done} of ${tasks.total}`}
                  hint="Tasks marked done, over tasks assigned. It says nothing about their size."
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Figure
                  label="On time"
                  value={rate(tasks.on_time_rate)}
                  detail={
                    tasks.with_due_date === 0
                      ? "none had a due date"
                      : `${tasks.on_time} of ${tasks.with_due_date} dated`
                  }
                  hint="Counted only where a due date was set — undated work is neither on time nor late."
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Figure
                  label="Typical turnaround"
                  value={
                    tasks.median_days_to_complete === null
                      ? "—"
                      : `${tasks.median_days_to_complete}d`
                  }
                  detail="median"
                  hint="Median days from a task being created to being marked done. How long the request was outstanding — not how long the work took."
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Figure
                  label="Overdue now"
                  value={String(tasks.overdue_open)}
                  detail="open, past due"
                  hint="Open tasks whose due date has passed. Unlike the on-time figure, this is about work still outstanding."
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Figure
                  label="Projects"
                  value={String(projects?.contributing ?? 0)}
                  detail={`${projects?.owned ?? 0} owned`}
                  hint="Projects this person has tasks on, and how many they run."
                />
              </Grid>
            </Grid>
          )}
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Active projects
              </Typography>
              {activeProjects.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Nothing in progress.
                </Typography>
              ) : (
                <Stack spacing={1.5} sx={{ mt: 1 }} divider={<Divider flexItem />}>
                  {activeProjects.map((project) => {
                    const pct = project.task_count
                      ? Math.round((project.done_count / project.task_count) * 100)
                      : 0;
                    return (
                      <Box key={project.id}>
                        <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
                          <Typography
                            component={Link}
                            href={`/projects/${project.id}`}
                            variant="body2"
                            sx={{ fontWeight: 600, color: "inherit", textDecoration: "none" }}
                            noWrap
                          >
                            {project.name}
                          </Typography>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={project.status.replace("_", " ")}
                          />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {project.client_name ?? "Internal"} · {project.done_count} of{" "}
                          {project.task_count} done
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={pct}
                          sx={{ mt: 0.5, height: 6, borderRadius: 3 }}
                        />
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Open tasks
              </Typography>
              {openTasks.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Nothing outstanding.
                </Typography>
              ) : (
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {/* Soonest deadline first, undated last — the server orders
                      this, so the two cannot disagree about what is urgent. */}
                  {openTasks.map((task) => (
                    <Stack key={task.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Tooltip title={TASK_STATUS_META[task.status].label}>
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            flexShrink: 0,
                            bgcolor: taskStatusColor(task.status),
                          }}
                        />
                      </Tooltip>
                      <Typography
                        component={Link}
                        href={`/projects/${task.project}`}
                        variant="body2"
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          color: isTaskDone(task.status) ? "text.secondary" : "text.primary",
                          textDecoration: "none",
                        }}
                        noWrap
                      >
                        {task.title}
                      </Typography>
                      {task.due_date ? (
                        <Typography variant="caption" color="text.secondary">
                          <DateText value={task.due_date} />
                        </Typography>
                      ) : null}
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}
