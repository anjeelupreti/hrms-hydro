"use client";

import AddIcon from "@mui/icons-material/Add";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteIcon from "@mui/icons-material/Delete";
import EditNoteIcon from "@mui/icons-material/EditNote";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import GavelIcon from "@mui/icons-material/Gavel";
import LayersIcon from "@mui/icons-material/Layers";
import SavingsIcon from "@mui/icons-material/Savings";
import SettingsIcon from "@mui/icons-material/Settings";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { type GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { money } from "@/lib/format/money";
import Amount from "@/components/common/Amount";
import DownloadButton from "@/components/common/DownloadButton";
import DateText from "@/components/common/DateText";
import DataTable from "@/components/common/DataTable";
import RecordGrid, { type RecordView } from "@/components/common/RecordGrid";
import PayrollRangePlot from "@/components/payroll/PayrollRangePlot";
import ViewSwitch, { useViewMode } from "@/components/common/ViewSwitch";
import SearchField from "@/components/common/SearchField";
import HeroPanel from "@/components/common/HeroPanel";
import StatTile from "@/components/common/StatTile";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  useCreatePayrollRun,
  useDeletePayrollRun,
  usePayrollRuns,
  usePayslips,
} from "@/hooks/usePayroll";
import { useCan, useMe } from "@/hooks/useMe";
import { useCalendarKey, useCalendarMonth } from "@/hooks/useCompanyCalendar";
import { useTextFilter } from "@/hooks/useTextFilter";
import { FONT } from "@/lib/theme/tokens";
import type { Payslip, PayrollRun, PayrollRunStatus } from "@/types/payroll";

const STATUS_COLOR: Record<PayrollRunStatus, "default" | "info" | "success" | "error"> = {
  draft: "default",
  processing: "info",
  completed: "success",
  failed: "error",
};

/* The local month-name composer is gone. "2026-03" is a database value and not
   a period a payroll officer reads — but composing the name here composed a
   *Gregorian* one, and a Bikram Sambat period is not a Gregorian month. The
   server names it now, from the calendar the run is actually in (D-06). */

export default function PayrollPage() {
  const { data: me } = useMe();
  const isHR = useCan("payroll.view");

  if (me === undefined) return null;
  return isHR ? <PayrollRunsView /> : <MyPayslipsView />;
}

