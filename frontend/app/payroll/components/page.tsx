"use client";

import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import DeleteIcon from "@mui/icons-material/Delete";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import TuneIcon from "@mui/icons-material/Tune";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import DataGrid from "@/components/common/LazyDataGrid";
import { useState } from "react";

import {
  useCreateSalaryComponent,
  useDeleteSalaryComponent,
  useSalaryComponents,
  useSetSalaryComponentActive,
  useUpdateSalaryComponent,
} from "@/hooks/usePayroll";
import type { CalcType, ComponentType, SalaryComponent } from "@/types/payroll";
import StateChip from "@/components/common/StateChip";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import PageContainer from "@/components/shell/PageContainer";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import { useTextFilter } from "@/hooks/useTextFilter";

const CALC_TYPE_LABEL: Record<CalcType, string> = {
  flat: "Flat amount",
  percentage_of: "Percentage of",
  formula: "Formula",
  slab_based: "Slab-based",
};

const emptyForm = {
  code: "",
  name: "",
  component_type: "earning" as ComponentType,
  calc_type: "flat" as CalcType,
  amount: "0",
  percentage_of: "" as number | "",
  formula: "",
  taxable: true,
  is_active: true,
  order: 0,
};

export default function SalaryComponentsPage() {
  const { data: components, isLoading } = useSalaryComponents();
  const createComponent = useCreateSalaryComponent();
  const updateComponent = useUpdateSalaryComponent();

  const remove = useDeleteSalaryComponent();
  const setActive = useSetSalaryComponentActive();
  const [confirmDelete, setConfirmDelete] = useState<SalaryComponent | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  function openEdit(row: SalaryComponent) {
    setEditingId(row.id);
    setForm({
      code: row.code,
      name: row.name,
      component_type: row.component_type,
      calc_type: row.calc_type,
      amount: row.amount,
      percentage_of: row.percentage_of ?? "",
      formula: row.formula,
      taxable: row.taxable,
      is_active: row.is_active,
      order: row.order,
    });
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    setError(null);
    const values = {
      code: form.code,
      name: form.name,
      component_type: form.component_type,
      calc_type: form.calc_type,
      amount: form.amount,
      percentage_of: form.percentage_of === "" ? null : form.percentage_of,
      formula: form.formula,
      taxable: form.taxable,
      is_active: form.is_active,
      order: form.order,
    };
    try {
      if (editingId) {
        await updateComponent.mutateAsync({ id: editingId, values });
      } else {
        await createComponent.mutateAsync(values);
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const columns: GridColDef<SalaryComponent>[] = [
    { field: "order", headerName: "#", width: 60 },
    { field: "code", headerName: "Code", width: 140 },
    { field: "name", headerName: "Name", flex: 1, minWidth: 160 },
    {
      field: "component_type",
      headerName: "Type",
      width: 120,
      renderCell: (params) => (
        <Chip
          size="small"
          label={params.value}
          color={params.value === "earning" ? "success" : "warning"}
        />
      ),
    },
    {
      field: "calc_type",
      headerName: "Calculation",
      width: 170,
      valueFormatter: (value: CalcType) => CALC_TYPE_LABEL[value],
    },
    { field: "amount", headerName: "Amount / Rate", width: 130 },
    {
      field: "is_active",
      headerName: "Active",
      width: 90,
      renderCell: (params) => (
        <StateChip label={params.value ? "Yes" : "No"} tone={params.value ? "normal" : "muted"} />
      ),
    },
    {
      field: "actions",
      headerName: "",
      width: 190,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <Button size="small" onClick={() => openEdit(params.row)}>
            Edit
          </Button>
          {/* Retire and delete answer different questions. A component used
              by a salary structure cannot be deleted — the API refuses with
              the count — so retiring is how to stop it appearing on new
              structures without erasing the old ones. */}
          <Tooltip title={params.row.is_active ? "Stop offering on new structures" : "Offer again"}>
            <IconButton
              size="small"
              aria-label={
                params.row.is_active
                  ? `Retire ${params.row.name}`
                  : `Reactivate ${params.row.name}`
              }
              onClick={() =>
                setActive.mutate({ id: params.row.id, active: !params.row.is_active })
              }
              disabled={setActive.isPending}
            >
              {params.row.is_active ? (
                <ArchiveIcon fontSize="small" />
              ) : (
                <UnarchiveIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              color="error"
              aria-label={`Delete ${params.row.name}`}
              onClick={() => setConfirmDelete(params.row)}
              disabled={remove.isPending}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  const earnings = components?.results.filter((c) => c.component_type === "earning") ?? [];

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(
    components?.results ?? [],
    (c) => [c.code, c.name, c.component_type, c.calc_type]
  );

  return (
    <PageContainer>
      <PageHeader
        title={"Salary components"}
        subtitle="The building blocks every payslip is assembled from"
        icon={<TuneIcon />}
        actions={
          <>
          
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Add Component
          </Button>
          </>
        }
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search components…"
        searchLabel="Search components by code, name or type"
      />

      <DataGrid
        rows={filtered}
        columns={columns}
        loading={isLoading}
        disableRowSelectionOnClick
        autoHeight
        localeText={{ noRowsLabel: isEmptyResult ? `No components match “${query}”.` : "No components yet." }}
      />

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? "Edit component" : "New component"}</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Code"
                fullWidth
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                helperText="lowercase, e.g. basic_pay — used as a formula variable"
              />
              <TextField
                label="Name"
                fullWidth
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label="Type"
                fullWidth
                value={form.component_type}
                onChange={(e) => setForm({ ...form, component_type: e.target.value as ComponentType })}
              >
                <MenuItem value="earning">Earning</MenuItem>
                <MenuItem value="deduction">Deduction</MenuItem>
              </TextField>
              <TextField
                select
                label="Calculation"
                fullWidth
                value={form.calc_type}
                onChange={(e) => setForm({ ...form, calc_type: e.target.value as CalcType })}
              >
                <MenuItem value="flat">Flat amount</MenuItem>
                <MenuItem value="percentage_of">Percentage of another component</MenuItem>
                <MenuItem value="formula">Formula</MenuItem>
                <MenuItem value="slab_based">Slab-based (tax slabs)</MenuItem>
              </TextField>
            </Stack>

            {(form.calc_type === "flat" || form.calc_type === "percentage_of") && (
              <TextField
                label={form.calc_type === "flat" ? "Default amount" : "Percentage (e.g. 10 for 10%)"}
                fullWidth
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            )}
            {form.calc_type === "percentage_of" && (
              <TextField
                select
                label="Percentage of component"
                fullWidth
                value={form.percentage_of}
                onChange={(e) => setForm({ ...form, percentage_of: Number(e.target.value) })}
              >
                {earnings.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </MenuItem>
                ))}
              </TextField>
            )}
            {form.calc_type === "formula" && (
              <TextField
                label="Formula"
                fullWidth
                multiline
                minRows={2}
                value={form.formula}
                onChange={(e) => setForm({ ...form, formula: e.target.value })}
                helperText="References other component codes computed earlier in the order, e.g. (basic_pay + allowance) * 0.1"
              />
            )}
            <TextField
              label="Order"
              type="number"
              fullWidth
              value={form.order}
              onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
              helperText="Computation order — a component can only reference codes computed before it"
            />
            <Stack direction="row" spacing={4}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2">Taxable</Typography>
                <Switch
                  checked={form.taxable}
                  onChange={(e) => setForm({ ...form, taxable: e.target.checked })}
                />
              </Stack>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2">Active</Typography>
                <Switch
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
              </Stack>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={createComponent.isPending || updateComponent.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={`Delete ${confirmDelete?.name ?? ""}?`}
        description={
          "If any salary structure uses this component it cannot be deleted — " +
          "you will be told which, and can retire it instead so it stays on the " +
          "structures that already have it but is not offered on new ones."
        }
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => {
          if (confirmDelete) remove.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </PageContainer>
  );
}
