"use client";

import DownloadIcon from "@mui/icons-material/Download";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import Button from "@mui/material/Button";

import PageHeader from "@/components/shell/PageHeader";
import type { EmployeeListItem } from "@/types/employees";
import { todayIso } from "@/lib/format/period";

function exportEmployeesCsv(employees: EmployeeListItem[]) {
  const header = ["Employee Code", "Name", "Email", "Department", "Designation", "Status"];
  const rows = employees.map((e) => [
    e.employee_code,
    e.full_name,
    e.email,
    e.department_name ?? "",
    e.designation_title ?? "",
    e.employment_status,
  ]);
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `employees-${todayIso()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Search, notifications and profile live in the global TopBar; this header
// keeps its title and the CSV export.
//
// No date chip: `PageHeader`'s orientation band already opens every page with
// today's date, so a chip here prints the same date twenty pixels away. It
// would also have to read `new Date()` during render, which is the hydration
// mismatch the band uses `useSyncExternalStore` to avoid.
export default function DashboardTopBar({ recentEmployees }: { recentEmployees: EmployeeListItem[] }) {
  return (
    <PageHeader
      title="Overview"
      subtitle="Your team at a glance"
      icon={<SpaceDashboardIcon />}
      actions={
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => exportEmployeesCsv(recentEmployees)}>
          Export
        </Button>
      }
    />
  );
}
