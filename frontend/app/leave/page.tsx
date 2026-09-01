"use client";

import BeachAccessIcon from "@mui/icons-material/BeachAccess";
import StateChip, { toneFor } from "@/components/common/StateChip";
import DateText from "@/components/common/DateText";
import AddIcon from "@mui/icons-material/Add";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useState } from "react";

import PageContainer from "@/components/shell/PageContainer";
import PeriodMatrix from "@/components/charts/PeriodMatrix";
import SectionCard from "@/components/common/SectionCard";
import PageHeader from "@/components/shell/PageHeader";
import EmployeeLink from "@/components/common/EmployeeLink";
import ExportButton from "@/components/common/ExportButton";
import ApprovalsInbox from "@/components/leave/ApprovalsInbox";
import LeaveRequestDetailDialog from "@/components/leave/LeaveRequestDetailDialog";
import LeaveRequestDialog from "@/components/leave/LeaveRequestDialog";
import LeaveTypeManager from "@/components/leave/LeaveTypeManager";
import {
  useLeaveRequests,
  useLeaveStatusCounts,
  useMyLeaveBalances,
  type LeaveRequestStatus,
  useLeaveTrend,
} from "@/hooks/useLeave";
import { useCan, useMe } from "@/hooks/useMe";
import CountFilterBar from "@/components/common/CountFilterBar";
import SearchField from "@/components/common/SearchField";
import EmptyState from "@/components/common/EmptyState";
import type { LeaveRequest, LeaveStatus } from "@/types/leave";



/**
 * A leave grid that says something when it is empty.
 *
 * MUI's own "No rows" cannot tell *nobody has requested leave* from *this
 * filter matched nothing*, and the first is the screen a new deployment sees —
 * which is the one the product gets judged on.
 */
function LeaveGrid({
  rows,
  columns,
  loading,
  filtered,
  emptyTitle,
  emptyDescription,
  onClear,
  pageSizeOptions,
  initialState,
}: {
  rows: LeaveRequest[];
  columns: GridColDef<LeaveRequest>[];
  loading: boolean;
  filtered?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onClear?: () => void;
  // Named rather than spread: a generic `...props` of DataGrid's own type
  // fights the row-typed columns, and only these two are ever passed.
  pageSizeOptions?: number[];
  initialState?: React.ComponentProps<typeof DataGrid>["initialState"];
}) {
  if (!loading && rows.length === 0) {
    return (
      <EmptyState
        surface
        variant={filtered ? "noResults" : "empty"}
        title={filtered ? "Nothing matches that filter" : emptyTitle}
        description={filtered ? "Try another status." : emptyDescription}
        action={filtered && onClear ? <Button onClick={onClear}>Clear filter</Button> : undefined}
      />
    );
  }
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      loading={loading}
      autoHeight
      disableRowSelectionOnClick
      pageSizeOptions={pageSizeOptions}
      initialState={initialState}
    />
  );
}

