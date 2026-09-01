"use client";

import TimelineIcon from "@mui/icons-material/Timeline";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import Link from "next/link";

import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import EmployeeLink from "@/components/common/EmployeeLink";
import LifecycleApprovalsInbox from "@/components/employees/LifecycleApprovalsInbox";
import { useLifecycleEvents } from "@/hooks/useLifecycle";
import { useCan } from "@/hooks/useMe";
import type { LifecycleEvent, LifecycleEventStatus } from "@/types/lifecycle";
import SearchField from "@/components/common/SearchField";
import { useTextFilter } from "@/hooks/useTextFilter";

const STATUS_COLOR: Record<LifecycleEventStatus, "warning" | "info" | "error" | "default" | "success"> = {
  pending_approval: "warning",
  approved: "info",
  rejected: "error",
  cancelled: "default",
  applied: "success",
};

const EVENT_LABELS: Record<string, string> = {
  promotion: "Promotion",
  award: "Award",
  resignation: "Resignation",
  termination: "Termination",
  transfer: "Transfer",
};

export default function LifecycleEventsPage() {
  const isHR = useCan("people.manage");
  // Backend already scopes non-HR users to their own events + direct
  // reports' — no employee filter needed here.
  const { data: events, isLoading } = useLifecycleEvents();

  const columns: GridColDef<LifecycleEvent>[] = [
    {
      field: "employee_name",
      headerName: "Employee",
      flex: 1,
      minWidth: 160,
      renderCell: (params) => <EmployeeLink id={params.row.employee} name={params.value as string} />,
    },
    {
      field: "event_type",
      headerName: "Event",
      width: 140,
      valueFormatter: (value: string) => EVENT_LABELS[value] ?? value,
    },
    { field: "effective_date", headerName: "Effective", width: 120 },
    {
      field: "status",
      headerName: "Status",
      width: 150,
      renderCell: (params) => (
        <Chip size="small" label={params.value.replace("_", " ")} color={STATUS_COLOR[params.value as LifecycleEventStatus]} />
      ),
    },
    { field: "reason", headerName: "Reason", flex: 1, minWidth: 160 },
  ];

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(
    events?.results ?? [],
    (e) => [e.employee_name, e.event_type, e.status, e.reason, e.effective_date]
  );

  return (
    <PageContainer>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <IconButton component={Link} href="/employees" size="small">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" color="text.secondary">
          Employees
        </Typography>
      </Stack>
      <PageHeader
        title="Lifecycle events"
        subtitle="Promotions, transfers, awards and exits"
        icon={<TimelineIcon />}
      />

      {isHR && <LifecycleApprovalsInbox />}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ mb: 2, alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Typography variant="h6">{isHR ? "All events" : "My events"}</Typography>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search events…"
          label="Search lifecycle events by employee, type, status or reason"
        />
      </Stack>
      <DataGrid
        rows={filtered}
        columns={columns}
        loading={isLoading}
        disableRowSelectionOnClick
        autoHeight
        localeText={{ noRowsLabel: isEmptyResult ? `No events match “${query}”.` : "No lifecycle events yet." }}
      />
    </PageContainer>
  );
}
