"use client";

/**
 * One task, in full — and the two records that explain it.
 *
 * **Comments and activity are separate lists, deliberately.** A comment is
 * something a person chose to write; the activity trail is what the system
 * observed. Merged into one feed, "moved to In review" and "this is blocked on
 * the client waiting for their finance team" carry the same weight, and the
 * second is the one worth reading. So they sit in tabs, and comments come
 * first, because that is the one somebody opened the task to find.
 *
 * A wide modal split down the middle: the task on the left, what has happened
 * to it on the right, each scrolling on its own. In a narrow drawer the
 * description, the blockers and the steps all sit *above* the conversation, so
 * on any task with real detail the comments — and the box for writing one — are
 * below the fold, and a thread nobody scrolls to is a thread nobody reads.
 *
 * Fields save on blur rather than behind a Save button. A panel with a Save
 * button teaches people to close it without pressing one, and the change they
 * thought they made is the change the board never shows.
 *
 * **`task` must be the live row, not a snapshot.** The caller looks it up by id
 * out of the same list the board renders, so a save that comes back changed is
 * reflected here rather than leaving the drawer showing what used to be true.
 * The caller also keys this component by task id, which is what re-seeds the
 * two free-text fields when a different task is opened — an effect doing that
 * job would repaint the previous task's title over the new one for a frame.
 */

import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteOutlineIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import SendIcon from "@mui/icons-material/Send";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import DateText from "@/components/common/DateText";
import PersonAvatar from "@/components/common/PersonAvatar";
import { EmployeePicker } from "@/components/common/pickers";
import BlockerPanel from "@/components/projects/BlockerPanel";
import SubtaskPanel from "@/components/projects/SubtaskPanel";
import {
  useCreateTaskComment,
  useDeleteTaskAttachment,
  useDeleteTaskComment,
  useTaskActivity,
  useTaskAttachments,
  useTaskComments,
  useMilestones,
  useUpdateProjectTask,
  useUploadTaskAttachment,
} from "@/hooks/useProjects";
import { TASK_PRIORITY_META, TASK_STATUS_META } from "@/lib/projects/taskStatus";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ProjectTask,
  type Sprint,
  type TaskPriority,
  type TaskStatus,
} from "@/types/projects";

