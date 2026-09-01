"use client";

import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import HomeWorkIcon from "@mui/icons-material/HomeWork";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import StateChip, { toneFor } from "@/components/common/StateChip";
import DateText from "@/components/common/DateText";
import EmployeeLink from "@/components/common/EmployeeLink";
import ExportButton from "@/components/common/ExportButton";
import PageContainer from "@/components/shell/PageContainer";
import ListPagination from "@/components/common/ListPagination";
import SearchField from "@/components/common/SearchField";
import PageHeader from "@/components/shell/PageHeader";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagedList } from "@/hooks/usePagedList";
import WfhRequestDetailDialog from "@/components/wfh/WfhRequestDetailDialog";
import WfhRequestDialog from "@/components/wfh/WfhRequestDialog";
import CountFilterBar from "@/components/common/CountFilterBar";
import {
  useWfhAction,
  useWfhRequests,
  useWfhStatusCounts,
  useWfhSummary,
  type WfhStatus,
} from "@/hooks/useWfh";
import { useCan, useMe } from "@/hooks/useMe";
import type { WFHRequest } from "@/types/wfh";


export default function WFHPage() {
  const { data: me } = useMe();
  const isHR = useCan("workplace.manage");
  const { data: summary } = useWfhSummary();
  const [status, setStatus] = useState<WfhStatus | "">("");
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query, 300);
  const { page, pageSize, setPage, setPageSize, reset } = usePagedList();
  const { data: requests, isLoading } = useWfhRequests({
    status: status || undefined,
    search: search || undefined,
    page,
    pageSize,
  });

  useEffect(() => {
    reset();
  }, [status, search, reset]);
  const { data: counts } = useWfhStatusCounts();
  const action = useWfhAction();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detail, setDetail] = useState<WFHRequest | null>(null);

  return (
    <PageContainer>
      <PageHeader
        title="Remote Work"
        subtitle="Work-from-home requests and who's remote"
        icon={<HomeWorkIcon />}
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search requests…"
              label="Search remote-work requests by reason, place or person"
            />
            <ExportButton
              path="wfh/requests"
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
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
              Request WFH
            </Button>
          </>
        }
      />

      {/* Hero + availability */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: "100%", background: "var(--hrms-gradient-brand)", color: "common.white" }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Remote today
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.85, mb: 2 }}>
                Live snapshot of the team&apos;s work location
              </Typography>
              <Stack direction="row" spacing={4}>
                <Box>
                  <Typography variant="h3" sx={{ fontWeight: 800 }}>
                    {summary?.remote_count ?? "—"}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.85 }}>
                    Working remotely
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="h3" sx={{ fontWeight: 800 }}>
                    {summary?.onsite_count ?? "—"}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.85 }}>
                    On site
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                Remote share
              </Typography>
              <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                  {summary?.remote_percent ?? 0}% remote today
                </Typography>
                {summary && summary.pending_count > 0 && (
                  <Chip size="small" color="warning" label={`${summary.pending_count} pending`} />
                )}
              </Stack>
              <LinearProgress variant="determinate" value={summary?.remote_percent ?? 0} sx={{ height: 10, borderRadius: 5 }} />
              <Stack spacing={1} sx={{ mt: 2 }}>
                {(summary?.remote_today ?? []).slice(0, 4).map((r) => (
                  <Stack key={r.id} direction="row" sx={{ justifyContent: "space-between" }}>
                    <EmployeeLink id={r.employee} name={r.employee_name} />
                    <Typography variant="caption" color="text.secondary">
                      {r.location_note || (r.work_location === "home" ? "Home" : "Remote")}
                    </Typography>
                  </Stack>
                ))}
                {summary && summary.remote_today.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Nobody&apos;s remote today.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Requests table */}
      <Typography variant="overline" color="text.secondary">
        Requests
      </Typography>
      <Card sx={{ mt: 1 }}>
        <Box sx={{ mb: 2 }}>
          <CountFilterBar
            ariaLabel="Filter remote-work requests by status"
            value={status}
            onChange={(next) => setStatus(next)}
            loading={isLoading}
            options={[
              { value: "", label: "All", count: counts?.total },
              { value: "pending", label: "Pending", count: counts?.pending, tone: "warning" },
              { value: "approved", label: "Approved", count: counts?.approved, tone: "success" },
              { value: "rejected", label: "Rejected", count: counts?.rejected, tone: "danger" },
              { value: "cancelled", label: "Cancelled", count: counts?.cancelled },
            ]}
          />
        </Box>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Period</TableCell>
                <TableCell align="center">Days</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Skeleton height={40} />
                  </TableCell>
                </TableRow>
              )}
              {requests?.results.map((r) => {
                const isOwner = r.employee === me?.employee_id;
                return (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <EmployeeLink id={r.employee} name={r.employee_name} />
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {r.department_name ?? "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <DateText value={r.start_date} format="short" /> –{" "}
                      <DateText value={r.end_date} format="short" />
                    </TableCell>
                    <TableCell align="center">{r.days}</TableCell>
                    <TableCell>{r.location_note || (r.work_location === "home" ? "Home" : "Remote")}</TableCell>
                    <TableCell>
                      <StateChip label={String(r.status)} tone={toneFor(r.status)} />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end", alignItems: "center" }}>
                        {r.status === "pending" && isHR && (
                          <>
                            <Button size="small" startIcon={<CheckIcon />} onClick={() => action.mutate({ id: r.id, action: "approve" })}>
                              Approve
                            </Button>
                            <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => action.mutate({ id: r.id, action: "reject" })}>
                              Reject
                            </Button>
                          </>
                        )}
                        {r.status === "pending" && isOwner && (
                          <Button size="small" color="inherit" onClick={() => action.mutate({ id: r.id, action: "cancel" })}>
                            Cancel
                          </Button>
                        )}
                        <IconButton size="small" title="More info" onClick={() => setDetail(r)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && requests?.results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                      No WFH requests yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

      <ListPagination
        page={page}
        pageSize={pageSize}
        count={requests?.count ?? 0}
        noun="requests"
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
      </Card>

      <WfhRequestDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      {detail && (
        <WfhRequestDetailDialog
          request={detail}
          canDecide={Boolean(isHR)}
          isOwner={detail.employee === me?.employee_id}
          onClose={() => setDetail(null)}
        />
      )}
    </PageContainer>
  );
}
