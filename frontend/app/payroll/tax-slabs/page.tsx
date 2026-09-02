"use client";

import AddIcon from "@mui/icons-material/Add";
import PercentIcon from "@mui/icons-material/Percent";
import DeleteIcon from "@mui/icons-material/Delete";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { GridColDef } from "@mui/x-data-grid";
import DataGrid from "@/components/common/LazyDataGrid";
import { useMemo, useState } from "react";

import { useCreateTaxSlab, useDeleteTaxSlab, useTaxSlabs } from "@/hooks/usePayroll";
import type { TaxSlab } from "@/types/payroll";
import PageContainer from "@/components/shell/PageContainer";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import StateChip from "@/components/common/StateChip";
import { useCompanyProfile } from "@/hooks/useOrganization";
import { useTextFilter } from "@/hooks/useTextFilter";

/**
 * The opening year of `fiscal_year_label`, e.g. `"2082/83"` → `2082`.
 *
 * The form used to default to `new Date().getFullYear()`, which is a Gregorian
 * year — so a company filing for **2082/83** was offered **2026**, and a slab
 * saved without noticing lands in a fiscal year the payroll engine will never
 * look up. Nothing errors: the run simply reports no slabs configured.
 */
function openingYearOf(label: string | null | undefined): number | null {
  const parsed = Number(String(label ?? "").split("/")[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const baseForm = { order: 1, min_amount: "0", max_amount: "", rate: "0" };

export default function TaxSlabsPage() {
  const { data: slabs, isLoading } = useTaxSlabs();
  const { data: company } = useCompanyProfile();

  // Which slabs are in force is not a flag anybody sets — it is derived. The
  // payroll engine takes the fiscal year the *period* falls in and looks up
  // that year's bands (`fiscal_year_of(period_end)` in payroll/services.py).
  // So the year in force is the company's current fiscal year, and the screen
  // says so rather than leaving the reader to guess which of several years is
  // being used.
  const currentYear = openingYearOf(company?.fiscal_year_label);
  const emptyForm = useMemo(
    () => ({ ...baseForm, fiscal_year: currentYear ?? new Date().getFullYear() }),
    [currentYear]
  );
  const createSlab = useCreateTaxSlab();
  const deleteSlab = useDeleteTaxSlab();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    fiscal_year: number;
    order: number;
    min_amount: string;
    max_amount: string;
    rate: string;
  }>(() => ({ ...baseForm, fiscal_year: new Date().getFullYear() }));
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    try {
      await createSlab.mutateAsync({
        fiscal_year: form.fiscal_year,
        order: form.order,
        min_amount: form.min_amount,
        max_amount: form.max_amount || null,
        rate: form.rate,
      });
      setOpen(false);
      setForm(emptyForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const columns: GridColDef<TaxSlab>[] = [
    {
      field: "fiscal_year",
      headerName: "Fiscal year",
      width: 190,
      renderCell: (params) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", height: "100%" }}>
          <span>{params.row.fiscal_year}</span>
          {params.row.fiscal_year === currentYear ? (
            <StateChip label="In force" tone="normal" />
          ) : null}
        </Stack>
      ),
    },
    { field: "order", headerName: "Order", width: 90 },
    { field: "min_amount", headerName: "From", width: 130 },
    {
      field: "max_amount",
      headerName: "To",
      width: 130,
      valueFormatter: (value: string | null) => value ?? "and above",
    },
    { field: "rate", headerName: "Rate (%)", width: 100 },
    {
      field: "actions",
      headerName: "",
      width: 60,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <IconButton size="small" onClick={() => deleteSlab.mutate(params.row.id)}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(
    slabs?.results ?? [],
    (t) => [t.fiscal_year, t.rate, t.min_amount, t.max_amount]
  );

  return (
    <PageContainer>
      <PageHeader
        title={"Tax slabs"}
        subtitle={
          company?.fiscal_year_label
            ? `Income tax bands by fiscal year — payroll is currently using ${company.fiscal_year_label}`
            : "Income tax bands for a fiscal year"
        }
        icon={<PercentIcon />}
        actions={
          <>
          
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setForm(emptyForm);
              setOpen(true);
            }}
          >
            Add Slab
          </Button>
          </>
        }
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search slabs…"
        searchLabel="Search tax slabs by fiscal year or rate"
      />

      <DataGrid
        rows={filtered}
        columns={columns}
        loading={isLoading}
        disableRowSelectionOnClick
        autoHeight
        localeText={{ noRowsLabel: isEmptyResult ? `No slabs match “${query}”.` : "No tax slabs yet." }}
      />

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New tax slab</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Fiscal year (opening year)"
              helperText={
                company?.fiscal_year_label
                  ? `Enter ${openingYearOf(company.fiscal_year_label)} for FY ${company.fiscal_year_label}. Payroll looks up bands by this number, so a year nothing runs in is never used.`
                  : "The opening year of the pair — 2082 for FY 2082/83."
              }
              type="number"
              fullWidth
              value={form.fiscal_year}
              onChange={(e) => setForm({ ...form, fiscal_year: Number(e.target.value) })}
            />
            <TextField
              label="Order (sequence within the year)"
              type="number"
              fullWidth
              value={form.order}
              onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
            />
            <TextField
              label="From (min amount)"
              fullWidth
              value={form.min_amount}
              onChange={(e) => setForm({ ...form, min_amount: e.target.value })}
            />
            <TextField
              label="To (max amount, blank = no upper limit)"
              fullWidth
              value={form.max_amount}
              onChange={(e) => setForm({ ...form, max_amount: e.target.value })}
            />
            <TextField
              label="Rate (%)"
              fullWidth
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createSlab.isPending}>
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
