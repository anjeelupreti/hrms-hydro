"use client";

/**
 * The client for `/api/proxy/projects/…`.
 *
 * Separate from `useCrm`, because a project is work and work is not a CRM
 * concern. The query keys are namespaced `["projects", …]` for the same
 * reason: invalidating a client's deals must not throw away a board.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/apiError";

import type { PaginatedResponse } from "@/types/crm";
import type {
  Milestone,
  Project,
  ProjectMetrics,
  ProjectStatus,
  ProjectTask,
  Sprint,
  TaskActivity,
  TaskAttachment,
  TaskComment,
  TaskStatus,
} from "@/types/projects";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, response.status));
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

const BASE = "/api/proxy/projects";

// --- Projects --------------------------------------------------------------

export function useProjects(
  filters: { client?: number; status?: string; owner?: number; archived?: boolean } = {}
) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.client) params.set("client", String(filters.client));
  if (filters.status) params.set("status", filters.status);
  if (filters.owner) params.set("owner", String(filters.owner));
  // Delivered work stops crowding the work that has not been.
  if (filters.archived) params.set("archived", "1");

  return useQuery({
    queryKey: ["projects", "list", filters],
    queryFn: () => fetchJson<PaginatedResponse<Project>>(`${BASE}/projects?${params.toString()}`),
  });
}

export function useProject(id: number | null) {
  return useQuery({
    queryKey: ["projects", "detail", id],
    queryFn: () => fetchJson<Project>(`${BASE}/projects/${id}`),
    enabled: id != null,
  });
}

/** Projects owned by an employee — for their profile. */
export function useMyProjects(ownerId: number | null) {
  return useQuery({
    queryKey: ["projects", "owner", ownerId],
    queryFn: () =>
      fetchJson<PaginatedResponse<Project>>(`${BASE}/projects?owner=${ownerId}&page_size=100`),
    enabled: ownerId != null,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    // `client` is optional now — omitting it creates an internal project.
    mutationFn: (values: {
      name: string;
      status: string;
      client?: number | null;
      description?: string;
      owner?: number | null;
      start_date?: string | null;
      end_date?: string | null;
    }) => fetchJson<Project>(`${BASE}/projects`, { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<Project> }) =>
      fetchJson<Project>(`${BASE}/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

/**
 * Stop a project — on hold, or cancelled.
 *
 * **There is no delete, and the server has no route for one.** A project is the
 * parent of approved timesheets and of every task's history, so deleting one
 * would erase the record of work people were paid for. On hold and cancelled
 * are kept as two outcomes rather than one because the reason is the useful
 * part: on hold means the work is expected to resume, cancelled means it is
 * not, and "why did this stop?" is the question a stopped project gets asked.
 *
 * Reopening is the same call with `active` — a state change goes both ways,
 * which is the half of reversibility a delete cannot offer.
 */
export function useSetProjectStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: ProjectStatus }) =>
      fetchJson<Project>(`${BASE}/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

// --- Tasks -----------------------------------------------------------------

export function useProjectTasks(
  filters: { project?: number | null; sprint?: number; status?: TaskStatus; assignee?: number } = {}
) {
  const params = new URLSearchParams({ page_size: "200" });
  if (filters.project != null) params.set("project", String(filters.project));
  if (filters.sprint != null) params.set("sprint", String(filters.sprint));
  if (filters.status) params.set("status", filters.status);
  if (filters.assignee != null) params.set("assignee", String(filters.assignee));

  return useQuery({
    queryKey: ["projects", "tasks", filters],
    queryFn: () => fetchJson<PaginatedResponse<ProjectTask>>(`${BASE}/tasks?${params.toString()}`),
    enabled: filters.project !== null,
  });
}

/**
 * Tasks assigned to an employee — for their profile.
 *
 * Filtered server-side rather than by fetching everything and dropping the done
 * ones here: a page holds 200 rows, and somebody with a long history would have
 * their open work fall off the end of it.
 */
export function useMyTasks(assigneeId: number | null) {
  return useQuery({
    queryKey: ["projects", "tasks", "assignee", assigneeId],
    queryFn: () =>
      fetchJson<PaginatedResponse<ProjectTask>>(
        `${BASE}/tasks?assignee=${assigneeId}&page_size=100`
      ),
    enabled: assigneeId != null,
  });
}

/** Everything on the caller's plate that is not finished. */
export function useMyOpenTasks() {
  return useQuery({
    queryKey: ["projects", "tasks", "mine"],
    queryFn: () => fetchJson<PaginatedResponse<ProjectTask>>(`${BASE}/tasks/mine`),
  });
}

/** How many tasks sit in each column — counted in SQL, not on the page. */
export function useTaskStatusCounts(projectId: number | null) {
  const params = projectId != null ? `?project=${projectId}` : "";
  return useQuery({
    queryKey: ["projects", "tasks", "counts", projectId],
    queryFn: () =>
      fetchJson<Record<string, number> & { total: number }>(`${BASE}/tasks/status-counts${params}`),
  });
}

function invalidateTasks(queryClient: ReturnType<typeof useQueryClient>) {
  // One key, because a task move changes the board, the counts and the parent
  // project's progress bar at the same time.
  queryClient.invalidateQueries({ queryKey: ["projects"] });
}

export function useCreateProjectTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<ProjectTask> & { project: number; title: string }) =>
      fetchJson<ProjectTask>(`${BASE}/tasks`, { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Saved" },
    onSuccess: () => invalidateTasks(queryClient),
  });
}

export function useUpdateProjectTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<ProjectTask> }) =>
      fetchJson<ProjectTask>(`${BASE}/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Saved" },
    onSuccess: () => invalidateTasks(queryClient),
  });
}

/**
 * Set the order of one column of the board.
 *
 * Sends the whole column rather than "move id X to position 3": a position only
 * means something next to its neighbours, and index instructions from two people
 * dragging at once settle into an order neither of them asked for.
 */
export function useReorderProjectTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      fetchJson<{ ids: number[] }>(`${BASE}/tasks/reorder`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    // No success toast. A drag that worked is its own confirmation, and a
    // snackbar on every card nudge is noise.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects", "tasks"] }),
  });
}

export function useDeleteProjectTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      fetchJson<void>(`${BASE}/tasks/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Saved" },
    onSuccess: () => invalidateTasks(queryClient),
  });
}

