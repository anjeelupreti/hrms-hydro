/**
 * How a task's state is drawn, in one place.
 *
 * Five states appear on the board, in a task row, in a profile's task list and
 * (next) in the metrics. Deciding the colour at each of those sites is how the
 * same state ends up amber in one and grey in another, and a reader who has
 * learnt that amber means blocked then has to learn it again per screen.
 *
 * **Why these are palette roles and not theme shades.** The house rule is that
 * decoration uses shades of the company's chosen colour rather than a spread of
 * unrelated hues. State is not decoration: *blocked* has to read as a problem
 * on a blue company and on a green one alike, and a paler shade of the brand
 * cannot carry that. The set is deliberately small — one alarm, one caution,
 * one success, and neutral for everything that is simply progressing.
 */

import type { TaskPriority, TaskStatus } from "@/types/projects";

type PaletteRole = "success" | "warning" | "error" | "info" | "default";

export const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; role: PaletteRole; done: boolean }
> = {
  todo: { label: "To do", role: "default", done: false },
  in_progress: { label: "In progress", role: "info", done: false },
  blocked: { label: "Blocked", role: "error", done: false },
  in_review: { label: "In review", role: "warning", done: false },
  done: { label: "Done", role: "success", done: true },
};

export const TASK_PRIORITY_META: Record<TaskPriority, { label: string; role: PaletteRole }> = {
  low: { label: "Low", role: "default" },
  normal: { label: "Normal", role: "default" },
  high: { label: "High", role: "warning" },
  urgent: { label: "Urgent", role: "error" },
};

/** A CSS colour for the state's dot or bar. */
export function taskStatusColor(status: TaskStatus): string {
  const role = TASK_STATUS_META[status].role;
  return role === "default" ? "text.disabled" : `${role}.main`;
}

export const isTaskDone = (status: TaskStatus) => TASK_STATUS_META[status].done;
