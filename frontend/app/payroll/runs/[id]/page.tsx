"use client";

import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditNoteIcon from "@mui/icons-material/EditNote";
import PaidIcon from "@mui/icons-material/Paid";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { money } from "@/lib/format/money";
import DisbursementPanel from "@/components/payroll/DisbursementPanel";
import Amount from "@/components/common/Amount";
import DownloadButton from "@/components/common/DownloadButton";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import EmployeeLink from "@/components/common/EmployeeLink";
import PayslipDetailDialog from "@/components/payroll/PayslipDetailDialog";
import { useCan } from "@/hooks/useMe";
import {
  useFinalizePayrollRun,
  useMarkAllPayslipsPaid,
  useMarkPayslipPaid,
  usePayrollRun,
  usePayslips,
  usePayslipStatusCounts,
  useStartPayrollRun,
} from "@/hooks/usePayroll";
import CountFilterBar from "@/components/common/CountFilterBar";
import RecordGrid, { type RecordView } from "@/components/common/RecordGrid";
import SearchField from "@/components/common/SearchField";
import ViewSwitch, { useViewMode } from "@/components/common/ViewSwitch";
import type { Payslip, PayrollRunStatus } from "@/types/payroll";

const STATUS_COLOR: Record<PayrollRunStatus, "default" | "info" | "success" | "error"> = {
  draft: "default",
  processing: "info",
  completed: "success",
  failed: "error",
};

const PAYSLIP_STATUS_COLOR = { draft: "default", finalized: "info", paid: "success" } as const;