export default function LeavePage() {
  const { data: me } = useMe();
  const canManage = useCan("leave.approve");
  const { data: leaveTrend, isLoading: leaveTrendLoading } = useLeaveTrend();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const [detail, setDetail] = useState<LeaveRequest | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LeaveRequestStatus | "">("");

  const { data: balances } = useMyLeaveBalances(me?.employee_id ?? undefined);
  const { data: counts } = useLeaveStatusCounts();
  const { data: myRequests, isLoading: myLoading } = useLeaveRequests({
    page: 1,
    pageSize: 100,
    employee: me?.employee_id ?? undefined,
  });
  // HR management view: everyone's requests (skipped for non-HR).
  // Only HR sees everyone's requests, and the query simply does not run for
  // anyone else — replacing an `employee: -1` sentinel the API answered 400 to.
  const { data: allRequests, isLoading: allLoading } = useLeaveRequests(
    {
      page: 1,
      pageSize: 100,
      search: search || undefined,
      status: status || undefined,
    },
    Boolean(canManage)
  );

  function buildColumns(showRequester: boolean): GridColDef<LeaveRequest>[] {
    return [
      ...(showRequester
        ? [
            {
              field: "employee_name",
              headerName: "Requested by",
              flex: 1,
              minWidth: 170,
              renderCell: (params) => <EmployeeLink id={params.row.employee} name={params.value as string} />,
            } satisfies GridColDef<LeaveRequest>,
          ]
        : []),
      { field: "leave_type_name", headerName: "Type", width: 150 },
      {
        field: "period",
        headerName: "Period",
        flex: 1,
        minWidth: 190,
        sortable: false,
        // `valueGetter` stays the stored Gregorian pair: it is what CSV
        // export and filtering read, and an export is a data file rather
        // than something read in the company's calendar. `renderCell` is
        // the half a person actually looks at.
        valueGetter: (_, row) => `${row.start_date} → ${row.end_date}`,
        renderCell: (params) => (
          <>
            <DateText value={params.row.start_date} format="short" />
            {" → "}
            <DateText value={params.row.end_date} format="short" />
          </>
        ),
      },
      {
        field: "days_requested",
        headerName: "Days",
        width: 90,
        renderCell: (params) => (
          <span>
            {params.value}
            {params.row.half_day ? " ½" : ""}
          </span>
        ),
      },
      {
        field: "is_paid",
        headerName: "Paid",
        width: 90,
        renderCell: (params) => (
          <Chip
            size="small"
            variant="outlined"
            label={params.value ? "Paid" : "Unpaid"}
            color={params.value ? "success" : "default"}
          />
        ),
      },
      {
        field: "status",
        headerName: "Status",
        width: 120,
        renderCell: (params) => (
          <StateChip label={String(params.value)} tone={toneFor(params.value as LeaveStatus)} />
        ),
      },
      {
        field: "actions",
        headerName: "",
        width: 60,
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <IconButton size="small" title="View details" onClick={() => setDetail(params.row)}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
        ),
      },
    ];
  }

  return (
    <PageContainer>
      <PageHeader
        title="Leave"
        subtitle="Requests, balances and approvals"
        icon={<BeachAccessIcon />}
        actions={
          <>
        <Stack direction="row" spacing={1}>
          <ExportButton
            path="leave/requests"
            filters={[
              { type: "daterange", field: "start_date", label: "Start date" },
              {
                type: "select",
                param: "status",
                label: "Status",
                options: [
                  { value: "pending", label: "Pending" },
                  { value: "approved", label: "Approved" },
                  { value: "rejected", label: "Rejected" },
                  { value: "cancelled", label: "Cancelled" },
                ],
              },
            ]}
          />
          {me?.employee_id && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
              Request Leave
            </Button>
          )}
        </Stack>
      
          </>
        }
      />

      <ApprovalsInbox />

      {balances && balances.results.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            My balances
          </Typography>
          <Grid container spacing={2}>
            {balances.results.map((b) => {
              const allocated = Number(b.allocated_days) + Number(b.carried_forward_days);
              const usedPct = allocated ? Math.min(100, Math.round((Number(b.used_days) / allocated) * 100)) : 0;
              return (
                <Grid key={b.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle1">{b.leave_type_name}</Typography>
                      <Typography variant="h5" sx={{ fontWeight: 700 }}>
                        {b.remaining_days} days left
                      </Typography>
                      <LinearProgress variant="determinate" value={usedPct} sx={{ my: 1, height: 6, borderRadius: 3 }} />
                      <Typography variant="body2" color="text.secondary">
                        {b.allocated_days} allocated + {b.carried_forward_days} carried − {b.used_days} used
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}

      {canManage && <LeaveTypeManager />}

      <Box>
        {/* **When, not just how many.** Every other figure on this screen is a
            count as of today. Leave here is strongly seasonal — Dashain and
            Tihar move a large share of the year's days into two months — and a
            roster planned without knowing that is a roster that breaks. Only
            shown to somebody who staffs a team; an employee planning their own
            days does not need the company's shape. */}
        {canManage ? (
          <Box sx={{ mb: 3 }}>
            <SectionCard
              title="When leave is taken"
              subtitle="Approved days by type and month — darker means heavier"
            >
              {leaveTrendLoading ? (
                <Skeleton variant="rounded" height={260} />
              ) : (
                <PeriodMatrix
                  periods={leaveTrend?.months ?? []}
                  series={leaveTrend?.types ?? []}
                  valueFormatter={(v) => `${v ?? 0}d`}
                  emptyTitle="No leave taken yet"
                  emptyDescription="Once requests are approved, this shows which months carry the load — so a rota can be planned around the busy ones."
                />
              )}
            </SectionCard>
          </Box>
        ) : null}

        {canManage ? (
          <>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ mb: 2, alignItems: { sm: "center" }, justifyContent: "space-between" }}
            >
              <Tabs value={tab} onChange={(_, v) => setTab(v)}>
                <Tab label="All requests" />
                <Tab label="My requests" />
              </Tabs>
              {tab === 0 && (
                <SearchField
                  value={search}
                  onChange={setSearch}
                  placeholder="Search requests…"
                  label="Search leave requests by employee, type or reason"
                />
              )}
            </Stack>
            {tab === 0 && (
              <Box sx={{ mb: 2 }}>
                <CountFilterBar
                  ariaLabel="Filter leave requests by status"
                  value={status}
                  onChange={(next) => setStatus(next)}
                  loading={allLoading}
                  options={[
                    { value: "", label: "All", count: counts?.total },
                    { value: "pending", label: "Pending", count: counts?.pending, tone: "warning" },
                    { value: "approved", label: "Approved", count: counts?.approved, tone: "success" },
                    { value: "rejected", label: "Rejected", count: counts?.rejected, tone: "danger" },
                    { value: "cancelled", label: "Cancelled", count: counts?.cancelled },
                  ]}
                />
              </Box>
            )}
            {tab === 0 ? (
              <LeaveGrid
                rows={allRequests?.results ?? []}
                columns={buildColumns(true)}
                loading={allLoading}
                filtered={Boolean(status)}
                onClear={() => setStatus("")}
                emptyTitle="No leave requested yet"
                emptyDescription="When somebody asks for leave it lands here for approval, with their remaining balance beside it."
                initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
                pageSizeOptions={[10, 25, 50]}
              />
            ) : (
              <LeaveGrid
                rows={myRequests?.results ?? []}
                columns={buildColumns(false)}
                loading={myLoading}
                emptyTitle="You have not requested any leave"
                emptyDescription="Your requests appear here with what was decided and who decided it."
              />
            )}
          </>
        ) : (
          <>
            <Typography variant="h6" sx={{ mb: 2 }}>
              My requests
            </Typography>
            <LeaveGrid
              rows={myRequests?.results ?? []}
              columns={buildColumns(false)}
              loading={myLoading}
              emptyTitle="You have not requested any leave"
              emptyDescription="Your requests appear here with what was decided and who decided it."
            />
          </>
        )}
      </Box>

      <LeaveRequestDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      {detail && (
        <LeaveRequestDetailDialog
          request={detail}
          canManage={Boolean(canManage)}
          isOwner={detail.employee === me?.employee_id}
          onClose={() => setDetail(null)}
        />
      )}
    </PageContainer>
  );
}
