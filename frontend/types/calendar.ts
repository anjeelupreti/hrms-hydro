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
};

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
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