export default function PayrollRunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = Number(params.id);

  const { data: run } = usePayrollRun(runId);
  // Search, status and ordering are the payslip viewset's, not a second copy
  // of them here: `/runs/{id}/payslips` returns the whole run unfiltered, and
  // teaching it to search would be the same filter config written twice.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | Payslip["status"]>("");
  const { mode: view, setMode: setView } = useViewMode("run-payslips", "table");
  const { data: page, isLoading } = usePayslips({
    payroll_run: runId,
    search,
    status: statusFilter || undefined,
  });
  const payslips = page?.results;
  const { data: counts } = usePayslipStatusCounts(runId);
  const canManage = useCan("payroll.run");
  const startRun = useStartPayrollRun();
  const finalizeRun = useFinalizePayrollRun();
  const markPaid = useMarkPayslipPaid();
  const markAllPaid = useMarkAllPayslipsPaid();

  const [detailPayslip, setDetailPayslip] = useState<Payslip | null>(null);
  const [payDialogPayslip, setPayDialogPayslip] = useState<Payslip | null>(null);
  const [markAllOpen, setMarkAllOpen] = useState(false);
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");

  const finalizedCount = (payslips ?? []).filter((p) => p.status === "finalized").length;

  async function handleMarkAllPaid() {
    setError(null);
    try {
      await markAllPaid.mutateAsync({ runId, disbursement_method: method, disbursement_reference: reference });
      setMarkAllOpen(false);
      setReference("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }
  const [error, setError] = useState<string | null>(null);

  async function handleMarkPaid() {
    if (!payDialogPayslip) return;
    setError(null);
    try {
      await markPaid.mutateAsync({
        id: payDialogPayslip.id,
        disbursement_method: method,
        disbursement_reference: reference,
      });
      setPayDialogPayslip(null);
      setReference("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  // The same payslip as a card or a compact row. Facts are the three numbers a
  // payslip is read for; name and code carry the identity.
  const payslipRecord: RecordView<Payslip> = {
    key: (slip) => slip.id,
    person: (slip) => ({ name: slip.employee_name, photo: slip.employee_photo }),
    title: (slip) => slip.employee_name,
    subtitle: (slip) => slip.employee_code,
    badge: (slip) => (
      <Chip size="small" label={slip.status} color={PAYSLIP_STATUS_COLOR[slip.status]} />
    ),
    facts: (slip) => [
      { label: "Gross", value: <Amount value={money(slip.gross_earnings)} /> },
      { label: "Deductions", value: <Amount value={money(slip.total_deductions)} /> },
      { label: "Net", value: <Amount value={money(slip.net_pay)} /> },
    ],
    onOpen: (slip) => setDetailPayslip(slip),
  };

  const columns: GridColDef<Payslip>[] = [
    { field: "employee_code", headerName: "Code", width: 100 },
    {
      field: "employee_name",
      headerName: "Employee",
      flex: 1,
      minWidth: 160,
      renderCell: (params) => <EmployeeLink id={params.row.employee} name={params.value as string} />,
    },
    {
      field: "payable_days",
      headerName: "Days",
      width: 90,
      renderCell: (params) => {
        const { payable_days, period_days } = params.row;
        if (!period_days) return "—";
        const partial = payable_days < period_days;
        return (
          <Chip
            size="small"
            variant={partial ? "filled" : "outlined"}
            color={partial ? "warning" : "default"}
            label={`${payable_days}/${period_days}`}
            title={partial ? "Prorated — paid for part of the month" : "Full month"}
          />
        );
      },
    },
    { field: "gross_earnings", headerName: "Gross", width: 120 },
    { field: "total_deductions", headerName: "Deductions", width: 120 },
    { field: "net_pay", headerName: "Net Pay", width: 120 },
    {
      field: "status",
      headerName: "Status",
      width: 110,
      renderCell: (params) => (
        <Chip size="small" label={params.value} color={PAYSLIP_STATUS_COLOR[params.value as Payslip["status"]]} />
      ),
    },
    {
      field: "actions",
      headerName: "",
      width: 260,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <IconButton
            size="small"
            title={canManage && params.row.status === "draft" ? "Preview & edit" : "Preview"}
            onClick={() => setDetailPayslip(params.row)}
          >
            {canManage && params.row.status === "draft" ? (
              <EditNoteIcon fontSize="small" />
            ) : (
              <VisibilityIcon fontSize="small" />
            )}
          </IconButton>
          <DownloadButton
            iconOnly
            title="Download PDF"
            url={`/api/proxy/payroll/payslips/${params.row.id}/download`}
            filename={`payslip-${params.row.id}.pdf`}
          >
            Payslip
          </DownloadButton>
          {params.row.status === "finalized" && (
            <Button size="small" startIcon={<PaidIcon />} onClick={() => setPayDialogPayslip(params.row)}>
              Mark paid
            </Button>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 4 } }}>
      <Breadcrumbs />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <IconButton component={Link} href="/payroll" size="small">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" color="text.secondary">
          Payroll
        </Typography>
      </Stack>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ mb: 3, justifyContent: "space-between", alignItems: { xs: "stretch", sm: "center" } }}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography variant="h4" component="h1">
            {run ? `${run.period_year}-${String(run.period_month).padStart(2, "0")}` : "Payroll Run"}
          </Typography>
          {run && <Chip label={run.status} color={STATUS_COLOR[run.status]} />}
        </Stack>
        <Stack direction="row" spacing={1}>
          {run?.status === "draft" && (
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => startRun.mutate(runId)}
              disabled={startRun.isPending}
            >
              Run Payroll
            </Button>
          )}
          {run?.status === "completed" && (
            <Button
              variant="contained"
              color="secondary"
              startIcon={<TaskAltIcon />}
              onClick={() => finalizeRun.mutate(runId)}
              disabled={finalizeRun.isPending}
            >
              Finalize
            </Button>
          )}
          {canManage && (payslips ?? []).length > 0 && (
            <Button
              component="a"
              href={`/api/proxy/payroll/runs/${runId}/bank-file`}
              target="_blank"
              startIcon={<AccountBalanceIcon />}
            >
              Bank file
            </Button>
          )}
          {canManage && finalizedCount > 0 && (
            <Button variant="contained" startIcon={<PaidIcon />} onClick={() => setMarkAllOpen(true)}>
              Mark all paid ({finalizedCount})
            </Button>
          )}
        </Stack>
      </Stack>

      {run?.status === "processing" && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Payslips are being computed in the background — this list updates automatically.
        </Alert>
      )}

      {/* Disbursement, above the payslip list. Once a run is finalised the
          question stops being "what does everybody earn" and becomes "has the
          money gone", and the answer to the second was not on this page at all:
          the whole `PaymentBatch` workflow — per-bank instructions, who could
          not be paid, sent versus acknowledged — had no caller.

          Gated on the run being **completed and locked** — both of
          `build_payment_batches`'s preconditions, found by calling it rather
          than by reading it. The first gate used `finalizedCount > 0`, which
          offered a Build button that 409s on a draft run; the second still
          missed the lock, because finalising is what turns computed figures
          into approved ones and paying from an unapproved run would disburse
          numbers nobody signed off. Two guards, two calls to find them. */}
      {canManage && run?.status === "completed" && run?.locked_at ? (
        <DisbursementPanel runId={runId} />
      ) : null}

      <Card sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          useFlexGap
          sx={{ flexWrap: "wrap", alignItems: { sm: "center" } }}
        >
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search payslips…"
            label="Search payslips by name or employee code"
            sx={{ width: "100%", maxWidth: { sm: 260 } }}
          />
          <Box sx={{ flex: 1 }} />
          <ViewSwitch value={view} onChange={setView} />
        </Stack>
      </Card>

      <CountFilterBar
        ariaLabel="Filter payslips by status"
        value={statusFilter}
        onChange={(next) => setStatusFilter(next as "" | Payslip["status"])}
        loading={!counts}
        options={[
          { value: "", label: "All", count: counts?.total },
          { value: "draft", label: "Draft", count: counts?.draft.count },
          { value: "finalized", label: "Finalised", count: counts?.finalized.count, tone: "info" },
          { value: "paid", label: "Paid", count: counts?.paid.count, tone: "success" },
        ]}
      />

      <Box sx={{ mt: 2 }}>
        {view === "table" ? (
          <Paper variant="outlined" sx={{ p: 0 }}>
            <DataGrid
              rows={payslips ?? []}
              columns={columns}
              loading={isLoading}
              disableRowSelectionOnClick
              autoHeight
            />
          </Paper>
        ) : (
          <RecordGrid
            rows={payslips ?? []}
            view={payslipRecord}
            variant={view}
            loading={isLoading}
            filtered={Boolean(search || statusFilter)}
            empty={{
              title: search ? `Nobody matches “${search}”` : "No payslips yet",
              description: search
                ? "Try a name or an employee code."
                : "Payslips appear once the run has been processed.",
            }}
          />
        )}
      </Box>

      {detailPayslip && (
        <PayslipDetailDialog
          payslip={detailPayslip}
          canManage={Boolean(canManage)}
          onClose={() => setDetailPayslip(null)}
        />
      )}

      <Dialog open={Boolean(payDialogPayslip)} onClose={() => setPayDialogPayslip(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Mark payslip as paid</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This only records that payment happened outside the system — Khalti/eSewa have no payout API today, so
            no money actually moves from here.
          </Alert>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="Method" fullWidth value={method} onChange={(e) => setMethod(e.target.value)}>
              <MenuItem value="bank_transfer">Manual bank transfer</MenuItem>
              <MenuItem value="cash">Cash</MenuItem>
              <MenuItem value="wallet">Manual wallet transfer</MenuItem>
            </TextField>
            <TextField
              label="Reference (e.g. bank transaction ID)"
              fullWidth
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayDialogPayslip(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleMarkPaid} disabled={markPaid.isPending}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={markAllOpen} onClose={() => setMarkAllOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Mark all finalized payslips paid</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Records a manual/offline settlement for all {finalizedCount} finalized payslip(s) — download the
            bank file first and process it at your bank; no money moves from here.
          </Alert>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="Method" fullWidth value={method} onChange={(e) => setMethod(e.target.value)}>
              <MenuItem value="bank_transfer">Manual bank transfer</MenuItem>
              <MenuItem value="cash">Cash</MenuItem>
              <MenuItem value="wallet">Manual wallet transfer</MenuItem>
            </TextField>
            <TextField
              label="Reference (e.g. bank batch ID)"
              fullWidth
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMarkAllOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleMarkAllPaid} disabled={markAllPaid.isPending}>
            Mark {finalizedCount} paid
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

