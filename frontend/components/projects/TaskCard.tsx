"use client";

/**
 * One task, as it appears on a board.
 *
 * Four things and no more: title, who has it, when it is due, and whether
 * anybody has said anything. A card carrying the description too becomes a
 * paragraph, and a column of paragraphs cannot be scanned — which is the only
 * thing a board is for. Everything else is a click away in the drawer.
 */

import BlockIcon from "@mui/icons-material/Block";
import ChatBubbleIcon from "@mui/icons-material/ChatBubble";
import ChecklistIcon from "@mui/icons-material/Checklist";
import EventIcon from "@mui/icons-material/Event";
import ScheduleIcon from "@mui/icons-material/Schedule";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import DateText from "@/components/common/DateText";
import PersonAvatar from "@/components/common/PersonAvatar";
import { TASK_PRIORITY_META } from "@/lib/projects/taskStatus";
import type { ProjectTask } from "@/types/projects";
import { todayIso } from "@/lib/format/period";

/** Is this due in the past, and not yet finished? */
function isOverdue(task: ProjectTask) {
  if (!task.due_date || task.status === "done") return false;
  // Compared as dates, not timestamps — a task due today is not late at 09:00.
  // `todayIso` is the reader's calendar day; a UTC one marks it overdue from
  // midnight until the offset catches up.
  return task.due_date < todayIso();
}

export default function TaskCard({
  task,
  onOpen,
}: {
  task: ProjectTask;
  onOpen: (task: ProjectTask) => void;
}) {
  const overdue = isOverdue(task);
  const priority = TASK_PRIORITY_META[task.priority];

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      {/* 🔒 **Not `CardActionArea`.** It is a `ButtonBase`, and a `ButtonBase`
          inside a `Draggable` swallows the mousedown that starts a drag — so
          this card opened on click and could not be moved at all. That is why
          the recruitment and task boards were not draggable while the deals and
          tickets boards, which never used one, always were.

          A plain clickable box keeps the click and leaves the pointer sequence
          alone. `role` and `tabIndex` keep it reachable from the keyboard,
          which is the only thing `CardActionArea` was really buying here. */}
      <Box
        role="button"
        tabIndex={0}
        onClick={() => onOpen(task)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(task);
          }
        }}
        sx={{
          p: 1.5,
          cursor: "pointer",
          borderRadius: 2,
          outline: "none",
          "&:focus-visible": { boxShadow: (t) => `0 0 0 2px ${t.vars.palette.primary.main}` },
        }}
      >
        <Stack spacing={1}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35 }}>
            {task.title}
          </Typography>

          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
            {/* Only when it is worth saying. A "Normal" chip on every card is
                noise that makes the urgent ones harder to find. */}
            {priority.role !== "default" ? (
              <Chip
                size="small"
                variant="outlined"
                color={priority.role}
                label={priority.label}
              />
            ) : null}

            {task.due_date ? (
              <Stack
                direction="row"
                spacing={0.25}
                sx={{
                  alignItems: "center",
                  color: overdue ? "error.main" : "text.secondary",
                }}
              >
                <EventIcon sx={{ fontSize: 13 }} />
                <Typography variant="caption" sx={{ fontWeight: overdue ? 700 : 400 }}>
                  <DateText value={task.due_date} />
                </Typography>
              </Stack>
            ) : null}

            {/* **The blocker is named on the card, not just flagged.** Somebody
                scanning a column wants to know whether to pick this up, and
                "blocked" alone sends them into the drawer to find out what by. */}
            {task.is_blocked ? (
              <Tooltip
                title={`Waiting on ${task.blockers.map((b) => b.title).join(", ")}`}
              >
                <Stack
                  direction="row"
                  spacing={0.25}
                  sx={{ alignItems: "center", color: "warning.main", minWidth: 0 }}
                >
                  <BlockIcon sx={{ fontSize: 13 }} />
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ fontWeight: 600, maxWidth: 130 }}
                  >
                    {task.blockers.length === 1
                      ? task.blockers[0].title
                      : `${task.blockers.length} blockers`}
                  </Typography>
                </Stack>
              </Tooltip>
            ) : null}

            {task.comment_count > 0 ? (
              <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", color: "text.secondary" }}>
                <ChatBubbleIcon sx={{ fontSize: 13 }} />
                <Typography variant="caption">{task.comment_count}</Typography>
              </Stack>
            ) : null}

            {/* **The card carries the parent's progress, not its steps.** The
                board excludes sub-tasks on purpose — a column showing every
                step says twelve where a person sees three pieces of work — so
                "2/5" is the only way the breakdown is visible while scanning. */}
            {task.subtask_total > 0 ? (
              <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", color: "text.secondary" }}>
                <ChecklistIcon sx={{ fontSize: 13 }} />
                <Typography variant="caption">
                  {task.subtask_done}/{task.subtask_total}
                </Typography>
              </Stack>
            ) : null}

            {task.estimate_hours ? (
              <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", color: "text.secondary" }}>
                <ScheduleIcon sx={{ fontSize: 13 }} />
                <Typography variant="caption">{Number(task.estimate_hours)}h</Typography>
              </Stack>
            ) : null}

            <Box sx={{ flex: 1 }} />

            {task.assignee_name ? (
              <PersonAvatar name={task.assignee_name} size={22} />
            ) : (
              <Typography variant="caption" color="text.disabled">
                Unassigned
              </Typography>
            )}
          </Stack>
        </Stack>
      </Box>
    </Card>
  );
}
