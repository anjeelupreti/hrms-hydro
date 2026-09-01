"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import EmptyState from "@/components/common/EmptyState";
import type { ProjectTask, TaskStatus } from "@/types/projects";

/**
 * When each piece of work sits, drawn along one shared scale.
 *
 * The board answers *where is everything* and the list answers *what is mine*.
 * Neither answers **when** — whether two things overlap, whether the run of
 * work reaches the date somebody promised, whether the thing blocking three
 * others is early or late. That is the question this is for, and the reason a
 * Gantt is the one chart a project screen genuinely needs.
 *
 * **Tasks with no dates are named, not drawn.** A bar has to start and end
 * somewhere; defaulting a dateless task to today would put a confident rectangle
 * on the chart describing something nobody stated. They are counted underneath
 * instead, because "nine of your tasks have no dates" is itself the finding —
 * it is why the timeline looks emptier than the board.
 *
 * **Colour says state, not identity.** Every bar is the system accent except
 * the two that need attention: blocked, and overdue-and-not-done. Reserving hue
 * for those is what makes them findable in a chart of forty rows — colouring by
 * assignee or by priority would spend the channel on something the label
 * already carries.
 *
 * **Today is a line, not a marker.** It is the thing every bar is read against,
 * so it runs the full height rather than sitting in a legend.
 *
 * Plain CSS grid. A run of proportional bars needs no axes and no rendering
 * pipeline, and a chart library here would theme itself rather than following
 * the company's accent.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Bars thinner than this vanish; a one-day task still has to be clickable. */
const MIN_BAR_PERCENT = 1.5;

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function parse(value: string | null) {
  if (!value) return null;
  const time = startOfDay(new Date(value));
  return Number.isNaN(time) ? null : time;
}

type Placed = {
  task: ProjectTask;
  from: number;
  to: number;
  overdue: boolean;
};

const ATTENTION: Partial<Record<TaskStatus, true>> = { blocked: true };

