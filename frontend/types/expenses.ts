export type ExpenseCategory = "travel" | "meals" | "supplies" | "software" | "training" | "other";
export type ExpenseStatus = "pending" | "approved" | "rejected" | "reimbursed" | "cancelled";

export type ExpenseClaim = {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  department_name: string | null;
  title: string;
  category: ExpenseCategory;
  amount: string;
  expense_date: string;
  description: string;
  receipt_url: boolean;
  status: ExpenseStatus;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
  reimbursed_at: string | null;
  reimbursement_reference: string;
  created_at: string;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
