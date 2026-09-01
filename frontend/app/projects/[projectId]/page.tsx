"use client";

/**
 * One project: its board, its backlog, its sprints.
 *
 * **The board is the default view, and the list is not a lesser one.** A board
 * answers "where is everything" and a list answers "what is mine, when is it
 * due" — both get asked daily, and a product that only ships the board makes
 * people export to a spreadsheet to answer the second.
 *
 * Columns are declared from `TASK_STATUSES` rather than derived from the tasks
 * present, so an empty *Blocked* column keeps saying *nothing is stuck* instead
 * of vanishing exactly when that is worth knowing.
 */

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import DateField from "@/components/common/DateField";
import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import KanbanBoard, { type KanbanColumn } from "@/components/common/KanbanBoard";
import PersonAvatar from "@/components/common/PersonAvatar";
import SearchField from "@/components/common/SearchField";
import { EmployeePicker } from "@/components/common/pickers";
import MilestonePanel from "@/components/projects/MilestonePanel";
import ProjectStopMenu from "@/components/projects/ProjectStopMenu";
import TaskCard from "@/components/projects/TaskCard";
import ProjectParticipants from "@/components/projects/ProjectParticipants";
import TaskStateBar from "@/components/projects/TaskStateBar";
import TaskTimeline from "@/components/projects/TaskTimeline";
import TaskDrawer from "@/components/projects/TaskDrawer";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useMe } from "@/hooks/useMe";
import {
  useCreateProjectTask,
  useCreateSprint,
  useProject,
  useProjectTask,
  useProjectTasks,
  useSprints,
  useReorderProjectTasks,
  useUpdateProjectTask,
  useUpdateSprint,
} from "@/hooks/useProjects";
import { useTextFilter } from "@/hooks/useTextFilter";
import { TASK_STATUS_META, isTaskDone, taskStatusColor } from "@/lib/projects/taskStatus";
import { TASK_STATUSES, type ProjectTask, type TaskStatus } from "@/types/projects";

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);

  const { data: me } = useMe();
  const { data: project, isLoading } = useProject(projectId);
  const { data: tasks, isLoading: tasksLoading } = useProjectTasks({ project: projectId });
  const { data: sprints } = useSprints(projectId);
  const createTask = useCreateProjectTask();
  const updateTask = useUpdateProjectTask();
  const reorderTasks = useReorderProjectTasks();
  const createSprint = useCreateSprint();
  const updateSprint = useUpdateSprint();

  const [tab, setTab] = useState(0);
  // The *id* of the open task, not the row itself. Holding the row would pin a
  // snapshot taken when it was clicked, so a status changed inside the drawer
  // would keep showing its old value until the drawer was closed and reopened.
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [taskDialog, setTaskDialog] = useState(false);
  const [sprintDialog, setSprintDialog] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState<number | null>(null);
  const [newDue, setNewDue] = useState("");
  const [newStatus, setNewStatus] = useState<TaskStatus>("todo");

  const [sprintName, setSprintName] = useState("");
  const [sprintGoal, setSprintGoal] = useState("");
  const [sprintStart, setSprintStart] = useState("");
  const [sprintEnd, setSprintEnd] = useState("");

  const rows = useMemo(() => tasks?.results ?? [], [tasks]);
  const sprintRows = sprints?.results ?? [];

  // The board holds top-level tasks only, so a **step** opened from its
  // parent's drawer is not in `rows`. Fetch that one by id rather than passing
  // the row down: holding the row would pin a snapshot, which is the thing this
  // page deliberately avoids by keying on an id in the first place.
  const onBoard = rows.find((t) => t.id === openTaskId) ?? null;
  const { data: fetchedTask } = useProjectTask(openTaskId != null && !onBoard ? openTaskId : null);
  const openTask = onBoard ?? fetchedTask ?? null;

  /**
   * Whether this viewer may change anything.
   *
   * A guess, and only about what to *show*. The server decides for real in
   * `projects/permissions.py`; this exists so a read-only viewer is not offered
   * controls that will bounce. It errs open — being shown a control you cannot
   * use is a smaller failure than being denied one you can.
   */
  const canEdit =
    Boolean(me?.permissions?.includes("workplace.manage")) ||
    (project?.owner != null && project.owner === me?.employee_id) ||
    rows.some((t) => t.assignee != null && t.assignee === me?.employee_id);

  const {
    query,
    setQuery,
    filtered: visible,
  } = useTextFilter(rows, (t) => [t.title, t.description, t.assignee_name, t.status]);

  // Declared, never derived — an empty column is information.
  const columns: KanbanColumn<ProjectTask>[] = TASK_STATUSES.map((status) => ({
    value: status.value,
    label: status.label,
    cards: visible.filter((t) => t.status === status.value),
    is_terminal: status.value === "done",
  }));


  async function move(task: ProjectTask, to: string) {
    setError("");
    try {
      await updateTask.mutateAsync({ id: task.id, values: { status: to as TaskStatus } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That move could not be saved.");
    }
  }

  /**
   * A column was re-ordered, so `order` is written for every card in it.
   *
   * This is what "managed in the stages" needs beyond moving between them: a
   * column of twenty tasks with no order cannot answer *what do I pick up
   * next*, and until now a drag within a column was silently discarded.
   */
  async function reorder(_column: string, cards: ProjectTask[]) {
    setError("");
    try {
      await reorderTasks.mutateAsync(cards.map((card) => card.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That order could not be saved.");
    }
  }

  async function addTask() {
    if (!newTitle.trim()) return;
    setError("");
    try {
      await createTask.mutateAsync({
        project: projectId,
        title: newTitle.trim(),
        status: newStatus,
        assignee: newAssignee,
        due_date: newDue || null,
      });
      setTaskDialog(false);
      setNewTitle("");
      setNewAssignee(null);
      setNewDue("");
      setNewStatus("todo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  async function addSprint() {
    if (!sprintName.trim() || !sprintStart || !sprintEnd) {
      setError("A sprint needs a name and both dates.");
      return;
    }
    setError("");
    try {
      await createSprint.mutateAsync({
        project: projectId,
        name: sprintName.trim(),
        goal: sprintGoal,
        start_date: sprintStart,
        end_date: sprintEnd,
      });
      setSprintDialog(false);
      setSprintName("");
      setSprintGoal("");
      setSprintStart("");
      setSprintEnd("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  if (isLoading) {
    return (
      <PageContainer>
        <CircularProgress />
      </PageContainer>
    );
  }

  if (!project) {
    return (
      <PageContainer>
        <EmptyState
          title="No such project"
          description="It may have been deleted, or the link may be wrong."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* No standalone <Breadcrumbs />: `PageHeader` already renders one, and
          having both printed the trail twice. */}
      <PageHeader
        title={project.name}
        subtitle={project.client_name ?? "Internal project"}
        recordLabel={project.name}
        actions={
          <Stack direction="row" spacing={1}>
            <Button component={Link} href="/projects" startIcon={<ArrowBackIcon />}>
              All projects
            </Button>
            {canEdit ? (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTaskDialog(true)}>
                New task
              </Button>
            ) : null}
            {canEdit ? <ProjectStopMenu project={project} onError={setError} /> : null}
          </Stack>
        }
      />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={3}
            sx={{ alignItems: { sm: "center" } }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {/* Was a single bar reading "12 of 38 done", which collapses five
                  states into two: a project 30% done with nothing blocked and
                  one 30% done with nine tasks stuck drew exactly the same
                  picture. */}
              <TaskStateBar tasks={rows} />
            </Box>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Chip size="small" variant="outlined" label={project.status.replace("_", " ")} />
              {/* Faces before the owner's name: the owner is frequently not
                  the person doing the work, so "is anyone on this" needs its
                  own answer. */}
              <ProjectParticipants tasks={rows} />
              {project.owner_name ? (
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                  <PersonAvatar name={project.owner_name} size={24} variant="outlined" />
                  <Typography variant="body2">{project.owner_name}</Typography>
                </Stack>
              ) : null}
              {project.end_date ? (
                <Typography variant="body2" color="text.secondary">
                  Due <DateText value={project.end_date} />
                </Typography>
              ) : null}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: "center" } }}
      >
        <Tabs value={tab} onChange={(_e, v) => setTab(v)}>
          <Tab label="Board" />
          <Tab label="List" />
          {/* **When**, which neither of the two above answers. The board says
              where everything is and the list says what is mine; only this says
              whether the run of work reaches the date somebody promised. */}
          <Tab label="Timeline" />
          <Tab label={`Sprints${sprintRows.length ? ` (${sprintRows.length})` : ""}`} />
          {/* Its own tab, not folded in with sprints. A sprint is the team
              cadence; a milestone is a promise made outwards, and putting them
              in one list teaches people the two can be moved the same way. */}
          <Tab label="Milestones" />
        </Tabs>
        <Box sx={{ flex: 1 }} />
        {tab < 3 ? (
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search tasks…"
            label="Search tasks by title, assignee or status"
            sx={{ width: "100%", maxWidth: { sm: 260 } }}
          />
        ) : null}
      </Stack>

      {tasksLoading ? <CircularProgress /> : null}

      {/* **An empty board is not five empty columns.** Once tasks exist the
          columns are information — an empty *Blocked* says nothing is stuck —
          but with no tasks at all they say nothing and explain nothing, which
          is the screen a new project opens on. */}
      {tab === 0 && !tasksLoading && rows.length === 0 ? (
        <EmptyState
          surface
          title="No tasks yet"
          description="A task is one piece of work with somebody's name on it. Add the first and it lands in To do."
          action={
            canEdit ? (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTaskDialog(true)}>
                New task
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {tab === 0 && !tasksLoading && rows.length > 0 && visible.length === 0 ? (
        <EmptyState
          surface
          variant="noResults"
          title={`Nothing matches “${query}”`}
          description="Try a title, a name or a status."
          action={<Button onClick={() => setQuery("")}>Clear search</Button>}
        />
      ) : null}

      {tab === 0 && !tasksLoading && visible.length > 0 ? (
        <KanbanBoard
          columns={columns}
          getId={(t) => t.id}
          renderCard={(t) => <TaskCard task={t} onOpen={(t) => setOpenTaskId(t.id)} />}
          onMove={move}
          onReorder={reorder}
          readOnly={!canEdit}
          emptyHint="Nothing here"
        />
      ) : null}

      {tab === 1 && !tasksLoading ? (
        <Stack spacing={1}>
          {visible.length === 0 ? (
            <EmptyState
              surface
              variant={query ? "noResults" : "empty"}
              title={query ? `Nothing matches “${query}”` : "No tasks yet"}
              description={
                query
                  ? "Try a title, a name or a status."
                  : "A task is one piece of work with somebody's name on it."
              }
              action={
                query ? (
                  <Button onClick={() => setQuery("")}>Clear search</Button>
                ) : canEdit ? (
                  <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTaskDialog(true)}>
                    New task
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {visible.map((task) => (
            <Card key={task.id} variant="outlined">
              <CardContent
                sx={{ py: 1.25, "&:last-child": { pb: 1.25 }, cursor: "pointer" }}
                onClick={() => setOpenTaskId(task.id)}
              >
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      bgcolor: taskStatusColor(task.status),
                    }}
                  />
                  <Typography
                    variant="body2"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      fontWeight: 500,
                      textDecoration: isTaskDone(task.status) ? "line-through" : "none",
                      color: isTaskDone(task.status) ? "text.secondary" : "text.primary",
                    }}
                    noWrap
                  >
                    {task.title}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={TASK_STATUS_META[task.status].label}
                  />
                  {task.due_date ? (
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 90 }}>
                      <DateText value={task.due_date} />
                    </Typography>
                  ) : null}
                  {task.assignee_name ? (
                    <PersonAvatar name={task.assignee_name} size={24} variant="outlined" />
                  ) : (
                    <Typography variant="caption" color="text.disabled" sx={{ minWidth: 70 }}>
                      Unassigned
                    </Typography>
                  )}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      ) : null}

      {tab === 2 && !tasksLoading ? (
        <Card>
          <CardContent>
            <TaskTimeline tasks={rows} onOpen={(task) => setOpenTaskId(task.id)} />
          </CardContent>
        </Card>
      ) : null}

      {tab === 3 ? (
        <Stack spacing={1.5}>
          {canEdit ? (
            <Button
              startIcon={<AddIcon />}
              onClick={() => setSprintDialog(true)}
              sx={{ alignSelf: "flex-start" }}
            >
              New sprint
            </Button>
          ) : null}
          {sprintRows.length === 0 ? (
            <EmptyState
              surface
              title="No sprints"
              description="A sprint is a named, dated slice of the work. Everything without one sits in the backlog, which is a real answer rather than a gap."
              action={
                canEdit ? (
                  <Button variant="contained" startIcon={<AddIcon />} onClick={() => setSprintDialog(true)}>
                    New sprint
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {sprintRows.map((sprint) => (
            <Card key={sprint.id} variant="outlined">
              <CardContent>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {sprint.name}
                      </Typography>
                      {sprint.is_closed ? (
                        <Chip size="small" variant="outlined" label="Closed" sx={{ height: 20 }} />
                      ) : null}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      <DateText value={sprint.start_date} /> → <DateText value={sprint.end_date} />
                    </Typography>
                    {sprint.goal ? (
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {sprint.goal}
                      </Typography>
                    ) : null}
                  </Box>
                  <Box sx={{ width: { xs: "100%", sm: 180 } }}>
                    <Typography variant="caption" color="text.secondary">
                      {sprint.done_count} of {sprint.task_count} done
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={sprint.task_count ? (sprint.done_count / sprint.task_count) * 100 : 0}
                      sx={{ height: 6, borderRadius: 3, mt: 0.5 }}
                    />
                  </Box>
                  {canEdit ? (
                    <Button
                      size="small"
                      onClick={() =>
                        updateSprint.mutate({
                          id: sprint.id,
                          values: { is_closed: !sprint.is_closed },
                        })
                      }
                    >
                      {sprint.is_closed ? "Reopen" : "Close"}
                    </Button>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      ) : null}

      {tab === 4 ? (
        <MilestonePanel projectId={projectId!} canEdit={canEdit} onError={setError} />
      ) : null}

      {/* Keyed by task id so opening a different task remounts the drawer,
          which is what re-seeds its title and description fields. */}
      {openTask ? (
        <TaskDrawer
          key={openTask.id}
          task={openTask}
          sprints={sprintRows}
          canEdit={canEdit}
          onClose={() => setOpenTaskId(null)}
          onOpenTask={setOpenTaskId}
        />
      ) : null}

      <Dialog open={taskDialog} onClose={() => setTaskDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New task</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Title"
              fullWidth
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <TextField
              select
              label="Status"
              fullWidth
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as TaskStatus)}
            >
              {TASK_STATUSES.map((s) => (
                <MenuItem key={s.value} value={s.value}>
                  {s.label}
                </MenuItem>
              ))}
            </TextField>
            <EmployeePicker
              label="Assignee"
              value={newAssignee}
              onChange={(id) => setNewAssignee(id ?? null)}
              helperText="They will be able to move it themselves."
            />
            <DateField label="Due date" value={newDue} onChange={setNewDue} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTaskDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={addTask} disabled={createTask.isPending}>
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={sprintDialog} onClose={() => setSprintDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New sprint</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Name"
              fullWidth
              autoFocus
              value={sprintName}
              onChange={(e) => setSprintName(e.target.value)}
            />
            <TextField
              label="Goal"
              fullWidth
              multiline
              minRows={2}
              value={sprintGoal}
              onChange={(e) => setSprintGoal(e.target.value)}
              helperText="What this fortnight is for."
            />
            <Stack direction="row" spacing={2}>
              <DateField label="Starts" value={sprintStart} onChange={setSprintStart} />
              <DateField label="Ends" value={sprintEnd} onChange={setSprintEnd} />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSprintDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={addSprint} disabled={createSprint.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
