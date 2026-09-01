"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

export type TimeEntry = {
  id: number;
  employee: number;
  employee_name: string | null;
  project: number;
  project_name: string;
  task: number | null;
  task_title: string | null;
  date: string;
  hours: string;
  description: string;
  billable: boolean;
  status: "submitted" | "approved" | "rejected";
  decided_at: string | null;
  created_at: string;
};

export type TimeSummary = {
  total_hours: number;
  by_project: { project: number; project_name: string; hours: number }[];
};

type Paginated<T> = { count: number; results: T[] };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, res.status));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const B = "/api/proxy/timesheets/entries";

export function useTimeEntries(
  filters: { status?: string; project?: number; search?: string; page?: number; pageSize?: number } = {}
) {
  // Paged and searched on the server. `page_size=100` was the server's own cap,
  // so the screen held at most a hundred rows and offered no way to the rest —
  // while the status chips, counted in SQL, correctly reported more. Search was
  // the same shape of problem: filtering the loaded rows in the browser cannot
  // match a record it never fetched.
  const params = new URLSearchParams({
    page: String(filters.page ?? 1),
    page_size: String(filters.pageSize ?? 25),
  });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.project) params.set("project", String(filters.project));
  return useQuery({
    queryKey: ["timesheets", filters],
    queryFn: () => fetchJson<Paginated<TimeEntry>>(`${B}/?${params.toString()}`),
    // Hold the current page on screen while the next one loads, so paging
    // does not flash an empty table between clicks.
    placeholderData: keepPreviousData,
  });
}

export function useTimeSummary() {
  return useQuery({
    queryKey: ["timesheets", "summary"],
    queryFn: () => fetchJson<TimeSummary>(`${B}/summary/`),
  });
}

// Projects to log against. Every project, not just client-facing ones —
// internal work is logged against the hours too.
export function useProjectsForTimesheets() {
  return useQuery({
    queryKey: ["projects", "timesheets"],
    queryFn: () => fetchJson<Paginated<{ id: number; name: string }>>("/api/proxy/projects/projects?page_size=100"),
  });
}

export function useLogTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      project: number;
      /** Optional — plenty of work is not on a card. Naming it is what lets an
       *  estimate be checked against the hours actually spent. */
      task?: number | null;
      date: string;
      hours: string;
      description?: string;
      billable?: boolean;
    }) => fetchJson<TimeEntry>(`${B}/`, { method: "POST", body: JSON.stringify(values) }),
    meta: { successMessage: "Time logged" },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
      // The task's `logged_hours` just moved, and it is read on the board and
      // in the drawer. Without this the estimate-versus-actual figure stays
      // stale until something else happens to refetch it.
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${B}/${id}/`, { method: "DELETE" }),
    meta: { successMessage: "Entry deleted" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timesheets"] }),
  });
}

export function useDecideTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "reject" }) =>
      fetchJson<TimeEntry>(`${B}/${id}/${action}/`, { method: "POST" }),
    meta: { successMessage: "Entry updated" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timesheets"] }),
  });
}

// ── The week ─────────────────────────────────────────────────────────────

export type TimesheetDay = {
  date: string;
  hours: string;
  approved_hours: string;
  entries: number;
  /** Whether the company works this day — read from the company's configured week. */
  working_day: boolean;
  /** A working day, in the past, with nothing logged. The thing a list cannot show. */
  missing: boolean;
};

export type TimesheetWeek = {
  start: string;
  end: string;
  total_hours: string;
  billable_hours: string;
  days: TimesheetDay[];
  missing_days: number;
  working_days: number;
};

/**
 * One week, day by day, **including the days with nothing on them**.
 *
 * A list of entries can only show what was logged. The question a timesheet
 * exists to answer is what wasn't — and an absent row is invisible in a list by
 * definition, so somebody who forgot Tuesday sees six rows and no hint that a
 * seventh is missing.
 *
 * Which blanks count as gaps is decided on the server, because it depends on
 * the company's configured working week and its holiday table. Nepal's weekend
 * is Saturday; a client-side Monday-to-Friday assumption would flag every
 * Saturday and teach people to ignore the warning.
 */
export function useTimesheetWeek(start: string, employee?: number | null) {
  const params = new URLSearchParams({ start });
  if (employee) params.set("employee", String(employee));
  return useQuery({
    queryKey: ["timesheets", "week", start, employee ?? null],
    queryFn: () => fetchJson<TimesheetWeek>(`${B}/week/?${params.toString()}`),
    // Hold the current page on screen while the next one loads, so paging
    // does not flash an empty table between clicks.
    placeholderData: keepPreviousData,
  });
}
