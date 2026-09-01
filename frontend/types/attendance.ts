// `AttendanceSession` lives with the clock hook that first needed it; this
// imports rather than redeclaring, so the two cannot drift.
import type { AttendanceSession } from "@/hooks/useAttendance";

export type AttendanceSource = "web" | "manual" | "biometric" | "system";
export type AttendanceStatus = "present" | "late" | "absent" | "half_day";

export type AttendanceLog = {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  source: AttendanceSource;
  status: AttendanceStatus;
  notes: string;
  /** Every in-and-out of the day. `check_in_time` and `check_out_time` above
   *  are only the *first* in and the *last* out, so a day with a lunch break
   *  looks identical to one worked straight through until you read these. */
  sessions: AttendanceSession[];
  /** Closed sessions only, so it does not change between two reads. This is
   *  the number that differs from last-minus-first when somebody left and came
   *  back. */
  seconds_worked: number;
};

export type AttendanceEditLogEntry = {
  id: number;
  field: "check_in_time" | "check_out_time" | "status";
  from_value: string;
  to_value: string;
  actor_name: string | null;
  created_at: string;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type Shift = {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  grace_period_minutes: number;
};

export type ShiftAssignment = {
  id: number;
  employee: number;
  employee_name?: string;
  shift: number;
  start_date: string;
  end_date: string | null;
};

export type AttendanceDevice = {
  id: number;
  name: string;
  serial: string;
  device_type: "zkteco" | "hikvision" | "generic";
  device_type_label: string;
  ip_address: string | null;
  port: number | null;
  timezone_name: string;
  location: string;
  is_active: boolean;
  last_seen_at: string | null;
  event_count: number;
  created_at: string;
  /** Present ONLY in the create and rotate responses — never on read. */
  token?: string;
};

/** Shape of `GET /attendance/calendar` — employees down, days across. */
export type AttendanceCalendarCell = {
  employee: number;
  date: string;
  status: string;
};

export type AttendanceCalendarEmployee = {
  id: number;
  full_name: string;
};

export type AttendanceCalendar = {
  employees: AttendanceCalendarEmployee[];
  cells: AttendanceCalendarCell[];
};
