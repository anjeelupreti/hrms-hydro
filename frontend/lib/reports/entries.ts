import type { ReportDefinition } from "@/lib/reports/catalogue";

/**
 * The reports themselves.
 *
 * Split out of `catalogue.ts` once there were fourteen: the types, the group
 * colours and the list were one file and the list is the half that grows every
 * time a module gets a report.
 *
 * `key` is the backend's `?type=`, and `byDepartment` must agree with
 * `DEPARTMENT_FILTERABLE` in `reports/views.py` — a control offered here for a
 * report the server does not filter would appear to work and change nothing.
 */
export const REPORT_ENTRIES: ReportDefinition[] = [
  {
    key: "team",
    name: "Team roster",
    question: "How many people do we have, and where do they sit?",
    group: "People",
    snapshot: true,
    byDepartment: true,
  },
  {
    key: "headcount",
    name: "Headcount movement",
    question: "Who joined, who left, and are we growing?",
    group: "People",
    byDepartment: true,
  },
  {
    key: "recruitment",
    name: "Hiring pipeline",
    question: "Who applied in this period, and where are they now?",
    group: "People",
  },
  {
    key: "attendance",
    name: "Attendance",
    question: "Who was present, late or absent, and how often?",
    group: "Time",
    byDepartment: true,
  },
  {
    key: "leave",
    name: "Leave taken",
    question: "How much leave was approved, and of what kind?",
    group: "Time",
    byDepartment: true,
  },
  {
    key: "wfh",
    name: "Remote work",
    question: "Who worked remotely, and for how many days?",
    group: "Time",
    byDepartment: true,
  },
  {
    key: "timesheets",
    name: "Hours logged",
    question: "How many hours went in, and how much of it was billable?",
    group: "Time",
    byDepartment: true,
  },
  {
    key: "payroll",
    name: "Payroll totals",
    question: "What did each period cost in gross, deductions and net?",
    group: "Money",
  },
  {
    key: "statutory",
    name: "Statutory contributions",
    question: "What must we remit to SSF, PF and CIT, and for whom?",
    group: "Money",
    byDepartment: true,
  },
  {
    key: "expenses",
    name: "Expense claims",
    question: "What was claimed, on what, and how much do we still owe?",
    group: "Money",
    byDepartment: true,
  },
  {
    key: "training",
    name: "Training",
    question: "What is being run, who enrolled, and who finished?",
    group: "Workplace",
    forward: true,
    byDepartment: true,
  },
  {
    key: "assets",
    name: "Asset register",
    question: "What do we own, and who is holding it?",
    group: "Workplace",
    snapshot: true,
  },
  {
    key: "helpdesk",
    name: "Help desk",
    question: "What was raised, what is still open, and how long do we take?",
    group: "Workplace",
    byDepartment: true,
  },
  {
    key: "projects",
    name: "Project tasks",
    question: "What is open, what is overdue, and what has no owner?",
    group: "Workplace",
  },
];