export default function TaskTimeline({
  tasks,
  onOpen,
}: {
  tasks: ProjectTask[];
  onOpen?: (task: ProjectTask) => void;
}) {
  const today = startOfDay(new Date());

  const placed: Placed[] = [];
  let undated = 0;

  for (const task of tasks) {
    const start = parse(task.start_date);
    const due = parse(task.due_date);
    if (start === null && due === null) {
      undated += 1;
      continue;
    }
    // One date is enough to place something: a task with only a deadline is a
    // point on that day, which is more honest than refusing to show it.
    const from = start ?? (due as number);
    const to = Math.max(due ?? (start as number), from);
    placed.push({
      task,
      from,
      to,
      overdue: task.status !== "done" && to < today,
    });
  }

  if (placed.length === 0) {
    return (
      <EmptyState
        title="Nothing has dates yet"
        description={
          undated > 0
            ? `All ${undated} task${undated === 1 ? "" : "s"} are missing a start and a due date, so there is nothing to place on a calendar. Add dates on a task and it appears here.`
            : "Add tasks with start and due dates and they appear here, side by side on one scale."
        }
        compact
      />
    );
  }

  placed.sort((a, b) => a.from - b.from || a.to - b.to);

  // The window, padded so the first and last bars are not flush against the
  // edges — and always wide enough to include today, or the line marking it
  // would sit off-chart.
  const earliest = Math.min(today, ...placed.map((p) => p.from));
  const latest = Math.max(today, ...placed.map((p) => p.to));
  const pad = Math.max(2 * DAY, (latest - earliest) * 0.04);
  const left = earliest - pad;
  const span = Math.max(latest + pad - left, DAY);

  const percent = (time: number) => ((time - left) / span) * 100;

  // Month ticks across the top. Weeks would crowd on anything over a quarter,
  // and months are the unit a plan is discussed in.
  const ticks: { at: number; label: string }[] = [];
  const cursor = new Date(left);
  cursor.setDate(1);
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short" });
  while (cursor.getTime() < left + span) {
    const at = cursor.getTime();
    if (at > left) ticks.push({ at, label: formatter.format(cursor) });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return (
    <Box>
      <Box sx={{ position: "relative" }}>
        {/* The month scale, above the rows it labels. */}
        <Box sx={{ position: "relative", height: 18, ml: "13rem", mb: 0.5 }}>
          {ticks.map((tick) => (
            <Typography
              key={tick.at}
              variant="caption"
              sx={{
                position: "absolute",
                left: `${percent(tick.at)}%`,
                color: "text.disabled",
                fontSize: 10,
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
              }}
            >
              {tick.label}
            </Typography>
          ))}
        </Box>

        <Box sx={{ position: "relative" }}>
          {/* Month gridlines and today, behind the bars. */}
          <Box
            aria-hidden
            sx={{ position: "absolute", inset: 0, ml: "13rem", pointerEvents: "none" }}
          >
            {ticks.map((tick) => (
              <Box
                key={tick.at}
                sx={{
                  position: "absolute",
                  left: `${percent(tick.at)}%`,
                  top: 0,
                  bottom: 0,
                  borderLeft: "1px dashed",
                  borderColor: "divider",
                }}
              />
            ))}
            <Box
              sx={{
                position: "absolute",
                left: `${percent(today)}%`,
                top: 0,
                bottom: 0,
                borderLeft: "2px solid",
                borderColor: "error.main",
                opacity: 0.55,
              }}
            />
          </Box>

          {placed.map(({ task, from, to, overdue }) => {
            const width = Math.max(percent(to + DAY) - percent(from), MIN_BAR_PERCENT);
            const attention = overdue || ATTENTION[task.status];
            return (
              <Box
                key={task.id}
                sx={{ display: "flex", alignItems: "center", height: 30, position: "relative" }}
              >
                <Typography
                  variant="body2"
                  noWrap
                  title={task.title}
                  sx={{
                    width: "13rem",
                    pr: 1.5,
                    flexShrink: 0,
                    color: task.status === "done" ? "text.disabled" : "text.secondary",
                    textDecoration: task.status === "done" ? "line-through" : undefined,
                  }}
                >
                  {task.title}
                </Typography>

                <Box sx={{ position: "relative", flex: 1, height: "100%" }}>
                  <Tooltip
                    arrow
                    title={
                      `${task.title} · ${task.start_date ?? "no start"} → ${task.due_date ?? "no due date"}` +
                      (task.assignee_name ? ` · ${task.assignee_name}` : "") +
                      (overdue ? " · overdue" : "")
                    }
                  >
                    <Box
                      component={onOpen ? "button" : "div"}
                      type={onOpen ? "button" : undefined}
                      onClick={onOpen ? () => onOpen(task) : undefined}
                      sx={{
                        all: onOpen ? "unset" : undefined,
                        position: "absolute",
                        left: `${percent(from)}%`,
                        width: `${width}%`,
                        top: "50%",
                        transform: "translateY(-50%)",
                        height: 16,
                        borderRadius: "4px",
                        cursor: onOpen ? "pointer" : "default",
                        boxSizing: "border-box",
                        // Done work recedes; it is context for what is left.
                        opacity: task.status === "done" ? 0.4 : 1,
                        backgroundColor: attention
                          ? "var(--mui-palette-error-main)"
                          : "var(--mui-palette-primary-main)",
                        "&:focus-visible": {
                          outline: "2px solid",
                          outlineColor: "primary.main",
                          outlineOffset: 2,
                        },
                      }}
                    />
                  </Tooltip>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box
        sx={{
          display: "flex",
          gap: 2,
          alignItems: "center",
          flexWrap: "wrap",
          mt: 2,
          pt: 1.5,
          borderTop: "1px solid",
          borderColor: "divider",
        }}
      >
        <LegendKey colour="var(--mui-palette-primary-main)" label="On the plan" />
        <LegendKey colour="var(--mui-palette-error-main)" label="Blocked or overdue" />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box sx={{ width: 2, height: 12, bgcolor: "error.main", opacity: 0.55 }} />
          <Typography variant="caption" sx={{ color: "text.disabled" }}>
            Today
          </Typography>
        </Box>
        {undated > 0 && (
          // Stated rather than hidden: this is why the timeline is shorter than
          // the board, and somebody should be able to see that at a glance.
          <Typography variant="caption" sx={{ color: "text.disabled", ml: "auto" }}>
            {undated} task{undated === 1 ? "" : "s"} with no dates, not shown
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function LegendKey({ colour, label }: { colour: string; label: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
      <Box sx={{ width: 14, height: 10, borderRadius: "3px", backgroundColor: colour }} />
      <Typography variant="caption" sx={{ color: "text.disabled" }}>
        {label}
      </Typography>
    </Box>
  );
}