/**
 * The steps of one task.
 *
 * Asked for explicitly, because the board deliberately excludes sub-tasks —
 * `?parent=<id>` is the only way to see them, and the drawer is the only place
 * that wants to.
 */
export function useSubtasks(taskId: number | null) {
  return useQuery({
    queryKey: ["projects", "tasks", taskId, "subtasks"],
    queryFn: () =>
      fetchJson<PaginatedResponse<ProjectTask>>(`${BASE}/tasks?parent=${taskId}&page_size=100`),
    enabled: taskId != null,
  });
}

/**
 * One task by id.
 *
 * The board holds only top-level tasks, so a **sub-task** opened from its
 * parent's drawer is not in that list and cannot be looked up there. Rather
 * than passing the row down and pinning a snapshot — which is what the board
 * deliberately avoids by holding an id — the drawer's caller falls back to this
 * for anything it does not already have live.
 */
export function useProjectTask(id: number | null) {
  return useQuery({
    queryKey: ["projects", "tasks", "one", id],
    queryFn: () => fetchJson<ProjectTask>(`${BASE}/tasks/${id}`),
    enabled: id != null,
  });
}

/** What changed on a task, and who changed it. */
export function useTaskActivity(taskId: number | null) {
  return useQuery({
    queryKey: ["projects", "tasks", taskId, "activity"],
    queryFn: () => fetchJson<TaskActivity[]>(`${BASE}/tasks/${taskId}/activity`),
    enabled: taskId != null,
  });
}

// --- Sprints ---------------------------------------------------------------

export function useSprints(projectId: number | null) {
  return useQuery({
    queryKey: ["projects", "sprints", projectId],
    queryFn: () =>
      fetchJson<PaginatedResponse<Sprint>>(`${BASE}/sprints?project=${projectId}&page_size=100`),
    enabled: projectId != null,
  });
}

