import type { DeliveryMode, EnrollmentStatus, SessionStatus } from "@/types/training";

type ChipColor = "default" | "primary" | "info" | "success" | "warning" | "error";

export const ENROLLMENT_META: Record<EnrollmentStatus, { label: string; color: ChipColor }> = {
  requested: { label: "Requested", color: "warning" },
  enrolled: { label: "Enrolled", color: "info" },
  completed: { label: "Completed", color: "success" },
  no_show: { label: "No show", color: "error" },
  cancelled: { label: "Cancelled", color: "default" },
  declined: { label: "Declined", color: "error" },
};

export const SESSION_META: Record<SessionStatus, { label: string; color: ChipColor }> = {
  scheduled: { label: "Scheduled", color: "info" },
  completed: { label: "Completed", color: "success" },
  cancelled: { label: "Cancelled", color: "default" },
};

export const DELIVERY_LABEL: Record<DeliveryMode, string> = {
  in_person: "In person",
  online: "Online",
  hybrid: "Hybrid",
};

export function formatSessionTime(startISO: string, endISO: string) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const date = start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${t(start)}–${t(end)}`;
}
