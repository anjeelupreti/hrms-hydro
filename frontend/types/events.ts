/**
 * Company events — the things that happen, who is in them, and the paperwork.
 *
 * Not the same as a meeting. A meeting is a slot in somebody's day with an
 * invitee list; an event here is a thing the company *did* — a board meeting, a
 * commissioning ceremony, a safety drill, a public hearing with the district,
 * an audit visit. It has a subject matter rather than an agenda, stakeholders
 * rather than attendees, and the reason anybody opens it six months later is
 * the minutes and the photographs attached to it.
 */

export type EventKind =
  | "meeting"
  | "board"
  | "agm"
  | "ceremony"
  | "training"
  | "drill"
  | "inspection"
  | "public"
  | "site_visit"
  | "other";

export const EVENT_KINDS: { value: EventKind; label: string }[] = [
  { value: "meeting", label: "Meeting" },
  { value: "board", label: "Board meeting" },
  { value: "agm", label: "General meeting" },
  { value: "ceremony", label: "Ceremony" },
  { value: "training", label: "Training" },
  { value: "drill", label: "Drill / safety exercise" },
  { value: "inspection", label: "Inspection / audit" },
  { value: "public", label: "Public / community" },
  { value: "site_visit", label: "Site visit" },
  { value: "other", label: "Other" },
];

export type EventStatus = "planned" | "confirmed" | "completed" | "cancelled" | "postponed";

export const EVENT_STATUSES: { value: EventStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "postponed", label: "Postponed" },
];

export type StakeholderRole =
  | "attendee"
  | "chair"
  | "speaker"
  | "organiser"
  | "guest"
  | "observer";

export const STAKEHOLDER_ROLES: { value: StakeholderRole; label: string }[] = [
  { value: "attendee", label: "Attendee" },
  { value: "chair", label: "Chair" },
  { value: "speaker", label: "Speaker" },
  { value: "organiser", label: "Organiser" },
  { value: "guest", label: "Guest" },
  { value: "observer", label: "Observer" },
];

/**
 * Somebody in the room.
 *
 * **Name first, employee second.** Most events in this industry involve people
 * the HRMS has never heard of — a ward chair, a contractor's foreman, an
 * inspector from the department. Picking an employee fills the name in;
 * clearing the link leaves the name behind, because a stakeholder list is a
 * historical document.
 */
export type EventStakeholder = {
  id: number;
  event: number;
  employee: number | null;
  name: string;
  employee_code: string;
  organisation: string;
  role: StakeholderRole;
  role_display: string;
  email: string;
  phone: string;
  /** Null until the event has happened. */
  attended: boolean | null;
  note: string;
};

export type EventAttachment = {
  id: number;
  event: number;
  file: string;
  file_url: string | null;
  caption: string;
  uploaded_by_name: string | null;
  created_at: string;
};

export type EventListItem = {
  id: number;
  title: string;
  kind: EventKind;
  kind_display: string;
  status: EventStatus;
  status_display: string;
  /** What it was *about*, as distinct from what it was called. Six months later
   *  this is what somebody searches for. */
  subject_matter: string;
  starts_at: string;
  ends_at: string | null;
  is_all_day: boolean;
  location: string;
  company: number | null;
  company_name: string | null;
  organiser: number | null;
  organiser_name: string | null;
  stakeholder_count: number;
  attachment_count: number;
  is_past: boolean;
};

export type CompanyEvent = EventListItem & {
  description: string;
  /** Written afterwards. Separate from `description`, which is written before:
   *  one is what we intend to do, the other is what happened. */
  outcome: string;
  stakeholders: EventStakeholder[];
  attachments: EventAttachment[];
  created_at: string;
  updated_at: string;
};

export type EventTimeline = {
  upcoming: EventListItem[];
  past: EventListItem[];
  upcoming_total: number;
  past_total: number;
};

export type EventFormValues = {
  title: string;
  kind: EventKind;
  status: EventStatus;
  subject_matter: string;
  description: string;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  location: string;
  company: number | null;
  organiser: number | null;
  outcome: string;
};
