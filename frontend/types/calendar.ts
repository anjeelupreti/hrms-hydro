export type AttendanceCalendarCell = {
  employee: number;
  date: string;
  status: "present" | "late" | "absent" | "half_day" | "on_leave" | "holiday";
};

export type AttendanceCalendarEmployee = {
  id: number;
  employee_code: string;
  full_name: string;
};

export type AttendanceCalendarHoliday = {
  date: string;
  name: string;
};

export type AttendanceCalendarResponse = {
  employees: AttendanceCalendarEmployee[];
  holidays: AttendanceCalendarHoliday[];
  cells: AttendanceCalendarCell[];
};

export type CompanyEventType = "meeting" | "interview" | "announcement" | "other";

export type RsvpStatus = "pending" | "accepted" | "declined";

export type MeetingAttendee = {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  rsvp_status: RsvpStatus;
  /** Who actually came, which is not who accepted. `unmarked` means nobody
   *  took the register — a different fact from "did not come". */
  attendance?: "unmarked" | "present" | "absent";
};

/** Where a meeting is in its life. Derived server-side: `ended` is simply a
 *  past end time, so no meeting is in the wrong bucket because nobody pressed
 *  a button. */
export type MeetingState = "scheduled" | "ended" | "cancelled";

export type CompanyEvent = {
  id: number;
  title: string;
  description: string;
  event_type: CompanyEventType;
  start_datetime: string;
  end_datetime: string;
  all_day: boolean;
  location: string;
  attendees: MeetingAttendee[];
  status?: "scheduled" | "cancelled";
  state?: MeetingState;
  cancelled_at?: string | null;
  cancellation_reason?: string;
  company?: number | null;
  company_name?: string | null;
  duration_minutes?: number | null;
  organiser_name?: string | null;
  /** Whether the reader called this meeting. The organiser may cancel it, take
   *  the register and write the minute; an invitee may not. */
  is_organiser?: boolean;
  agenda_count?: number;
  decision_count?: number;
  attendance_taken?: boolean;
  minute_status?: "draft" | "circulated" | "final" | null;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
