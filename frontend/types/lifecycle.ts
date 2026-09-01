export type LifecycleEventType = "promotion" | "award" | "resignation" | "termination" | "transfer";
export type LifecycleEventStatus = "pending_approval" | "approved" | "rejected" | "cancelled" | "applied";

export type LifecycleEvent = {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  event_type: LifecycleEventType;
  status: LifecycleEventStatus;
  effective_date: string;
  reason: string;
  new_designation: number | null;
  new_designation_title: string | null;
  new_department: number | null;
  new_department_name: string | null;
  new_manager: number | null;
  new_manager_name: string | null;
  award_title: string;
  last_working_date: string | null;
  applied_at: string | null;
  created_at: string;
};

export type LifecycleApprovalAction = {
  id: number;
  decision: "approved" | "rejected";
  comment: string;
  actor_name: string | null;
  created_at: string;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
