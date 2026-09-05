/**
 * Meetings, and everything one produces.
 *
 * `Meeting` is the calendar row (`CompanyEvent` with `event_type=meeting`) —
 * unchanged, and still what the calendar draws. The rest are what happens
 * around it: an agenda that can be changed at any point, a register of who
 * actually came, decisions people put their name to, and the minute.
 */

export type MeetingAttendee = {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  /** A promise made beforehand. */
  rsvp_status: "pending" | "accepted" | "declined";
  /**
   * What happened. Deliberately three states: "we did not take the register"
   * and "they did not come" are different facts.
   */
  attendance: "unmarked" | "present" | "absent";
  attendance_marked_at: string | null;
};

export type AgendaItem = {
  id: number;
  meeting: number;
  order: number;
  title: string;
  detail: string;
  presenter: number | null;
  presenter_name: string | null;
  /** Raised in the room rather than circulated. An item nobody saw in advance
   *  is one people may reasonably not have been ready for. */
  raised_in_meeting: boolean;
};

export type DecisionPosition = {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  position: "pending" | "consent" | "dissent" | "abstain";
  /** The stamp. Consent carries one; dissent never does. */
  signature_url: string | null;
  /** Required on dissent — a dissent that does not say why records nothing. */
  reason: string;
  answered_at: string | null;
};

export type MeetingDecision = {
  id: number;
  meeting: number;
  agenda_item: number | null;
  order: number;
  text: string;
  status: "draft" | "circulated" | "closed";
  circulated_at: string | null;
  positions: DecisionPosition[];
  /** The reader's own position, or null if they were not asked. */
  my_position: DecisionPosition["position"] | null;
  tally: { consent: number; dissent: number; abstain: number; pending: number };
};

export type MeetingMinutes = {
  id: number;
  meeting: number;
  template: number | null;
  template_name: string | null;
  /** `MIN-VLUCL-0007`. Null until the minute is drafted — a meeting nobody
   *  wrote up should not consume a number out of the register. */
  minute_id: string | null;
  company: number | null;
  company_name: string | null;
  company_address: string;
  company_logo: string | null;
  meeting_title: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string;
  /** Derived from start and end, never stored — a duration that disagrees with
   *  them is a fact with two answers. */
  duration_minutes: number | null;
  content: string;
  status: "draft" | "circulated" | "final";
  finalised_at: string | null;
  /** Final is evidence and refuses edits. */
  is_locked: boolean;
};

export type MinutesSection = {
  id: number;
  order: number;
  heading: string;
  /** Where the content comes from. Anything but `manual` is filled in from
   *  what the meeting already knows. */
  source: "manual" | "attendance" | "agenda" | "decisions" | "consent_table";
  hint: string;
};

export type MinutesTemplate = {
  id: number;
  name: string;
  is_default: boolean;
  is_active: boolean;
  sections: MinutesSection[];
};
