"use client";

/**
 * The steps a task breaks into.
 *
 * **Lives in the drawer, not on the board.** A board showing every step as its
 * own card is unreadable, and the column counts would say twelve where a person
 * sees three pieces of work. So the board shows the parent with a progress
 * figure, and the steps are here — one click from the thing they belong to.
 *
 * **Each step is a real task.** Not a checklist item: it has an assignee, a
 * status and an estimate, because a step of real work is given to somebody and
 * takes time. The alternative — a tick-list — is what `ProjectTask` was before
 * it was promoted, and it could not say who was doing anything.
 *
 * One level deep. The add box does not appear on a step, because a step cannot
 * have steps of its own; the server refuses it and so does this.
 */

import AddIcon from "@mui/icons-material/Add";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import PersonAvatar from "@/components/common/PersonAvatar";
import {
  useCreateProjectTask,
  useSubtasks,
  useUpdateProjectTask,
} from "@/hooks/useProjects";
import { isTaskDone, taskStatusColor } from "@/lib/projects/taskStatus";
import type { ProjectTask } from "@/types/projects";

export default function SubtaskPanel({
  task,
  canEdit,
  onOpen,
  onError,
}: {
  task: ProjectTask;
  canEdit: boolean;
  /** Open a step in its own right — it is a task, so it has a drawer too. */
  onOpen: (id: number) => void;
  onError: (message: string) => void;
}) {
  const { data, isLoading } = useSubtasks(task.id);
  const create = useCreateProjectTask();
  const update = useUpdateProjectTask();
  const [title, setTitle] = useState("");

  const steps = data?.results ?? [];
  const done = steps.filter((s) => isTaskDone(s.status)).length;

  async function add() {
    if (!title.trim()) return;
    onError("");
    try {
      await create.mutateAsync({
        project: task.project,
        parent: task.id,
        title: title.trim(),
      });
      setTitle("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "That step could not be added.");
    }
  }

  /**
   * The tick moves a step between to-do and done and nothing else.
   *
   * A step is still a full task — open it for the five states, an assignee and
   * an estimate. But the common act inside a parent is "that one's finished",
   * and making somebody open a drawer to say so is how a checklist stops being
   * kept up to date.
   */
  async function toggle(step: ProjectTask, checked: boolean) {
    onError("");
    try {
      await update.mutateAsync({
        id: step.id,
        values: { status: checked ? "done" : "todo" },
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  // A step cannot have steps. Rendering an add box that the server would refuse
  // is a worse answer than not offering it.
  const canAdd = canEdit && task.parent === null;

  return (
    <Stack spacing={1.5}>
      {steps.length > 0 ? (
        <Box>
          <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Steps
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {done} of {steps.length} done
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={steps.length ? (done / steps.length) * 100 : 0}
            sx={{ height: 6, borderRadius: 3 }}
          />
        </Box>
      ) : null}

      {!isLoading && steps.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {task.parent === null
            ? "No steps yet. Break this down if it is more than one sitting."
            : "This is itself a step, so it cannot be broken down further."}
        </Typography>
      ) : null}

      <Stack spacing={0.25}>
        {steps.map((step) => (
          <Stack key={step.id} direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Tooltip title={isTaskDone(step.status) ? "Reopen" : "Mark done"}>
              <span>
                <Checkbox
                  size="small"
                  checked={isTaskDone(step.status)}
                  disabled={!canEdit || update.isPending}
                  onChange={(e) => toggle(step, e.target.checked)}
                  sx={{ color: taskStatusColor(step.status) }}
                />
              </span>
            </Tooltip>
            <Typography
              variant="body2"
              onClick={() => onOpen(step.id)}
              sx={{
                flex: 1,
                minWidth: 0,
                cursor: "pointer",
                textDecoration: isTaskDone(step.status) ? "line-through" : "none",
                color: isTaskDone(step.status) ? "text.secondary" : "text.primary",
                "&:hover": { textDecoration: "underline" },
              }}
              noWrap
            >
              {step.title}
            </Typography>
            {step.estimate_hours ? (
              <Typography variant="caption" color="text.secondary">
                {step.estimate_hours}h
              </Typography>
            ) : null}
            {step.assignee_name ? (
              <PersonAvatar name={step.assignee_name} size={20} variant="outlined" />
            ) : null}
          </Stack>
        ))}
      </Stack>

      {canAdd ? (
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            fullWidth
            placeholder="Add a step…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={add}
            disabled={!title.trim() || create.isPending}
          >
            Add
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}
