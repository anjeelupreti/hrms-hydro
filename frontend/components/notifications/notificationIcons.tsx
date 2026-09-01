import BeachAccessIcon from "@mui/icons-material/BeachAccess";
import CakeIcon from "@mui/icons-material/Cake";
import CampaignIcon from "@mui/icons-material/Campaign";
import CelebrationIcon from "@mui/icons-material/Celebration";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EventIcon from "@mui/icons-material/Event";
import GroupsIcon from "@mui/icons-material/Groups";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import NotificationsIcon from "@mui/icons-material/Notifications";
import PaymentsIcon from "@mui/icons-material/Payments";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import HomeWorkIcon from "@mui/icons-material/HomeWork";
import HistoryEduIcon from "@mui/icons-material/HistoryEdu";
import ReviewsIcon from "@mui/icons-material/Reviews";
import SchoolIcon from "@mui/icons-material/School";
import TimelineIcon from "@mui/icons-material/Timeline";
import type { SvgIconComponent } from "@mui/icons-material";

type IconSpec = {
  icon: SvgIconComponent;
  color: "primary" | "secondary" | "success" | "warning" | "error" | "info";
};

// Keyed by the `verb` every notify() call passes (see
// backend/notifications/services.py) — one small, explicit map rather
// than trying to derive an icon from free-text `message`.
const VERB_ICONS: Record<string, IconSpec> = {
  leave_requested: { icon: BeachAccessIcon, color: "warning" },
  leave_approved: { icon: BeachAccessIcon, color: "success" },
  leave_rejected: { icon: BeachAccessIcon, color: "error" },
  lifecycle_event_pending: { icon: HourglassTopIcon, color: "warning" },
  lifecycle_event_approved: { icon: TimelineIcon, color: "success" },
  lifecycle_event_rejected: { icon: TimelineIcon, color: "error" },
  lifecycle_event_applied: { icon: CheckCircleIcon, color: "success" },
  payroll_draft_created: { icon: PaymentsIcon, color: "info" },
  payslip_finalized: { icon: ReceiptLongIcon, color: "success" },
  birthday: { icon: CakeIcon, color: "secondary" },
  birthday_report: { icon: CakeIcon, color: "secondary" },
  work_anniversary: { icon: CelebrationIcon, color: "secondary" },
  holiday: { icon: EventIcon, color: "info" },
  review_cycle_started: { icon: ReviewsIcon, color: "info" },
  review_pending_manager: { icon: ReviewsIcon, color: "warning" },
  review_completed: { icon: ReviewsIcon, color: "success" },
  meeting_invited: { icon: GroupsIcon, color: "info" },
  announcement_posted: { icon: CampaignIcon, color: "primary" },
  training_requested: { icon: SchoolIcon, color: "warning" },
  training_enrolled: { icon: SchoolIcon, color: "success" },
  training_declined: { icon: SchoolIcon, color: "error" },
  training_completed: { icon: SchoolIcon, color: "success" },
  training_certificate: { icon: SchoolIcon, color: "success" },
  document_signature_requested: { icon: HistoryEduIcon, color: "warning" },
  document_signed: { icon: HistoryEduIcon, color: "success" },
  document_signature_declined: { icon: HistoryEduIcon, color: "error" },
  expense_submitted: { icon: ReceiptLongIcon, color: "warning" },
  expense_approved: { icon: ReceiptLongIcon, color: "success" },
  expense_rejected: { icon: ReceiptLongIcon, color: "error" },
  expense_reimbursed: { icon: ReceiptLongIcon, color: "success" },
  wfh_requested: { icon: HomeWorkIcon, color: "warning" },
  wfh_approved: { icon: HomeWorkIcon, color: "success" },
  wfh_rejected: { icon: HomeWorkIcon, color: "error" },
};

export function getNotificationIconSpec(verb: string): IconSpec {
  return VERB_ICONS[verb] ?? { icon: NotificationsIcon, color: "primary" };
}
