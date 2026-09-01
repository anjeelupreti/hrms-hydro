"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

import type { ArrivalDistribution } from "@/types/dashboard";
import type {
  AttendanceCalendar,
  AttendanceDevice,
  AttendanceEditLogEntry,
  AttendanceLog,
  AttendanceStatus,
  PaginatedResponse,
} from "@/types/attendance";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, response.status));
  }
  return response.json();
}

/** One in-and-out. A day is made of several. */
export type AttendanceSession = {
  id: number;
  check_in_time: string;
  check_out_time: string | null;
  source: string;
  note: string;
  seconds_worked: number;
  is_open: boolean;
  /**
   * Closed by the nightly sweep because the day ended with it open, not by
   * somebody pressing the button.
   *
   * Marked rather than hidden: the difference between "worked until six" and
   * "forgot to clock out" is the whole question when hours are disputed, and a
   * tidy end-of-day time that looks like a real punch is worse than an obvious
   * gap.
   */
  auto_closed: boolean;
};

/**
 * A whole day of punches.
 *
 * `seconds_worked` counts **closed** sessions only — the running stretch is
 * added by the screen from `open_since`, so the served number does not change
 * between two reads a second apart.
 */
export type DaySummary = {
  date: string;
  status: AttendanceStatus | null;
  sessions: AttendanceSession[];
  seconds_worked: number;
  open_since: string | null;
  is_clocked_in: boolean;
  punches: number;
  /**
   * How long a full day is for this person — their shift if assigned, else the
   * company's office hours, minus the unpaid break.
   *
   * **Served, not derived here.** The rule has three steps and a fallback, and
   * a second copy in the browser would disagree the first time one of them
   * changed (§2.6). Null where the system has set no hours, which is a real
   * state rather than a missing value.
   */
  working_day_seconds: number | null;
};

/**
 * Today's own attendance — or `null` for somebody who does not punch a clock.
 *
 * The top bar mounts this on every page, and an account with no employee record
 * behind it — a finance-only login, the system owner who is not on the
 * payroll — is refused by the server. Left to retry, that is four browser
 * errors before any screen renders.
 *
 * None of that is a fault. The backend supports profile-less accounts
 * deliberately and says so in the same words across fourteen endpoints; it is
 * *this* hook that was reading a supported state as a failure. So the answer
 * is `null` — "there is no clock for this person" — and the widgets that
 * consume it draw nothing rather than an error.
 */
const NO_PROFILE = /no employee profile/i;

export function useMyTodayAttendance() {
  return useQuery({
    queryKey: ["attendance", "my-today"],
    queryFn: async () => {
      try {
        return await fetchJson<DaySummary>("/api/proxy/attendance/logs/my-today");
      } catch (error) {
        if (error instanceof Error && NO_PROFILE.test(error.message)) return null;
        throw error;
      }
    },
    // Nothing about a missing profile improves on a second attempt.
    retry: (count, error) =>
      count < 2 && !(error instanceof Error && NO_PROFILE.test(error.message)),
  });
}

/**
 * Your own punches, day by day.
 *
 * **Own only.** The endpoint takes no employee id — somebody else's arrival
 * times are a record of their movements, and HR reads those through the
 * gated attendance screens rather than through a portal route.
 */
export type PunchHistory = {
  start: string;
  end: string;
  days: DaySummary[];
  /** Served, not summed here: a total over one page is not a fact (§2.6). */
  seconds_worked: number;
  days_with_punches: number;
};

export function useMyPunchHistory(range?: { start?: string; end?: string }) {
  const params = new URLSearchParams();
  if (range?.start) params.set("start", range.start);
  if (range?.end) params.set("end", range.end);
  const qs = params.toString();
  return useQuery({
    queryKey: ["attendance", "my-history", range?.start ?? "", range?.end ?? ""],
    queryFn: () =>
      fetchJson<PunchHistory>(
        `/api/proxy/attendance/logs/my-history${qs ? `?${qs}` : ""}`
      ),
  });
}

