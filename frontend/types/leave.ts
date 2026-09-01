export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export type LeaveType = {
  id: number;
  name: string;
  code: string;
  is_paid: boolean;
  annual_quota_days: string;
  carry_forward_allowed: boolean;
  max_carry_forward_days: string;
  /** Retired types stay listed (old requests still need the name) but are not
      offered on new requests. */
  is_active: boolean;
};

export type LeaveBalance = {
  id: number;
  employee: number;
  leave_type: number;
  leave_type_name: string;
  year: number;
  allocated_days: string;
  carried_forward_days: string;
  used_days: string;
  remaining_days: string;
};

export type LeaveRequest = {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  leave_type: number;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  half_day: boolean;
  days_requested: string;
  reason: string;
  status: LeaveStatus;
  is_paid: boolean;
  exceeds_balance: boolean;
  current_step: number;
};

export type ApprovalActionEntry = {
  id: number;
  step_sequence: number;
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
