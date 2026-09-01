/**
 * Projects, sprints and tasks.
 *
 * Split out of `types/crm.ts` because the models were split out of the `crm`
 * app: a project no longer requires a client, so `client` is nullable here and
 * `client_name` comes back null for internal work.
 *
 * The task's `is_done` boolean is gone. It could not tell "nobody has started"
 * from "somebody is stuck", which is the whole reason a board exists.
 */

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled";

export type Project = {
  id: number;
  /** Null for internal work — an office move belongs to no customer. */
  client: number | null;
  client_name: string | null;
  name: string;
  description: string;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  owner: number | null;
  owner_name: string | null;
  task_count: number;
  done_count: number;
};

export type TaskStatus = "todo" | "in_progress" | "blocked" | "in_review" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

/** The board's columns, in the order work moves through them. */
export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "in_review", label: "In review" },
  { value: "done", label: "Done" },
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export type ProjectTask = {
  id: number;
  project: number;
  project_name: string;
  sprint: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: number | null;
  assignee_name: string | null;
  /** Who asked for it — a different question from who is doing it. */
  assigned_by: number | null;
  assigned_by_name: string | null;
  start_date: string | null;
  due_date: string | null;
  /** Server-stamped when the task first reaches `done`; never sent by us. */
  completed_at: string | null;
  order: number;
  comment_count: number;
  created_at: string;

  /**
   * The task this is a step of, or null for a top-level task.
   *
   * One level only — a sub-task cannot have sub-tasks. The board excludes
   * these unless asked for, because a column counting every step says twelve
   * where a person sees three pieces of work.
   */
  parent: number | null;
  /** Expected hours. The same unit timesheets record, so the two compare. */
  estimate_hours: string | null;
  subtask_done: number;
  subtask_total: number;
  /** Hours actually booked against this task, as a decimal string. */
  logged_hours: string;

  /** The commitment this counts towards. Independent of `sprint`, not an alternative. */
  milestone: number | null;
  milestone_name: string | null;
  /** Tasks that must finish before this one can start. Ids, for writing. */
  blocked_by: number[];
  /**
   * The blockers not yet done, named rather than counted.
   *
   * "This is blocked" is not actionable; "blocked by Migrate the database" is —
   * and it is why the edge is recorded at all, instead of leaving people to
   * keep it in their heads.
   */
  blockers: { id: number; title: string; status: TaskStatus }[];
  is_blocked: boolean;
  /** How many tasks are waiting on this one — am I holding anybody up? */
  blocking_count: number;
};

/**
 * A date the project owes somebody else.
 *
 * Not a sprint. A sprint is the team cadence — internal, repeating, moved
 * without asking anybody. A milestone is a commitment made outwards, and on a
 * client project it is what gets invoiced. Hence one date rather than two,
 * `is_billable`, and no "closed" flag: whether it was met is derived from the
 * tasks under it, never asserted.
 */
export type Milestone = {
  id: number;
  project: number;
  name: string;
  description: string;
  due_date: string;
  /** What the date was before it moved. Null while it has not. */
  original_due_date: string | null;
  has_slipped: boolean;
  is_billable: boolean;
  completed_at: string | null;
  is_complete: boolean;
  /** Overdue *and* unfinished. Something delivered after its date has slipped, not gone late. */
  is_late: boolean;
  done_count: number;
  task_count: number;
};

export type Sprint = {
  id: number;
  project: number;
  name: string;
  goal: string;
  start_date: string;
  end_date: string;
  is_closed: boolean;
  task_count: number;
  done_count: number;
};

export type TaskComment = {
  id: number;
  task: number;
  body: string;
  author_name: string | null;
  created_at: string;
};

export type TaskActivity = {
  id: number;
  field: string;
  from_value: string;
  to_value: string;
  actor_name: string | null;
  at: string;
};

/** Whether this task is still somebody's problem. Four of the five states are. */
export const isOpen = (task: Pick<ProjectTask, "status">) => task.status !== "done";

export type TaskAttachment = {
  id: number;
  original_filename: string;
  uploaded_by_name: string | null;
  /** Bytes, or null when the file has gone missing from storage. */
  size: number | null;
  created_at: string;
};

/**
 * One person's project work, as figures.
 *
 * **Nothing here is a score.** Every rate arrives beside the denominator that
 * makes it readable, and a rate over nothing is `null` rather than zero — a new
 * joiner has no completion rate, and 0% on a profile reads as a failure that
 * has not happened. Rendering must respect that distinction.
 */
export type TaskMetrics = {
  total: number;
  done: number;
  open: number;
  by_status: Record<TaskStatus, number>;
  completion_rate: number | null;
  /** Median days from creation to completion; null when nothing is finished. */
  median_days_to_complete: number | null;
  on_time: number;
  /** How many finished tasks had a due date at all — the honest denominator. */
  with_due_date: number;
  on_time_rate: number | null;
  overdue_open: number;
};

export type ProjectCounts = {
  owned: number;
  owned_active: number;
  contributing: number;
  contributing_active: number;
};

export type ProjectMetrics = {
  employee?: number;
  tasks: TaskMetrics | null;
  projects: ProjectCounts | null;
  open_tasks: ProjectTask[];
  active_projects: Project[];
};
