"use client";

import AddIcon from "@mui/icons-material/Add";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import PaidIcon from "@mui/icons-material/Paid";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SavingsIcon from "@mui/icons-material/Savings";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState, type ReactNode } from "react";

import StateChip, { toneFor } from "@/components/common/StateChip";
import Amount from "@/components/common/Amount";
import DateText from "@/components/common/DateText";
import DateField from "@/components/common/DateField";
import EmployeeLink from "@/components/common/EmployeeLink";
import Columns from "@/components/charts/Columns";
import RankedBars from "@/components/charts/RankedBars";
import CountFilterBar from "@/components/common/CountFilterBar";
import ExportButton from "@/components/common/ExportButton";
import ListPagination from "@/components/common/ListPagination";
import SearchField from "@/components/common/SearchField";
import PageContainer from "@/components/shell/PageContainer";
import SectionCard from "@/components/common/SectionCard";
import { money, moneyCompact } from "@/lib/format/money";
import { monthLabel, monthTitle, todayIso, yearMarker } from "@/lib/format/period";
import PageHeader from "@/components/shell/PageHeader";
import {
  useCreateExpenseClaim,
  useExpenseAction,
  useExpenseClaims,
  useExpenseStatusCounts,
  useExpenseTrend,
} from "@/hooks/useExpenses";
import { useCan, useMe } from "@/hooks/useMe";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagedList } from "@/hooks/usePagedList";
import type { ExpenseCategory, ExpenseStatus } from "@/types/expenses";


const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "travel", label: "Travel" },
  { value: "meals", label: "Meals" },
  { value: "supplies", label: "Supplies" },
  { value: "software", label: "Software" },
  { value: "training", label: "Training" },
  { value: "other", label: "Other" },
];


