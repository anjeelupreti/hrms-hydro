export type WFHStatus = "pending" | "approved" | "rejected" | "cancelled";
export type WorkLocation = "home" | "remote";

export type WFHRequest = {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  department_name: string | null;
  start_date: string;
  end_date: string;
  days: number;
  work_location: WorkLocation;
  location_note: string;
  reason: string;
  status: WFHStatus;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
};

export type WFHSummary = {
  remote_today: WFHRequest[];
  remote_count: number;
  onsite_count: number;
  pending_count: number;
  remote_percent: number;
};
