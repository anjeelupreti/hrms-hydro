export type DeliveryMode = "in_person" | "online" | "hybrid";

export type SessionStatus = "scheduled" | "completed" | "cancelled";

export type EnrollmentStatus =
  | "requested"
  | "enrolled"
  | "completed"
  | "no_show"
  | "cancelled"
  | "declined";

export type TrainingProgram = {
  id: number;
  title: string;
  description: string;
  category: string;
  delivery_mode: DeliveryMode;
  is_active: boolean;
  session_count: number;
};

export type MyEnrollment = { id: number; status: EnrollmentStatus } | null;

export type TrainingSession = {
  id: number;
  program: number;
  program_title: string;
  start_datetime: string;
  end_datetime: string;
  location: string;
  capacity: number;
  trainer: number | null;
  trainer_name: string | null;
  status: SessionStatus;
  seats_taken: number;
  is_full: boolean;
  my_enrollment: MyEnrollment;
};

export type Enrollment = {
  id: number;
  session: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  program_title: string;
  session_start: string;
  session_end: string;
  trainer_name: string | null;
  status: EnrollmentStatus;
  score: number | null;
  feedback: string;
  decided_at: string | null;
  completed_at: string | null;
  certificate_issued_at: string | null;
  has_certificate: boolean;
  created_at: string;
};