export default function ExpensesPage() {
  const { data: me } = useMe();
  const { data: trend, isLoading: trendLoading } = useExpenseTrend();
  const isHR = useCan("expenses.manage");
  const [status, setStatus] = useState<ExpenseStatus | "">("");
  // Search and paging both run on the server. Filtering the loaded page in the
  // browser looked like search and was not: it could only ever match the rows
  // already fetched, so a claim on page three was invisible to a query that
  // named it exactly.
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query, 300);
  const { page, pageSize, setPage, setPageSize, reset } = usePagedList();
  const { data, isLoading } = useExpenseClaims({
    status: status || undefined,
    search: search || undefined,
    page,
    pageSize,
  });
  const { data: counts } = useExpenseStatusCounts();
  const action = useExpenseAction();
  const [dialogOpen, setDialogOpen] = useState(false);

  const claims = data?.results ?? [];
  // Figures come from the server, not from `claims`. Tallying the loaded page
  // undercounts the moment the company passes one page of claims.
  const pending = counts?.pending.count ?? 0;
  const approvedAmt = Number(counts?.approved.amount ?? 0);
  const reimbursedAmt = Number(counts?.reimbursed.amount ?? 0);

  useEffect(() => {
    reset();
  }, [status, search, reset]);

  const filtered = claims;
  const isEmptyResult = Boolean(search) && claims.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Expenses"
        subtitle={isHR ? "Review and reimburse expense claims" : "Submit and track your reimbursements"}
        icon={<ReceiptLongIcon />}
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search claims…"
              label="Search claims by title, category, status, date or amount"
            />
            {isHR && (
              <ExportButton
                path="expenses/claims"
                filters={[
                  {
                    type: "select",
                    param: "status",
                    label: "Status",
                    options: [
                      { value: "pending", label: "Pending" },
                      { value: "approved", label: "Approved" },
                      { value: "rejected", label: "Rejected" },
                      { value: "reimbursed", label: "Reimbursed" },
                    ],
                  },
                ]}
              />
            )}
            {/* The ceilings, where somebody with `expenses.manage` sets them.
                Beside the claim button because this is the page they are
                already on when a refusal makes them ask where the limit came
                from. */}
            {isHR && (
              <Button component={Link} href="/expenses/budgets" startIcon={<SavingsIcon />}>
                Budgets
              </Button>
            )}
            {me?.employee_id && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
                New Claim
              </Button>
            )}
          </Stack>
        }
      />

      {/* **Three totals had no shape.** Pending, approved and reimbursed are
          all counts as of today; none of them can say whether this month is
          normal. Twelve months of spend, split by what it went on, can.

          Deliberately two charts rather than one category × month grid. A
          grid encodes every amount as a shade, and reading a quantity off a
          shade is the comparison people are worst at — so "is this month
          unusual" and "where does the money go" are both present and neither is
          legible.

          Two charts, one question each: the months as columns, because a year
          is a sequence and a column chart is how a trend is read; the
          categories as ranked bars, because that is a question about order. */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <SectionCard
            title="Spend by month"
            subtitle="Approved and reimbursed claims over the last twelve months"
          >
            {trendLoading ? (
              <Skeleton variant="rounded" height={220} />
            ) : (
              <Columns
                // **The month, not the first three characters of an ISO
                // date.** These labels were `String(m.month).slice(0, 3)`,
                // which on `"2026-08-01"` is `"202"` — so all twelve columns
                // read `202` and the chart drew a shape nobody could locate a
                // month in. `monthLabel` exists so this is one call rather
                // than a slice at every call site.
                data={(trend?.months ?? []).map((m) => ({
                  label: monthLabel(String(m.month)),
                  // The year, marked only where the window crosses one.
                  sub: yearMarker(String(m.month)),
                  value: Number(m.total) || 0,
                }))}
                height={200}
                format={(v) => moneyCompact(v)}
                badge={(c, i) =>
                  `${monthTitle(String((trend?.months ?? [])[i]?.month ?? c.label))} — ${moneyCompact(c.value)}`
                }
              />
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <SectionCard
            title="Where it went"
            subtitle="The same twelve months, by category"
          >
            {trendLoading ? (
              <Skeleton variant="rounded" height={220} />
            ) : (
              <RankedBars
                items={(trend?.categories ?? []).map((c) => ({
                  label: c.name,
                  value: Number(c.total) || 0,
                }))}
                empty="Nothing claimed yet — once claims are approved, this shows what the money went on."
              />
            )}
          </SectionCard>
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <SummaryCard label="Pending" value={String(pending)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <SummaryCard label="Approved (awaiting reimbursement)" value={<Amount value={money(approvedAmt)} />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <SummaryCard label="Reimbursed" value={<Amount value={money(reimbursedAmt)} />} />
        </Grid>
      </Grid>

      {/* The status tiles were read-only totals; these are the same numbers

          and also the filter, so acting on "3 pending" is one click. */}

      <Box sx={{ mb: 2 }}>

        <CountFilterBar

          ariaLabel="Filter claims by status"

          value={status}

          onChange={(next) => setStatus(next)}

          loading={isLoading}

          options={[

            { value: "", label: "All", count: counts?.total },

            { value: "pending", label: "Pending", count: counts?.pending.count, tone: "warning" },

            { value: "approved", label: "Approved", count: counts?.approved.count, tone: "info" },

            { value: "reimbursed", label: "Reimbursed", count: counts?.reimbursed.count, tone: "success" },

            { value: "rejected", label: "Rejected", count: counts?.rejected.count, tone: "danger" },

            { value: "cancelled", label: "Cancelled", count: counts?.cancelled.count },

          ]}

        />

      </Box>


      <TableContainer component={Box} sx={{ bgcolor: "background.paper", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
        <Table>
          <TableHead>
            <TableRow>
              {isHR && <TableCell>Employee</TableCell>}
              <TableCell>Claim</TableCell>
              <TableCell>Category</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id} hover>
                {isHR && (
                  <TableCell>
                    <EmployeeLink id={c.employee} name={c.employee_name} />
                  </TableCell>
                )}
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {c.title}
                  </Typography>
                  {c.description && (
                    <Typography variant="caption" color="text.secondary">
                      {c.description}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ textTransform: "capitalize" }}>{c.category}</TableCell>
                <TableCell align="right">
                  <Amount value={money(c.amount)} />
                </TableCell>
                <TableCell><DateText value={c.expense_date} /></TableCell>
                <TableCell>
                  <StateChip label={String(c.status)} tone={toneFor(c.status)} />
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end", alignItems: "center" }}>
                    {c.receipt_url && (
                      <IconButton
                        size="small"
                        title="Receipt"
                        component={Link}
                        href={`/api/proxy/expenses/claims/${c.id}/receipt`}
                        target="_blank"
                        rel="noopener"
                      >
                        <AttachFileIcon fontSize="small" />
                      </IconButton>
                    )}
                    {isHR && c.status === "pending" && (
                      <>
                        <Button size="small" startIcon={<CheckIcon />} onClick={() => action.mutate({ id: c.id, action: "approve" })}>
                          Approve
                        </Button>
                        <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => action.mutate({ id: c.id, action: "reject" })}>
                          Reject
                        </Button>
                      </>
                    )}
                    {isHR && c.status === "approved" && (
                      <Button size="small" startIcon={<PaidIcon />} onClick={() => action.mutate({ id: c.id, action: "reimburse" })}>
                        Mark reimbursed
                      </Button>
                    )}
                    {c.employee === me?.employee_id && (c.status === "pending" || c.status === "approved") && (
                      <Button size="small" color="inherit" onClick={() => action.mutate({ id: c.id, action: "cancel" })}>
                        Cancel
                      </Button>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && isEmptyResult && (
              <TableRow>
                <TableCell colSpan={isHR ? 7 : 6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
                    No claims match “{query}”.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {!isLoading && claims.length === 0 && (
              <TableRow>
                <TableCell colSpan={isHR ? 7 : 6}>
                  <Stack spacing={1.5} sx={{ py: 5, alignItems: "center", textAlign: "center" }}>
                    <ReceiptLongIcon sx={{ fontSize: 40, color: "text.disabled" }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      No expense claims yet
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>
                      Employees submit reimbursement claims here (travel, meals, supplies, software,
                      training). Each claim moves through <strong>Pending → Approved → Reimbursed</strong>,
                      and HR reviews and marks them paid. Attach a receipt when you submit.
                    </Typography>
                    {me?.employee_id ? (
                      <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setDialogOpen(true)}
                      >
                        Submit your first claim
                      </Button>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Only staff linked to an employee record can submit claims.
                        {isHR ? " As HR, approved claims will appear here for reimbursement." : ""}
                      </Typography>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <ListPagination
        page={page}
        pageSize={pageSize}
        count={data?.count ?? 0}
        noun="claims"
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {dialogOpen && <NewClaimDialog onClose={() => setDialogOpen(false)} />}
    </PageContainer>
  );
}

function SummaryCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ p: 2, bgcolor: "background.paper", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>
        {value}
      </Typography>
    </Box>
  );
}

function NewClaimDialog({ onClose }: { onClose: () => void }) {
  const createClaim = useCreateExpenseClaim();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("travel");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!title.trim() || !amount) {
      setError("Title and amount are required.");
      return;
    }
    const form = new FormData();
    form.append("title", title);
    form.append("category", category);
    form.append("amount", amount);
    form.append("expense_date", expenseDate);
    form.append("description", description);
    if (receipt) form.append("receipt", receipt);
    try {
      await createClaim.mutateAsync(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New expense claim</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextField select label="Category" fullWidth value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {CATEGORIES.map((c) => (
              <MenuItem key={c.value} value={c.value}>
                {c.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Amount" type="number" fullWidth value={amount} onChange={(e) => setAmount(e.target.value)} />
          <DateField label="Expense date" value={expenseDate} onChange={setExpenseDate} />
          <TextField label="Description" fullWidth multiline minRows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button component="label" variant="outlined" startIcon={<AttachFileIcon />}>
            {receipt ? receipt.name : "Attach receipt (optional)"}
            <input hidden type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={createClaim.isPending}>
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
}
