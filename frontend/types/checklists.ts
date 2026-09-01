export type ChecklistKind = "onboarding" | "offboarding";
export type TaskStatus = "pending" | "done";

export type ChecklistTemplateItem = {
  id?: number;
  title: string;
  description?: string;
  order: number;
  due_offset_days: number;
};

export type ChecklistTemplate = {
  id: number;
  name: string;
  kind: ChecklistKind;
  description: string;
  is_active: boolean;
  items: ChecklistTemplateItem[];
  item_count: number;
  created_at: string;
};

export type ChecklistTask = {
  id: number;
  title: string;
  description: string;
  order: number;
  assignee: number | null;
  assignee_name: string | null;
  due_date: string | null;
  status: TaskStatus;
  completed_at: string | null;
};

export type Checklist = {
  id: number;
  employee: number;
  employee_name: string | null;
  kind: ChecklistKind;
  template: number | null;
  title: string;
  status: "active" | "completed" | "cancelled";
  tasks: ChecklistTask[];
  progress: { done: number; total: number; pct: number };
  created_at: string;
};

export type MyChecklistTask = {
  id: number;
  title: string;
  description: string;
  due_date: string | null;
  status: TaskStatus;
  checklist_id: number;
  checklist_title: string;
  for_employee: string | null;
};
