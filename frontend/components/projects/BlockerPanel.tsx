"use client";

/**
 * What has to happen before this task can start.
 *
 * The dependency is recorded as an edge, not as a `BLOCKED` flag somebody sets
 * by hand. A flag says a task is stuck; only the edge answers the question that
 * follows it — blocked by what, and is that done yet?
 *
 * A finished blocker stops blocking but stays listed, struck through. Dropping
 * the link on completion would leave a task looking as though it never had a
 * dependency.
 *
 * The reverse edge shows too — "am I holding anybody up" is the question people
 * ask about their own work. That is why this is a one-way relationship rather
 * than a symmetrical "related to".
 */

import AddIcon from "@mui/icons-material/Add";
import BlockIcon from "@mui/icons-material/Block";
import CloseIcon from "@mui/icons-material/Close";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { useProjectTasks, useUpdateProjectTask } from "@/hooks/useProjects";
import { isTaskDone } from "@/lib/projects/taskStatus";
import type { ProjectTask } from "@/types/projects";

export default function BlockerPanel({
  task,
  canEdit,
  onOpen,
  onError,
}: {
  task: ProjectTask;
  canEdit: boolean;
  /** A blocker is a task in its own right, so it has a drawer too. */
  onOpen: (id: number) => void;
  onError: (message: string) => void;
}) {
  const update = useUpdateProjectTask();
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState<ProjectTask | null>(null);

  // Only fetched once somebody opens the picker. A drawer that loads every task
  // in the project on open pays for a search nobody asked for.
  const { data: candidates } = useProjectTasks({ project: adding ? task.project : null });

  // Everything linked, done or not. `blockers` carries only the ones still
  // holding, and a finished dependency should still read as one.
  const linked = task.blocked_by ?? [];
  const outstanding = task.blockers ?? [];
  const outstandingIds = new Set(outstanding.map((b) => b.id));

  async function setBlockers(ids: number[]) {
    try {
      await update.mutateAsync({ id: task.id, values: { blocked_by: ids } });
    } catch (err) {
      // The server refuses self-links, cycles and cross-project edges, and its
      // message names which. Surfacing it verbatim beats a house explanation
      // that would drift from the rule it describes.
      onError(err instanceof Error ? err.message : "That dependency could not be saved.");
    }
  }

  // Not itself, not something already linked, and nothing that already waits on
  // this task. The server refuses the cycle regardless, but offering a choice
  // and then rejecting the click is a worse way to say no.
  const options = (candidates?.results ?? []).filter(
    (t) => t.id !== task.id && !linked.includes(t.id) && !(t.blocked_by ?? []).includes(task.id),
  );

  // Nothing recorded in either direction: one quiet button rather than a
  // heading over an empty list.
  if (linked.length === 0 && task.blocking_count === 0 && !adding) {
    return canEdit ? (
      <Button
        size="small"
        startIcon={<AddIcon />}
        onClick={() => setAdding(true)}
        sx={{ alignSelf: "flex-start" }}
      >
        Add a dependency
      </Button>
    ) : null;
  }

  return (
    <Box>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.5 }}>
        <BlockIcon fontSize="small" color={outstanding.length > 0 ? "warning" : "disabled"} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {outstanding.length > 0
            ? `Waiting on ${outstanding.length} ${outstanding.length === 1 ? "task" : "tasks"}`
            : "Dependencies"}
        </Typography>
      </Stack>

      <Stack spacing={0.25} sx={{ mb: linked.length > 0 ? 1 : 0 }}>
        {outstanding.map((blocker) => (
          <BlockerRow
            key={blocker.id}
            title={blocker.title}
            done={false}
            canEdit={canEdit}
            onOpen={() => onOpen(blocker.id)}
            onRemove={() => setBlockers(linked.filter((id) => id !== blocker.id))}
          />
        ))}

        {/* Linked but no longer outstanding. The server sends only the live
            blockers by name, so a finished one is known by its absence — shown
            as a count rather than invented titles. */}
        {linked.filter((id) => !outstandingIds.has(id)).length > 0 ? (
          <Typography variant="caption" color="text.disabled">
            {linked.filter((id) => !outstandingIds.has(id)).length} finished
          </Typography>
        ) : null}
      </Stack>

      {adding ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Autocomplete
            size="small"
            fullWidth
            openOnFocus
            options={options}
            value={choice}
            getOptionLabel={(option) => option.title}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Must finish first"
                autoFocus
                placeholder="Search tasks"
              />
            )}
            renderOption={(props, option) => {
              const { key, ...rest } = props as { key: string } & Record<string, unknown>;
              return (
                <Box component="li" key={key} {...rest}>
                  <Typography
                    variant="body2"
                    sx={{ textDecoration: isTaskDone(option.status) ? "line-through" : "none" }}
                  >
                    {option.title}
                  </Typography>
                </Box>
              );
            }}
            onChange={(_, value) => setChoice(value)}
          />
          <Button
            size="small"
            variant="contained"
            disabled={!choice || update.isPending}
            onClick={async () => {
              if (!choice) return;
              await setBlockers([...linked, choice.id]);
              setChoice(null);
              setAdding(false);
            }}
          >
            Link
          </Button>
          <IconButton
            size="small"
            aria-label="Cancel"
            onClick={() => {
              setChoice(null);
              setAdding(false);
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      ) : canEdit ? (
        <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          Add a dependency
        </Button>
      ) : null}

      {/* The other direction. Not editable from here: a link is cut from the
          task that has it, so there is exactly one place it can be cut. */}
      {task.blocking_count > 0 ? (
        <Chip
          size="small"
          variant="outlined"
          label={`${task.blocking_count} ${task.blocking_count === 1 ? "task is" : "tasks are"} waiting on this`}
          sx={{ mt: 1 }}
        />
      ) : null}
    </Box>
  );
}

function BlockerRow({
  title,
  done,
  canEdit,
  onOpen,
  onRemove,
}: {
  title: string;
  done: boolean;
  canEdit: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Typography
        variant="body2"
        onClick={onOpen}
        sx={{
          flex: 1,
          minWidth: 0,
          cursor: "pointer",
          color: done ? "text.disabled" : "text.primary",
          textDecoration: done ? "line-through" : "none",
          "&:hover": { textDecoration: "underline" },
        }}
      >
        {title}
      </Typography>
      {canEdit ? (
        <IconButton size="small" onClick={onRemove} aria-label={`Remove dependency on ${title}`}>
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      ) : null}
    </Stack>
  );
}
