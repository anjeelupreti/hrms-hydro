"use client";

import AddIcon from "@mui/icons-material/Add";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { GridColDef } from "@mui/x-data-grid";
import DataGrid from "@/components/common/LazyDataGrid";
import { useState } from "react";

import Typography from "@mui/material/Typography";

import ListInsight from "@/components/common/ListInsight";
import Amount from "@/components/common/Amount";
import { money } from "@/lib/format/money";
import StateChip, { toneFor } from "@/components/common/StateChip";
import EmployeeLink from "@/components/common/EmployeeLink";
import {
  useApproveLoan,
  useCancelLoan,
  useLoanCounts,
  useCreateLoan,
  useLoans,
  useRejectLoan,
} from "@/hooks/usePayroll";
import { useCan, useMe } from "@/hooks/useMe";
import type { Loan, LoanStatus } from "@/types/payroll";
import PageContainer from "@/components/shell/PageContainer";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import { useTextFilter } from "@/hooks/useTextFilter";


export default function LoansPage() {
  const { data: me } = useMe();
  const isHR = useCan("payroll.view");
  const { data: loans, isLoading } = useLoans();
  const { data: counts } = useLoanCounts();
  const createLoan = useCreateLoan();
  const approveLoan = useApproveLoan();
  const rejectLoan = useRejectLoan();
  const cancelLoan = useCancelLoan();

  // Outstanding comes from the server (§2.6). The monthly recovery is summed
  // from the active rows, which is safe here and only here: an active loan
  // book is small and the list is unpaginated for HR — if that ever changes
  // this needs its own served total rather than a bigger page size.
  const outstanding = Number(counts?.active.amount ?? 0);
  const monthlyRecovery = (loans?.results ?? [])
    .filter((l) => l.status === "active")
    .reduce((sum, l) => sum + Number(l.monthly_deduction ?? 0), 0);

  const [open, setOpen] = useState(false);
  const [loanType, setLoanType] = useState("personal");
  const [principal, setPrincipal] = useState("");
  const [deduction, setDeduction] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    try {
      await createLoan.mutateAsync({
        loan_type: loanType,
        principal_amount: principal,
        monthly_deduction: deduction,
        reason,
      });
      setOpen(false);
      setPrincipal("");
      setDeduction("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const columns: GridColDef<Loan>[] = [
    ...(isHR
      ? [
          {
            field: "employee_name",
            headerName: "Employee",
            flex: 1,
            minWidth: 160,
            renderCell: (params) => <EmployeeLink id={params.row.employee} name={params.value as string} />,
          } satisfies GridColDef<Loan>,
        ]
      : []),
    { field: "loan_type", headerName: "Type", width: 110 },
    { field: "principal_amount", headerName: "Principal", width: 120 },
    { field: "monthly_deduction", headerName: "Monthly", width: 110 },
    { field: "outstanding_balance", headerName: "Outstanding", width: 120 },
    {
      field: "status",
      headerName: "Status",
      width: 110,
      renderCell: (params) => <StateChip label={String(params.value)} tone={toneFor(params.value as LoanStatus)} />,
    },
    {
      field: "actions",
      headerName: "",
      width: isHR ? 250 : 130,
      sortable: false,
      filterable: false,
      renderCell: (params: { row: Loan }) => {
        if (params.row.status !== "requested") return null;
        // Approval wires the deduction into the salary structure, so once a
        // loan is active withdrawing it is a payroll correction, not a list
        // edit — the API refuses and there is no button for it here either.
        const isMine = params.row.employee === me?.employee_id;
        return (
          <Stack direction="row" spacing={1}>
            {isHR && (
              <>
                <Button size="small" startIcon={<CheckIcon />} onClick={() => approveLoan.mutate(params.row.id)}>
                  Approve
                </Button>
                <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => rejectLoan.mutate(params.row.id)}>
                  Reject
                </Button>
              </>
            )}
            {(isMine || isHR) && (
              <Button
                size="small"
                color="inherit"
                onClick={() => cancelLoan.mutate(params.row.id)}
                disabled={cancelLoan.isPending}
              >
                Withdraw
              </Button>
            )}
          </Stack>
        );
      },
    } satisfies GridColDef<Loan>,
  ];

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(
    loans?.results ?? [],
    (l) => [l.employee_name, l.employee_code, l.loan_type, l.status, l.reason]
  );

  return (
    <PageContainer>
      <PageHeader
        title={isHR ? "Loans" : "My loans"}
        subtitle="Employee loans and how they are recovered"
        icon={<RequestQuoteIcon />}
        actions={
          <>
          
          {me?.employee_id && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
              Request Loan
            </Button>
          )}
          </>
        }
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search loans…"
        searchLabel="Search loans by employee, type or status"
      />

      {/* What a finance team actually asks of this list: how much is out, and
          how fast it is coming back. "2 active" is not that. Every figure is
          summed server-side over the whole book. */}
      {isHR && counts ? (
        <ListInsight
          headline={<><Amount value={money(outstanding)} prefix="Rs " /></>}
          reading={
            counts.active.count === 0
              ? "Nothing is currently out on loan."
              : `still out across ${counts.active.count} active loan${counts.active.count === 1 ? "" : "s"}, recovering ${money(monthlyRecovery)} a month from payroll.`
          }
          aside={
            counts.requested.count > 0 ? (
              <>
                <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                  {counts.requested.count} waiting
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  for a decision
                </Typography>
              </>
            ) : undefined
          }
          segments={[
            { label: "Requested", value: counts.requested.count, depth: 0 },
            { label: "Approved", value: counts.approved.count, depth: 0.35 },
            { label: "Active", value: counts.active.count, depth: 0.7 },
            { label: "Closed", value: counts.closed.count, depth: 1 },
            { label: "Rejected", value: counts.rejected.count, depth: 0, attention: true },
          ]}
        />
      ) : null}

      <DataGrid
        rows={filtered}
        columns={columns}
        loading={isLoading}
        disableRowSelectionOnClick
        autoHeight
        localeText={{ noRowsLabel: isEmptyResult ? `No loans match “${query}”.` : "No loans yet." }}
      />

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Request a loan</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="Loan type" fullWidth value={loanType} onChange={(e) => setLoanType(e.target.value)}>
              <MenuItem value="office">Office Loan</MenuItem>
              <MenuItem value="personal">Personal Loan</MenuItem>
            </TextField>
            <TextField
              label="Principal amount"
              fullWidth
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
            />
            <TextField
              label="Monthly deduction"
              fullWidth
              value={deduction}
              onChange={(e) => setDeduction(e.target.value)}
            />
            <TextField label="Reason" fullWidth multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createLoan.isPending}>
            Submit
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
