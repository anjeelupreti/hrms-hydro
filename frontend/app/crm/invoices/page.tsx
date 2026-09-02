"use client";

import ReceiptIcon from "@mui/icons-material/Receipt";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import DataGrid from "@/components/common/LazyDataGrid";

import Amount from "@/components/common/Amount";
import ListInsight from "@/components/common/ListInsight";
import NextLink from "next/link";
import { useState } from "react";

import { money } from "@/lib/format/money";
import StateChip, { toneFor } from "@/components/common/StateChip";
import PageContainer from "@/components/shell/PageContainer";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import CrmSubNav from "@/components/crm/CrmSubNav";
import InvoiceFormDialog from "@/components/crm/InvoiceFormDialog";
import { useInvoiceAction, useInvoiceCounts, useInvoices } from "@/hooks/useCrm";
import type { Invoice, InvoiceStatus } from "@/types/crm";
import { useTextFilter } from "@/hooks/useTextFilter";


export default function InvoicesPage() {
  const { data: counts } = useInvoiceCounts();
  // Both are served sums, not page arithmetic (§2.6).
  const unbilled = Number(counts?.draft.amount ?? 0);
  const awaiting = Number(counts?.sent.amount ?? 0);
  const { data, isLoading } = useInvoices();
  const action = useInvoiceAction();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(
    data?.results ?? [],
    (i) => [i.number, i.client_name, i.status, i.issue_date, i.due_date]
  );

  const columns: GridColDef<Invoice>[] = [
    { field: "number", headerName: "Invoice", width: 130 },
    { field: "client_name", headerName: "Client", flex: 1, minWidth: 160 },
    { field: "issue_date", headerName: "Issued", width: 120 },
    { field: "due_date", headerName: "Due", width: 120, valueFormatter: (v: string | null) => v ?? "—" },
    {
      field: "total",
      headerName: "Total",
      width: 130,
      valueGetter: (_, row) => `${row.currency} ${money(row.total)}`,
    },
    {
      field: "status",
      headerName: "Status",
      width: 110,
      renderCell: (params) => <StateChip label={String(params.value)} tone={toneFor(params.value as InvoiceStatus)} />,
    },
    {
      field: "actions",
      headerName: "",
      width: 250,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <IconButton size="small" title="View / print" component={NextLink} href={`/crm/invoices/${params.row.id}`}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
          {params.row.status === "draft" && (
            <>
              <IconButton size="small" title="Edit" onClick={() => { setEditing(params.row); setFormOpen(true); }}>
                <EditIcon fontSize="small" />
              </IconButton>
              <Button size="small" onClick={() => action.mutate({ id: params.row.id, action: "mark-sent" })}>
                Send
              </Button>
            </>
          )}
          {params.row.status === "sent" && (
            <Button size="small" color="success" onClick={() => action.mutate({ id: params.row.id, action: "mark-paid" })}>
              Mark paid
            </Button>
          )}
          {params.row.status !== "void" && params.row.status !== "paid" && (
            <IconButton size="small" color="error" title="Void" onClick={() => action.mutate({ id: params.row.id, action: "void" })}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <PageContainer>
      <CrmSubNav />
      <PageHeader
        title="Invoices"
        subtitle="Invoices raised against clients"
        icon={<ReceiptIcon />}
        actions={
          <>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            New Invoice
          </Button>
        </Stack>
      
          </>
        }
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search invoices…"
        searchLabel="Search invoices by number, client or status"
      />

      {/* Unpaid is the number this page exists for. Draft and sent are both
          money not yet in the bank, and separating them is the point: one is
          waiting on us, the other on the client. */}
      {counts ? (
        <ListInsight
          headline={<><Amount value={money(unbilled + awaiting)} prefix="Rs " /></>}
          reading={
            unbilled + awaiting === 0
              ? "Everything raised has been paid."
              : `not yet paid — ${money(awaiting)} sent and awaiting the client, ${money(unbilled)} still in draft and not yet sent to anybody.`
          }
          aside={
            counts.paid.count > 0 ? (
              <>
                <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                  <Amount value={money(Number(counts.paid.amount))} prefix="Rs " />
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  settled, {counts.paid.count} invoice{counts.paid.count === 1 ? "" : "s"}
                </Typography>
              </>
            ) : undefined
          }
          segments={[
            { label: "Draft", value: counts.draft.count, depth: 0 },
            { label: "Sent", value: counts.sent.count, depth: 0.5 },
            { label: "Paid", value: counts.paid.count, depth: 1 },
            { label: "Void", value: counts.void.count, depth: 0, attention: true },
          ]}
        />
      ) : null}

      <DataGrid
        rows={filtered}
        columns={columns}
        loading={isLoading}
        disableRowSelectionOnClick
        autoHeight
        localeText={{ noRowsLabel: isEmptyResult ? `No invoices match “${query}”.` : "No invoices yet." }}
      />

      {formOpen && (
        <InvoiceFormDialog key={editing?.id ?? "new"} invoice={editing} onClose={() => setFormOpen(false)} />
      )}
    </PageContainer>
  );
}
