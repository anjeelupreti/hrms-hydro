/**
 * Memoranda — the note that travels up the office and comes back signed.
 *
 * See `backend/memoranda/models.py` for what the workflow is and why. The
 * shapes here mirror it; the one thing worth repeating is that **what the
 * reader may do is decided by the server** — `can_act`, `can_edit_content`,
 * `can_edit_chain` and `return_targets` all come down with the record, so the
 * browser never re-derives a rule the workflow owns.
 */

export type MemorandumEffect = "proceed" | "return";

export type MemorandumAction = {
  id: number;
  name: string;
  code: string;
  /** The only thing the machinery reads. The name is what appears in the log. */
  effect: MemorandumEffect;
  effect_display: string;
  description: string;
  order: number;
  is_active: boolean;
  /** "Recommended" is not something an approver says. */
  for_approver: boolean;
};

export type MemorandumStatus = "draft" | "in_progress" | "approved" | "rejected";
export type MemorandumStage = "draft" | "recommend" | "approve" | "closed";

export type MemorandumRecommender = {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  designation: string | null;
  order: number;
  /** Has handled it at some point — read from the log, and the reason the chip
   *  is locked in the editor rather than merely refused on save. */
  has_acted: boolean;
  is_current: boolean;
};

export type MemorandumAttachment = {
  id: number;
  memorandum: number;
  /**
   * The comment this file came in on, or `null` for one of the memorandum's
   * own annexes.
   *
   * The two are the same object and differ only in when they may be added:
   * annexes are part of the proposal and freeze at submission, a file on a
   * comment is somebody answering a question raised mid-flight.
   */
  event: number | null;
  file: string;
  file_url: string | null;
  caption: string;
  uploaded_by_name: string | null;
  created_at: string;
};

export type MemorandumEventKind =
  | "created"
  | "submitted"
  | "proceeded"
  | "returned"
  | "resubmitted"
  | "approved"
  | "rejected"
  | "edited"
  | "commented";

export type MemorandumEvent = {
  id: number;
  kind: MemorandumEventKind;
  kind_display: string;
  /** Frozen at write time — a person can be renamed and the log has to keep
   *  saying what it said on the day. */
  actor_label: string;
  role: string;
  action: number | null;
  action_label: string;
  comment: string;
  /** People named in the comment. Being named lets them read the memorandum
   *  and notifies them; it grants nothing else. */
  mentions: { id: number; name: string; employee_code: string }[];
  /** Files that arrived with this comment. */
  attachments: MemorandumAttachment[];
  returned_to: number | null;
  returned_to_name: string | null;
  created_at: string;
};

export type MemorandumListItem = {
  id: number;
  /** `yyyy-mm-dd-CODE-000n`. Null until it is submitted — an abandoned draft
   *  must not consume a number out of the company's register. */
  memo_id: string | null;
  subject: string;
  memo_date: string;
  company: number;
  company_name: string;
  company_code: string;
  /** The seat, for the letterhead. A letterhead with no address is not one. */
  company_address: string;
  status: MemorandumStatus;
  status_display: string;
  stage: MemorandumStage;
  stage_display: string;
  initiator: number;
  initiator_name: string;
  /** The office they hold, for the From line. A memorandum addresses a chair
   *  as much as a person. */
  initiator_post: string;
  approver: number | null;
  approver_name: string | null;
  /** The office the approver holds, for the To line. */
  approver_post: string;
  current_holder: number | null;
  current_holder_name: string | null;
  current_index: number;
  attachment_count: number;
  recommender_count: number;
  is_locked: boolean;
  submitted_at: string | null;
  decided_at: string | null;
  created_at: string;
};

export type ReturnTarget = {
  id: number;
  name: string;
  is_initiator: boolean;
};

export type Memorandum = MemorandumListItem & {
  /** Sanitised HTML. The one field that survives submission, until a decision. */
  content: string;
  serial_number: number | null;
  recommenders: MemorandumRecommender[];
  attachments: MemorandumAttachment[];
  events: MemorandumEvent[];
  my_role: string;
  can_act: boolean;
  can_edit_content: boolean;
  can_edit_chain: boolean;
  return_targets: ReturnTarget[];
  updated_at: string;
};

export type MemorandumDesk = {
  /** Needs this person's action right now. The top of the page. */
  awaiting_me: MemorandumListItem[];
  /** Raised by them, wherever it has got to. */
  mine: MemorandumListItem[];
  /** Anything they have put a word on, whatever became of it. */
  handled: MemorandumListItem[];
};

export type MemorandumFormValues = {
  company: number | null;
  memo_date: string;
  subject: string;
  content: string;
  approver: number | null;
  recommender_ids: number[];
};

export const MEMO_STATUS_TONE: Record<
  MemorandumStatus,
  "normal" | "caution" | "alarm" | "muted"
> = {
  draft: "muted",
  in_progress: "caution",
  approved: "normal",
  rejected: "alarm",
};