/** Bytes as something a person reads, or a plain note when the file is gone. */
function formatSize(bytes: number | null) {
  if (bytes === null) return "file missing";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `status` → "moved to In review", not `status: in_review → done`. */
function readableActivity(field: string, from: string, to: string) {
  const pretty = (raw: string) => {
    if (!raw) return "nothing";
    const status = TASK_STATUS_META[raw as TaskStatus];
    if (status) return status.label;
    const priority = TASK_PRIORITY_META[raw as TaskPriority];
    if (priority) return priority.label;
    return raw;
  };
  const label =
    {
      status: "Status",
      priority: "Priority",
      assignee: "Assignee",
      sprint: "Sprint",
      milestone: "Milestone",
      due_date: "Due date",
    }[
      field
    ] ?? field;
  return `${label}: ${pretty(from)} → ${pretty(to)}`;
}

export default function TaskDrawer({
  task,
  sprints = [],
  canEdit,
  onClose,
  onOpenTask,
}: {
  task: ProjectTask;
  sprints?: Sprint[];
  /** Server decides too; this only keeps a read-only viewer from being teased. */
  canEdit: boolean;
  onClose: () => void;
  /**
   * Open another task in this drawer — used by the steps list, because a step
   * is a real task and has everything this drawer shows. Optional: a caller
   * that cannot navigate simply does not pass it, and the steps stay readable
   * without being clickable.
   */
  onOpenTask?: (id: number) => void;
}) {
  const update = useUpdateProjectTask();
  const { data: milestoneData } = useMilestones(task.project);
  const milestones = milestoneData?.results ?? [];
  const { data: comments, isLoading: commentsLoading } = useTaskComments(task.id);
  const { data: activity } = useTaskActivity(task.id);
  const addComment = useCreateTaskComment();
  const removeComment = useDeleteTaskComment();
  const { data: attachments } = useTaskAttachments(task.id);
  const addFile = useUploadTaskAttachment();
  const removeFile = useDeleteTaskAttachment();

  const [tab, setTab] = useState(0);
  // Seeded once per mount. The caller's `key={task.id}` remounts this when a
  // different task is opened, so these start on the right text without an
  // effect writing over them after the first paint.
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  // Held as text, not a number. An empty box and a zero are different answers —
  // "nobody has estimated this" versus "this takes no time" — and a number
  // state cannot hold the first without inventing a sentinel.
  const [estimate, setEstimate] = useState(task.estimate_hours ?? "");

  async function save(values: Partial<ProjectTask>) {
    setError("");
    try {
      await update.mutateAsync({ id: task.id, values });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  async function postComment() {
    if (!draft.trim()) return;
    setError("");
    try {
      await addComment.mutateAsync({ task: task.id, body: draft.trim() });
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be posted.");
    }
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      await addFile.mutateAsync({ task: task.id, file });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file could not be attached.");
    }
  }

  const commentRows = comments?.results ?? [];
  const fileRows = attachments?.results ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { height: { md: "88vh" } } } }}
    >
      <DialogContent sx={{ p: 0, display: "flex", flexDirection: { xs: "column", md: "row" }, overflow: "hidden" }}>
        {/* ── The task itself ─────────────────────────────────────────────
            Left, and wider: this is what somebody opened the task to read or
            change. */}
        <Stack
          spacing={2}
          sx={{
            flex: { md: "1 1 58%" },
            minWidth: 0,
            p: 2.5,
            overflowY: "auto",
          }}
        >
        <Box>
          <Typography variant="overline" color="text.secondary">
            {task.project_name}
          </Typography>
          <TextField
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && save({ title: title.trim() })}
            disabled={!canEdit}
            fullWidth
            multiline
            variant="standard"
            slotProps={{ input: { disableUnderline: !canEdit, sx: { fontSize: 20, fontWeight: 700 } } }}
          />
        </Box>

        {error ? (
          <Alert severity="error" onClose={() => setError("")}>
            {error}
          </Alert>
        ) : null}

        <Stack direction="row" spacing={1.5}>
          <TextField
            select
            size="small"
            label="Status"
            fullWidth
            value={task.status}
            disabled={!canEdit}
            onChange={(e) => save({ status: e.target.value as TaskStatus })}
          >
            {TASK_STATUSES.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Priority"
            fullWidth
            value={task.priority}
            disabled={!canEdit}
            onChange={(e) => save({ priority: e.target.value as TaskPriority })}
          >
            {TASK_PRIORITIES.map((p) => (
              <MenuItem key={p.value} value={p.value}>
                {p.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <EmployeePicker
          label="Assignee"
          size="small"
          value={task.assignee}
          disabled={!canEdit}
          onChange={(id) => save({ assignee: id ?? null })}
        />

        <Stack direction="row" spacing={1.5}>
          <DateField
            label="Due date"
            size="small"
            value={task.due_date ?? ""}
            disabled={!canEdit}
            onChange={(value) => save({ due_date: value || null })}
          />
          {sprints.length > 0 ? (
            <TextField
              select
              size="small"
              label="Sprint"
              fullWidth
              value={task.sprint ?? ""}
              disabled={!canEdit}
              onChange={(e) => save({ sprint: e.target.value === "" ? null : Number(e.target.value) })}
            >
              {/* The backlog is a real answer, not an absence of one. */}
              <MenuItem value="">Backlog</MenuItem>
              {sprints.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
        </Stack>

        {/* Beside the sprint, never instead of it. *When are we doing this* and
            *what does it count towards* are different questions, and a task
            routinely has both answers. */}
        {milestones.length > 0 ? (
          <TextField
            select
            size="small"
            label="Counts towards"
            fullWidth
            value={task.milestone ?? ""}
            disabled={!canEdit}
            onChange={(e) =>
              save({ milestone: e.target.value === "" ? null : Number(e.target.value) })
            }
          >
            <MenuItem value="">Nothing in particular</MenuItem>
            {milestones.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}

        <TextField
          label="Description"
          multiline
          minRows={3}
          size="small"
          fullWidth
          value={description}
          disabled={!canEdit}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== task.description && save({ description })}
        />

        {/* **Estimate beside actual, always together.** An estimate on its own
            is a guess nobody ever checks; the whole reason this is in hours
            rather than story points is that `timesheets` records hours against
            the same task, so the two can be compared. Showing one without the
            other throws that away. */}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
          <TextField
            label="Estimate (hours)"
            size="small"
            fullWidth
            type="number"
            value={estimate}
            disabled={!canEdit}
            placeholder="—"
            slotProps={{ htmlInput: { min: 0, step: 0.5 } }}
            onChange={(e) => setEstimate(e.target.value)}
            onBlur={() => {
              const next = estimate.trim();
              if (next === (task.estimate_hours ?? "")) return;
              save({ estimate_hours: next === "" ? null : next });
            }}
          />
          <Box sx={{ flex: 1, pt: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              Logged
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {Number(task.logged_hours) > 0 ? `${task.logged_hours} h` : "Nothing yet"}
            </Typography>
            {/* Only when there is something to compare. "0 of 4h" on an
                untouched task reads as being behind, which it is not. */}
            {task.estimate_hours && Number(task.logged_hours) > 0 ? (
              <Typography
                variant="caption"
                color={
                  Number(task.logged_hours) > Number(task.estimate_hours)
                    ? "warning.main"
                    : "text.secondary"
                }
              >
                of {task.estimate_hours} h estimated
              </Typography>
            ) : null}
          </Box>
        </Stack>

        {task.completed_at ? (
          <Typography variant="caption" color="text.secondary">
            Completed <DateText value={task.completed_at} />
          </Typography>
        ) : null}

        <Divider />

        {/* Above the steps, because it answers an earlier question: whether
            this can be started at all comes before how it breaks down. */}
        <BlockerPanel
          task={task}
          canEdit={canEdit}
          onOpen={(id) => onOpenTask?.(id)}
          onError={setError}
        />

        <Divider />

        {/* Steps sit above the tabs rather than inside them: breaking work down
            is part of describing the task, not a record of what happened to it. */}
        <SubtaskPanel
          task={task}
          canEdit={canEdit}
          onOpen={(id) => onOpenTask?.(id)}
          onError={setError}
        />

        </Stack>

        {/* ── What has happened to it ─────────────────────────────────────
            Its own column, against its own edge, with room to actually read a
            thread. In the 460px drawer this sat *below* the description, the
            steps and the blockers — so a task with any detail on it pushed the
            conversation off the bottom of the screen, and the comment box was
            reached by scrolling past everything else. Comments, files and
            history are the parts people come back to a task for; side by side
            they are visible without displacing anything. */}
        <Stack
          spacing={2}
          sx={{
            flex: { md: "1 1 42%" },
            minWidth: 0,
            p: 2.5,
            borderLeft: { md: "1px solid" },
            borderTop: { xs: "1px solid", md: "none" },
            borderColor: { xs: "divider", md: "divider" },
            bgcolor: "background.default",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="fullWidth">
          <Tab label={`Comments${commentRows.length ? ` (${commentRows.length})` : ""}`} />
          <Tab label={`Files${fileRows.length ? ` (${fileRows.length})` : ""}`} />
          <Tab label="History" />
        </Tabs>

        <Box sx={{ flex: 1, overflowY: "auto", minHeight: 120 }}>
          {tab === 0 ? (
            <Stack spacing={1.5}>
              {commentsLoading ? <CircularProgress size={20} sx={{ mx: "auto" }} /> : null}
              {!commentsLoading && commentRows.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nothing said yet.
                </Typography>
              ) : null}
              {commentRows.map((comment) => (
                <Stack key={comment.id} direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
                  <PersonAvatar name={comment.author_name ?? "?"} size={28} variant="outlined" />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {comment.author_name ?? "Someone"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        <DateText value={comment.created_at} />
                      </Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      {comment.body}
                    </Typography>
                  </Box>
                  {/* Shown to everyone; the server refuses anybody else's.
                      Hiding it would need us to know who is signed in here,
                      and guessing wrong hides a button somebody is entitled to. */}
                  <Tooltip title="Delete comment">
                    <IconButton
                      size="small"
                      onClick={() => removeComment.mutate({ id: comment.id, task: task.id })}
                    >
                      <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ))}
            </Stack>
          ) : tab === 1 ? (
            <Stack spacing={1.25}>
              {fileRows.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nothing attached.
                </Typography>
              ) : null}
              {fileRows.map((file) => (
                <Stack key={file.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <AttachFileIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {file.original_filename}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {file.uploaded_by_name ?? "Someone"} · {formatSize(file.size)}
                    </Typography>
                  </Box>
                  {/* A plain link, not a fetch — the browser handles the save
                      dialog and the filename comes off Content-Disposition. */}
                  <Tooltip title="Download">
                    <IconButton
                      size="small"
                      component="a"
                      href={`/api/proxy/projects/attachments/${file.id}/download`}
                    >
                      <DownloadIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Remove">
                    <IconButton
                      size="small"
                      onClick={() => removeFile.mutate({ id: file.id, task: task.id })}
                    >
                      <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ))}

              {canEdit ? (
                <Button
                  component="label"
                  size="small"
                  startIcon={<AttachFileIcon />}
                  disabled={addFile.isPending}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Attach a file
                  <input
                    type="file"
                    hidden
                    onChange={(e) => {
                      attach(e.target.files?.[0]);
                      // Cleared so re-picking the same file fires change again.
                      e.target.value = "";
                    }}
                  />
                </Button>
              ) : null}
            </Stack>
          ) : (
            <Stack spacing={1}>
              {(activity ?? []).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nothing has changed since this was created.
                </Typography>
              ) : null}
              {(activity ?? []).map((entry) => (
                <Stack key={entry.id} direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={readableActivity(entry.field, entry.from_value, entry.to_value)}
                  />
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {entry.actor_name ?? "System"} · <DateText value={entry.at} />
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>

        {tab === 0 ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
            <TextField
              size="small"
              fullWidth
              multiline
              maxRows={4}
              placeholder="Add a comment…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line — a comment box that
                // needs a mouse click to send is a comment box people abandon.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  postComment();
                }
              }}
            />
            <IconButton
              color="primary"
              onClick={postComment}
              disabled={!draft.trim() || addComment.isPending}
            >
              <SendIcon />
            </IconButton>
          </Stack>
        ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