export function useCreateSprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<Sprint> & { project: number; name: string }) =>
      fetchJson<Sprint>(`${BASE}/sprints`, { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateSprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<Sprint> }) =>
      fetchJson<Sprint>(`${BASE}/sprints/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

// --- Milestones ------------------------------------------------------------
//
// Kept apart from sprints in the API as in the model: a sprint is the team cadence
// and a milestone is a promise made outwards, so the two are never one list.

export function useMilestones(projectId: number | null) {
  return useQuery({
    queryKey: ["projects", "milestones", projectId],
    queryFn: () =>
      fetchJson<PaginatedResponse<Milestone>>(
        `${BASE}/milestones?project=${projectId}&page_size=100`,
      ),
    enabled: projectId != null,
  });
}

export function useCreateMilestone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<Milestone> & { project: number; name: string; due_date: string }) =>
      fetchJson<Milestone>(`${BASE}/milestones`, { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateMilestone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<Milestone> }) =>
      fetchJson<Milestone>(`${BASE}/milestones/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Saved" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

/**
 * Remove a milestone that was never met.
 *
 * The server refuses one that has been reached — it is a record of what was
 * delivered by then, not a plan — so the failure path here is a real message
 * rather than a case that cannot happen.
 */
export function useDeleteMilestone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`${BASE}/milestones/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Removed" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

// --- Comments --------------------------------------------------------------

export function useTaskComments(taskId: number | null) {
  return useQuery({
    queryKey: ["projects", "tasks", taskId, "comments"],
    queryFn: () =>
      fetchJson<PaginatedResponse<TaskComment>>(`${BASE}/comments?task=${taskId}&page_size=100`),
    enabled: taskId != null,
  });
}

export function useCreateTaskComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { task: number; body: string }) =>
      fetchJson<TaskComment>(`${BASE}/comments`, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["projects", "tasks", vars.task, "comments"] });
      queryClient.invalidateQueries({ queryKey: ["projects", "tasks"] });
    },
  });
}

export function useDeleteTaskComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number; task: number }) =>
      fetchJson<void>(`${BASE}/comments/${id}`, { method: "DELETE" }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["projects", "tasks", vars.task, "comments"] });
      queryClient.invalidateQueries({ queryKey: ["projects", "tasks"] });
    },
  });
}

// --- Attachments -----------------------------------------------------------
//
// Uploads go as FormData, so `Content-Type` is left unset: the browser has to
// write it itself to include the multipart boundary, and setting it by hand
// produces a body the server cannot parse.

async function upload<T>(url: string, form: FormData): Promise<T> {
  const response = await fetch(url, { method: "POST", body: form });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, response.status));
  }
  return response.json();
}

export function useTaskAttachments(taskId: number | null) {
  return useQuery({
    queryKey: ["projects", "tasks", taskId, "attachments"],
    queryFn: () =>
      fetchJson<PaginatedResponse<TaskAttachment>>(`${BASE}/attachments?task=${taskId}`),
    enabled: taskId != null,
  });
}

export function useUploadTaskAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ task, file }: { task: number; file: File }) => {
      const form = new FormData();
      form.append("task", String(task));
      form.append("file", file);
      return upload<TaskAttachment>(`${BASE}/attachments`, form);
    },
    onSuccess: (_data, vars) =>
      queryClient.invalidateQueries({ queryKey: ["projects", "tasks", vars.task, "attachments"] }),
  });
}

export function useDeleteTaskAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number; task: number }) =>
      fetchJson<void>(`${BASE}/attachments/${id}`, { method: "DELETE" }),
    onSuccess: (_data, vars) =>
      queryClient.invalidateQueries({ queryKey: ["projects", "tasks", vars.task, "attachments"] }),
  });
}

// --- Metrics ---------------------------------------------------------------

/**
 * One person's project figures, for their profile.
 *
 * Omit `employeeId` for your own. Reading somebody else's needs `people.view`
 * or `workplace.manage` server-side, so this will 403 rather than quietly
 * returning the caller's own numbers under someone else's name.
 */
export function useProjectMetrics(employeeId?: number | null, since?: string) {
  const params = new URLSearchParams();
  if (employeeId != null) params.set("employee", String(employeeId));
  if (since) params.set("since", since);
  const query = params.toString();

  return useQuery({
    queryKey: ["projects", "metrics", employeeId ?? "me", since ?? null],
    queryFn: () => fetchJson<ProjectMetrics>(`${BASE}/tasks/metrics${query ? `?${query}` : ""}`),
  });
}

export type PortfolioSummary = {
  projects_active: number;
  projects_total: number;
  tasks_total: number;
  tasks_done: number;
  tasks_blocked: number;
  tasks_in_progress: number;
  tasks_overdue: number;
  tasks_unassigned: number;
};

/**
 * The portfolio counted over tasks rather than projects.
 *
 * A list of projects and their statuses cannot say whether any of them are
 * moving: "active" is a label somebody set once. Completion, blockage and
 * lateness live at task level, across every project at once — which is more
 * rows than a page holds, so it is counted on the server.
 */
export function usePortfolioSummary() {
  return useQuery({
    queryKey: ["projects", "portfolio-summary"],
    queryFn: () => fetchJson<PortfolioSummary>("/api/proxy/projects/projects/portfolio-summary/"),
    placeholderData: (previous) => previous,
  });
}
