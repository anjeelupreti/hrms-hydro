import type { CandidateStage, EmploymentType, JobStatus } from "@/types/recruitment";

type ChipColor = "default" | "primary" | "info" | "success" | "warning" | "error" | "secondary";

export const STAGE_ORDER: CandidateStage[] = [
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
];

/**
 * Every member of `CandidateStage` needs an entry: a missing one yields
 * `undefined` here and renders a chip with no label and no colour, which
 * TypeScript cannot catch if the union is missing the member too.
 *
 * **Amber, not red.** Rejected is a decision the company made and declined is
 * one the candidate made — painting them the same colour is the funnel-
 * flattering conflation the backend's `Stage` comment exists to prevent.
 */
export const STAGE_META: Record<CandidateStage, { label: string; color: ChipColor }> = {
  applied: { label: "Applied", color: "default" },
  screening: { label: "Screening", color: "info" },
  interview: { label: "Interview", color: "secondary" },
  offer: { label: "Offer", color: "warning" },
  hired: { label: "Hired", color: "success" },
  declined: { label: "Declined our offer", color: "warning" },
  rejected: { label: "Rejected", color: "error" },
};

export const JOB_STATUS_META: Record<JobStatus, { label: string; color: ChipColor }> = {
  draft: { label: "Draft", color: "default" },
  open: { label: "Open", color: "success" },
  closed: { label: "Closed", color: "error" },
};

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  internship: "Internship",
};

export function salaryRange(min: string | null, max: string | null): string {
  const fmt = (v: string) => `Rs ${Number(v).toLocaleString()}`;
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `from ${fmt(min)}`;
  if (max) return `up to ${fmt(max)}`;
  return "—";
}