export function useCheckIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<DaySummary>("/api/proxy/attendance/logs/check-in", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

export function useCheckOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<DaySummary>("/api/proxy/attendance/logs/check-out", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

export type AttendanceFilters = {
  page: number;
  pageSize: number;
  employee?: number;
  status?: AttendanceStatus;
  date?: string;
  /** Free text, matched server-side against employee code and name. */
  search?: string;
};

export function useAttendanceLogs(filters: AttendanceFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    page_size: String(filters.pageSize),
  });
  if (filters.employee) params.set("employee", String(filters.employee));
  if (filters.status) params.set("status", filters.status);
  if (filters.date) params.set("date", filters.date);
  if (filters.search) params.set("search", filters.search);

  return useQuery({
    queryKey: ["attendance", "logs", filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<AttendanceLog>>(`/api/proxy/attendance/logs?${params.toString()}`),
    placeholderData: (previous) => previous,
  });
}

export function useAttendanceEditLogs(id: number | null) {
  return useQuery({
    queryKey: ["attendance", "edit-logs", id],
    queryFn: () => fetchJson<AttendanceEditLogEntry[]>(`/api/proxy/attendance/logs/${id}/edit_logs`),
    enabled: id !== null,
  });
}

export function useCorrectAttendanceLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: number;
      values: Partial<Pick<AttendanceLog, "check_in_time" | "check_out_time" | "status" | "notes">>;
    }) =>
      fetchJson<AttendanceLog>(`/api/proxy/attendance/logs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function useShifts() {
  return useQuery({
    queryKey: ["shifts"],
    queryFn: () => fetchJson<PaginatedResponse<import("@/types/attendance").Shift>>(`/api/proxy/attendance/shifts`),
  });
}

export function useSaveShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id?: number;
      values: Partial<Omit<import("@/types/attendance").Shift, "id">>;
    }) =>
      fetchJson<import("@/types/attendance").Shift>(
        id ? `/api/proxy/attendance/shifts/${id}` : `/api/proxy/attendance/shifts`,
        {
          method: id ? "PATCH" : "POST",
          body: JSON.stringify(values),
        }
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

export function useDeleteShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson(`/api/proxy/attendance/shifts/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

export function useShiftAssignments(employee?: number) {
  const params = new URLSearchParams({ page_size: "100" });
  if (employee) params.set("employee", String(employee));
  
  return useQuery({
    queryKey: ["shiftAssignments", employee],
    queryFn: () =>
      fetchJson<PaginatedResponse<import("@/types/attendance").ShiftAssignment>>(`/api/proxy/attendance/shift-assignments?${params.toString()}`),
  });
}

export function useSaveShiftAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id?: number;
      values: Partial<Omit<import("@/types/attendance").ShiftAssignment, "id" | "employee_name">>;
    }) =>
      fetchJson<import("@/types/attendance").ShiftAssignment>(
        id ? `/api/proxy/attendance/shift-assignments/${id}` : `/api/proxy/attendance/shift-assignments`,
        {
          method: id ? "PATCH" : "POST",
          body: JSON.stringify(values),
        }
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shiftAssignments"] }),
  });
}

export function useDeleteShiftAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson(`/api/proxy/attendance/shift-assignments/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shiftAssignments"] }),
  });
}

export function useAttendanceCalendar(start: string, end: string, employee?: number) {
  const params = new URLSearchParams({ start, end });
  if (employee) params.set("employee", String(employee));
  
  return useQuery({
    queryKey: ["attendanceCalendar", start, end, employee],
    queryFn: () => fetchJson<AttendanceCalendar>(`/api/proxy/attendance/calendar?${params.toString()}`),
  });
}

// ── Attendance devices (biometric terminals) ─────────────────────────────

export function useDevices() {
  return useQuery({
    queryKey: ["attendanceDevices"],
    queryFn: () => fetchJson<PaginatedResponse<AttendanceDevice>>("/api/proxy/attendance/devices"),
  });
}

export function useCreateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    // Returns the plaintext token — the only time it is ever available.
    mutationFn: (values: Partial<AttendanceDevice>) =>
      fetchJson<AttendanceDevice>("/api/proxy/attendance/devices", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendanceDevices"] }),
  });
}

export function useUpdateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<AttendanceDevice> }) =>
      fetchJson<AttendanceDevice>(`/api/proxy/attendance/devices/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendanceDevices"] }),
  });
}

export function useRotateDeviceToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<AttendanceDevice>(`/api/proxy/attendance/devices/${id}/rotate-token`, {
        method: "POST",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendanceDevices"] }),
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson(`/api/proxy/attendance/devices/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendanceDevices"] }),
  });
}

/**
 * When people actually arrive. Its own query rather than part of the log list —
 * the list is filtered to whatever the user is looking at, and a distribution
 * that moved with the search would describe the search, not the company.
 */
export function useArrivalTimes() {
  return useQuery({
    queryKey: ["attendance", "arrivals"],
    queryFn: () => fetchJson<ArrivalDistribution>("/api/proxy/attendance/logs/arrivals"),
  });
}

export type PersonAttendanceSummary = {
  days: number;
  recorded: number;
  present: number;
  late: number;
  absent: number;
  half_day: number;
  turned_up: number;
  /** Of the days somebody turned up, how many were on time. Null when there is
   *  nothing to judge — a perfect score for somebody never recorded is a lie. */
  punctuality: number | null;
  /** Mean arrival as HH:MM, over the days there was one. */
  average_arrival: string | null;
};

/**
 * One person's attendance as a reading, for their profile.
 *
 * The tab drew a month grid and nothing else — a grid shows which days had a
 * record and cannot say *nineteen of twenty*, or that the average arrival is
 * eight minutes past. Counted on the server over a window, so it does not
 * collapse to nothing on the first of the month, which is exactly when somebody
 * is most likely to look.
 *
 * Who may read whose is decided by the same queryset the attendance list uses —
 * asking for a colleague's id returns an empty summary rather than their
 * movements.
 */
export function usePersonAttendanceSummary(employeeId?: number | null, days = 30) {
  const params = new URLSearchParams({ days: String(days) });
  if (employeeId != null) params.set("employee", String(employeeId));
  return useQuery({
    queryKey: ["attendance", "person-summary", employeeId ?? "me", days],
    queryFn: () =>
      fetchJson<PersonAttendanceSummary>(
        `/api/proxy/attendance/logs/person-summary?${params.toString()}`,
      ),
    enabled: employeeId !== null,
  });
}