function PayrollRunsView() {
  const router = useRouter();
  const deleteRun = useDeletePayrollRun();
  const [confirmDeleteRun, setConfirmDeleteRun] = useState<PayrollRun | null>(null);
  const { data: runs, isLoading } = usePayrollRuns();
  // Table by default: a runs list is compared across months — status, headcount
  // and net side by side — which is what a table is for. Cards are the better
  // read on a phone, so the preference is worth keeping per person.
  const { mode: runView, setMode: setRunView } = useViewMode("payroll-runs", "table");
  const createRun = useCreatePayrollRun();

  const [open, setOpen] = useState(false);
  // Which period to propose, and what to call its months, both come from the
  // server's calendar. `new Date().getMonth()` proposes a *Gregorian* month,
  // which for a company keeping Bikram Sambat books is not a period they run
  // payroll for (D-06).
  const calendar = useCalendarKey();
  const currentMonth = useCalendarMonth();
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived rather than synced into state, so there is no effect writing
  // state on load and no moment where the form shows a period it is not
  // going to submit. Explicit choices win once made.
  const periodYear = year ?? currentMonth.data?.today.year ?? null;
  const periodMonth = month ?? currentMonth.data?.today.month ?? null;
  const monthNames = currentMonth.data?.month_names ?? [];

  // The days the proposed period would pay over. Asked of the same
  // endpoint the picker uses — it already returns every day of a month
  // with its Gregorian date, so no second conversion is needed and no
  // second answer can exist.
  const proposed = useCalendarMonth(periodYear ?? undefined, periodMonth ?? undefined, open);
  const windowStart = proposed.data?.days[0]?.gregorian ?? "";
  const windowEnd = proposed.data?.days.at(-1)?.gregorian ?? "";

  const report = useMemo(() => {
    if (!runs) return null;
    const r = runs.results;
    return {
      totalRuns: r.length,
      completedRuns: r.filter((x) => x.status === "completed").length,
      draftRuns: r.filter((x) => x.status === "draft").length,
      failedRuns: r.filter((x) => x.status === "failed").length,
      payslipsIssued: r.reduce((sum, x) => sum + x.payslip_count, 0),
      latest: r[0],
      // Oldest → newest payslip counts, for the tile sparklines.
      trend: [...r].slice(0, 8).reverse().map((x) => x.payslip_count),
      // Oldest→newest of the most recent 8, for the payslip-volume chart.
      chart: [...r]
        .slice(0, 8)
        .reverse()
        .map((x) => ({
          period: `${String(x.period_year).slice(2)}-${String(x.period_month).padStart(2, "0")}`,
          payslips: x.payslip_count,
        })),
      // Gross and net per period. Deductions is not a third figure to plot —
      // it is the distance between these two, which is what the range plot
      // draws rather than leaving the reader to subtract.
      ranges: [...r]
        .slice(0, 8)
        .map((x) => ({
          id: x.id,
          label: x.period_label,
          gross: Number(x.total_gross),
          net: Number(x.total_net),
        })),
    };
  }, [runs]);

  async function handleCreate() {
    setError(null);
    try {
      if (periodYear === null || periodMonth === null) return;
      const run = await createRun.mutateAsync({
        period_calendar: calendar,
        period_year: periodYear,
        period_month: periodMonth,
      });
      setOpen(false);
      router.push(`/payroll/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const runs_ = runs?.results ?? [];
  const { query, setQuery, filtered } = useTextFilter(runs_, (r) => [
    r.period_label,
    `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
    r.status,
    r.notes,
  ]);

  // Declared once; `RecordGrid` renders it as cards or as compact rows. The
  // facts are the three numbers a run is judged by — who it covers, what it
  // costs, and whether anything is unresolved.
  const runRecord: RecordView<PayrollRun> = {
    key: (run) => run.id,
    title: (run) => run.period_label,
    subtitle: (run) => `${run.payslip_count} payslip${run.payslip_count === 1 ? "" : "s"}`,
    badge: (run) => <Chip size="small" label={run.status} sx={{ textTransform: "capitalize" }} />,
    facts: (run) => [
      { label: "Gross", value: <Amount value={money(run.total_gross)} /> },
      { label: "Net", value: <Amount value={money(run.total_net)} /> },
      ...(run.error_count
        ? [{ label: "Errors", value: run.error_count }]
        : []),
    ],
    onOpen: (run) => router.push(`/payroll/runs/${run.id}`),
  };

  const columns: GridColDef<PayrollRun>[] = [
    {
      // A run needs a handle you can say out loud and search for. The period
      // alone reads as a date in a log; "RUN-2026-07" reads as a record.
      field: "reference",
      headerName: "Run",
      width: 132,
      valueGetter: (_, row) => `RUN-${row.period_year}-${String(row.period_month).padStart(2, "0")}`,
      renderCell: (params) => (
        <Typography
          variant="body2"
          sx={{ fontFamily: FONT.mono, fontSize: "0.8125rem", color: "text.secondary" }}
        >
          {params.value as string}
        </Typography>
      ),
    },
    {
      field: "period",
      headerName: "Period",
      width: 170,
      valueGetter: (_, row) => row.period_label,
      renderCell: (params) => (
        // The primary cell: link-coloured and underlined on row hover, so the
        // row reads as something you open rather than a line you read.
        <Typography
          variant="body2"
          sx={{
            fontWeight: 700,
            color: "primary.main",
            ".MuiDataGrid-row:hover &": { textDecoration: "underline" },
          }}
        >
          {params.value as string}
        </Typography>
      ),
    },
    {
      field: "status",
      headerName: "Status",
      width: 130,
      renderCell: (params) => <Chip size="small" label={params.value} color={STATUS_COLOR[params.value as PayrollRunStatus]} />,
    },
    {
      field: "payslip_count",
      headerName: "Payslips",
      width: 110,
      align: "right",
      headerAlign: "right",
      renderCell: (params) => (
        <Typography variant="body2" className="hrms-num" sx={{ fontWeight: 600 }}>
          {params.value as number}
        </Typography>
      ),
    },
    {
      field: "notes",
      headerName: "Notes",
      flex: 1,
      minWidth: 160,
      renderCell: (params) =>
        (params.value as string)?.trim() ? (
          <Typography variant="body2" noWrap>
            {params.value as string}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.disabled">
            —
          </Typography>
        ),
    },
    {
      // The row navigates, but a row that only *looks* like a row gives no hint
      // of that. An outlined button reads as a control; the plain text link it
      // replaced disappeared into the row.
      field: "actions",
      headerName: "",
      width: 140,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      align: "right",
      headerAlign: "right",
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", justifyContent: "flex-end" }}>
          {/* Only a draft. Once processed, the payslips are the record of what
              people were paid — the API refuses, and offering the button
              anyway would just be a trap. */}
          {params.row.status === "draft" && (
            <Tooltip title="Delete this draft run">
              <IconButton
                size="small"
                color="error"
                aria-label={`Delete draft run ${params.row.period_label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteRun(params.row);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Button
            size="small"
            variant="outlined"
            endIcon={<ChevronRightIcon />}
            component={Link}
            href={`/payroll/runs/${params.row.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            View details
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Payroll"
        subtitle="Monthly runs, payslips and the rules behind them"
        icon={<ReceiptLongIcon />}
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search runs…"
              label="Search payroll runs by period, status or notes"
            />
            {/* One action in the header. The rules payroll runs by are a
                different kind of thing from "run payroll", and standing them
                side by side says they are the same — as well as squeezing the
                title to "Pa…" down a column of single letters.

                The rules live below, where they
                read as a set. */}
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
              New run
            </Button>
          </>
        }
      />

      {/* The rules behind the runs. Grouped and labelled, so it is obvious
          these are settings rather than things that happen now. */}
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: "wrap", alignItems: "center", mb: 3 }}
      >
        <Typography variant="overline" color="text.secondary" sx={{ mr: 0.5 }}>
          Rules
        </Typography>
        {[
          { href: "/payroll/components", label: "Components", icon: <SettingsIcon fontSize="small" /> },
          // Beside the components, because a structure is built out of them —
          // and first among the rules, because a workforce with no structures
          // is a payroll run that pays nobody.
          { href: "/payroll/structures", label: "Structures", icon: <LayersIcon fontSize="small" /> },
          { href: "/payroll/tax-slabs", label: "Tax slabs", icon: <SettingsIcon fontSize="small" /> },
          // The figures the law sets, as opposed to the ones this company
          // chooses. Beside the slabs because they are checked together.
          { href: "/payroll/statutory-rates", label: "Statutory rates", icon: <GavelIcon fontSize="small" /> },
          { href: "/payroll/contributions", label: "Contributions", icon: <SavingsIcon fontSize="small" /> },
          { href: "/payroll/loans", label: "Loans", icon: <RequestQuoteIcon fontSize="small" /> },
        ].map((rule) => (
          <Chip
            key={rule.href}
            component={Link}
            href={rule.href}
            clickable
            variant="outlined"
            icon={rule.icon}
            label={rule.label}
          />
        ))}
      </Stack>

      {report && (
        <>
          <HeroPanel
            tone="payroll"
            eyebrow="Payslips issued"
            value={report.payslipsIssued.toLocaleString()}
            caption={
              report.latest
                ? `Most recent run — ${report.latest.period_label}`
                : "No runs yet"
            }
            figures={[
              { label: "Completed", value: String(report.completedRuns) },
              { label: "Drafts", value: String(report.draftRuns) },
              { label: "Failed", value: String(report.failedRuns) },
            ]}
            actions={
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
                New run
              </Button>
            }
          />

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatTile
                label="Total runs"
                value={report.totalRuns}
                icon={<EventRepeatIcon />}
                tone="payroll"
                trend={report.trend}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatTile
                label="Completed"
                value={report.completedRuns}
                icon={<TaskAltIcon />}
                tone="success"
                hint={report.totalRuns ? `${Math.round((report.completedRuns / report.totalRuns) * 100)}% of runs` : undefined}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatTile
                label="Drafts"
                value={report.draftRuns}
                icon={<EditNoteIcon />}
                tone="warning"
                hint={report.latest ? `Latest ${report.latest.period_label}` : undefined}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatTile
                label="Failed"
                value={report.failedRuns}
                icon={<ReceiptLongIcon />}
                tone="danger"
                filled={report.failedRuns > 0}
                hint={report.failedRuns > 0 ? "Needs attention" : undefined}
              />
            </Grid>
          </Grid>

          <PayrollRangePlot
            periods={report.ranges}
            onOpen={(id) => router.push(`/payroll/runs/${id}`)}
          />

        </>
      )}

      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1.5 }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Runs
        </Typography>
        <ViewSwitch value={runView} onChange={setRunView} />
      </Stack>

      {runView === "table" ? (
      <DataTable
        tableId="payroll-runs"
        rows={filtered}
        columns={columns}
        loading={isLoading}
        filtered={Boolean(query)}
        onRowNavigate={(row) => router.push(`/payroll/runs/${row.id}`)}
        empty={{
          title: "No payroll runs yet",
          description:
            "A run collects every employee's pay for one month — earnings, deductions and tax — and produces their payslips. Create one for the period you want to pay.",
          action: (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
              New run
            </Button>
          ),
        }}
        noResults={{
          title: `No runs match “${query}”`,
          description: "Try a different period, status or note.",
          action: (
            <Button variant="outlined" onClick={() => setQuery("")}>
              Clear search
            </Button>
          ),
        }}
      />
      ) : (
        <RecordGrid
          rows={filtered}
          view={runRecord}
          variant={runView}
          loading={isLoading}
          filtered={Boolean(query)}
          empty={{
            title: query ? `No runs match “${query}”` : "No payroll runs yet",
            description: query
              ? "Try a different period, status or note."
              : "A run collects every employee's pay for one month — earnings, deductions and tax — and produces their payslips.",
            action: query ? (
              <Button variant="outlined" onClick={() => setQuery("")}>
                Clear search
              </Button>
            ) : (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
                New run
              </Button>
            ),
          }}
        />
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New payroll run</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Year"
              type="number"
              fullWidth
              value={periodYear ?? ""}
              onChange={(e) => setYear(Number(e.target.value))}
              helperText={calendar === "BS" ? "BS (Bikram Sambat)" : "AD (Gregorian)"}
            />
            <TextField
              select
              label="Month"
              fullWidth
              value={periodMonth ?? ""}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {monthNames.map((name, index) => (
                <MenuItem key={name} value={index + 1}>
                  {name}
                </MenuItem>
              ))}
            </TextField>
            {/* Which days this actually pays over. "Shrawan 2083" does not
                say, and the whole defect was a label that agreed with the law
                while the window underneath did not. */}
            {periodYear !== null && periodMonth !== null && (
              <Typography variant="caption" color="text.secondary">
                Pays over{" "}
                <DateText value={windowStart} /> to <DateText value={windowEnd} />
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createRun.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirmDeleteRun)}
        title="Delete this draft run?"
        description={
          confirmDeleteRun
            ? `The draft for ${confirmDeleteRun.period_label} will be removed. Nothing has been paid from a draft, so nothing is lost — you can create it again.`
            : undefined
        }
        confirmLabel="Delete draft"
        loading={deleteRun.isPending}
        onConfirm={() => {
          if (confirmDeleteRun) deleteRun.mutate(confirmDeleteRun.id);
          setConfirmDeleteRun(null);
        }}
        onClose={() => setConfirmDeleteRun(null)}
      />
    </PageContainer>
  );
}

const PAYSLIP_STATUS_COLOR = { draft: "default", finalized: "info", paid: "success" } as const;


function MyPayslipsView() {
  const { data: payslips, isLoading } = usePayslips();

  const rows = payslips?.results ?? [];
  const { query, setQuery, filtered } = useTextFilter(rows, (p) => [
    p.period_label,
    `${p.period_year}-${String(p.period_month).padStart(2, "0")}`,
    p.status,
  ]);

  const columns: GridColDef<Payslip>[] = [
    {
      field: "period",
      headerName: "Period",
      width: 170,
      valueGetter: (_, row) => row.period_label,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {params.value as string}
        </Typography>
      ),
    },
    // Money right-aligned and thousands-separated — a payslip column that
    // renders the raw "45000.00" string is the tell that nobody laid it out.
    {
      field: "gross_earnings",
      headerName: "Gross",
      width: 130,
      align: "right",
      headerAlign: "right",
      valueFormatter: (value: string) => money(value),
    },
    {
      field: "total_deductions",
      headerName: "Deductions",
      width: 130,
      align: "right",
      headerAlign: "right",
      valueFormatter: (value: string) => money(value),
    },
    {
      field: "net_pay",
      headerName: "Net Pay",
      width: 140,
      align: "right",
      headerAlign: "right",
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {money(params.value as string)}
        </Typography>
      ),
    },
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
      width: 130,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      align: "right",
      headerAlign: "right",
      renderCell: (params) => (
        <DownloadButton
          url={`/api/proxy/payroll/payslips/${params.row.id}/download`}
          filename={`payslip-${params.row.id}.pdf`}
        >
          Payslip
        </DownloadButton>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="My Payslips"
        subtitle="Every period you've been paid for, with the PDF"
        icon={<ReceiptLongIcon />}
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search periods…"
              label="Search payslips by period or status"
            />
            <Button component={Link} href="/payroll/loans" startIcon={<RequestQuoteIcon />}>
              My Loans
            </Button>
          </>
        }
      />
      <DataTable
        tableId="my-payslips"
        rows={filtered}
        columns={columns}
        loading={isLoading}
        filtered={Boolean(query)}
        empty={{
          title: "No payslips yet",
          description:
            "Once a payroll run for a period you worked is completed, your payslip for that month appears here as a PDF.",
        }}
        noResults={{
          title: `No payslips match “${query}”`,
          description: "Try another period or status.",
          action: (
            <Button variant="outlined" onClick={() => setQuery("")}>
              Clear search
            </Button>
          ),
        }}
      />
    </PageContainer>
  );
}
