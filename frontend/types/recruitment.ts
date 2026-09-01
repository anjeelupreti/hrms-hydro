export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";
export type JobStatus = "draft" | "open" | "closed";
/**
 * Mirrors `Candidate.Stage` on the backend, `"declined"` included: losing
 * somebody to a counter-offer is not the same fact as deciding against them,
 * and merging the two flatters the funnel. A member missing here leaves every
 * screen typed against it formally unaware of a stage the API returns.
 */
export type CandidateStage =
  | "applied"
  | "screening"
  | "interview"
  | "offer"
  | "hired"
  | "declined"
  | "rejected";

export type JobPosting = {
  id: number;
  title: string;
  department: number | null;
  department_name: string | null;
  location: string;
  employment_type: EmploymentType;
  status: JobStatus;
  description: string;
  openings: number;
  salary_min: string | null;
  salary_max: string | null;
  candidate_count: number;
  created_at: string;
};

export type Candidate = {
  id: number;
  job: number;
  job_title: string;
  name: string;
  email: string;
  phone: string;
  stage: CandidateStage;
  rating: number | null;
  source: string;
  interview_at: string | null;
  note_count: number;
  has_resume: boolean;
  created_at: string;
  /** Where the offer stands, carried on the candidate so a board can show it
   *  without one request per card. Null until an offer exists. */
  offer_status: "draft" | "sent" | "accepted" | "declined" | "withdrawn" | "expired" | null;
  offer_expires_on: string | null;
  /** Served, not computed here — a browser comparing against its own clock
   *  disagrees with the server about what has lapsed. Negative means expired. */
  offer_expires_in_days: number | null;
};

export type CandidateNote = {
  id: number;
  body: string;
  author_name: string | null;
  created_at: string;
};

export type RecruitmentSummary = {
  open_positions: number;
  total_candidates: number;
  hired: number;
  by_stage: Partial<Record<CandidateStage, number>>;
};
