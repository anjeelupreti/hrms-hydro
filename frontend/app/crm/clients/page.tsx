"use client";

import BusinessIcon from "@mui/icons-material/Business";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useState } from "react";

import StateChip, { toneFor } from "@/components/common/StateChip";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import ClientDetailDialog from "@/components/crm/ClientDetailDialog";
import { moneyCompact } from "@/lib/format/money";
import Typography from "@mui/material/Typography";

import Amount from "@/components/common/Amount";
import ListInsight from "@/components/common/ListInsight";
import CrmSubNav from "@/components/crm/CrmSubNav";
import {
  useClientBookSummary,
  useClients,
  useCreateClient,
  useDeleteClient,
  useUpdateClient,
} from "@/hooks/useCrm";
import type { Client, ClientStatus } from "@/types/crm";
import SearchField from "@/components/common/SearchField";

type FormState = {
  name: string;
  industry: string;
  website: string;
  address: string;
  notes: string;
  status: ClientStatus;
};

const EMPTY: FormState = { name: "", industry: "", website: "", address: "", notes: "", status: "active" };

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const { data: clients, isLoading } = useClients(search || undefined);
  const { data: book } = useClientBookSummary();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();

  const [editing, setEditing] = useState<Client | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Client | null>(null);
  const [detailClient, setDetailClient] = useState<Client | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    setDialogOpen(true);
  }
  function openEdit(client: Client) {
    setEditing(client);
    setForm({
      name: client.name,
      industry: client.industry,
      website: client.website,
      address: client.address,
      notes: client.notes,
      status: client.status,
    });
    setError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    setError(null);
    try {
      if (editing) await updateClient.mutateAsync({ id: editing.id, values: form });
      else await createClient.mutateAsync(form);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await deleteClient.mutateAsync(confirmDelete.id);
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete client.");
    }
  }

  const columns: GridColDef<Client>[] = [
    { field: "name", headerName: "Client", flex: 1, minWidth: 180 },
    { field: "industry", headerName: "Industry", width: 160 },
    { field: "website", headerName: "Website", flex: 1, minWidth: 180 },
    {
      field: "status",
      headerName: "Status",
      width: 110,
      renderCell: (params) => (
        <StateChip label={String(params.value)} tone={toneFor(String(params.value))} />
      ),
    },
    {
      field: "actions",
      headerName: "",
      width: 110,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5}>
          <IconButton
            size="small"
            title="Edit"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(params.row);
            }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            title="Delete"
            color="error"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(params.row);
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      ),
    },
  ];

  return (
    <PageContainer>
      <CrmSubNav />
      <PageHeader
        title="Clients"
        subtitle="Companies you do business with"
        icon={<BusinessIcon />}
        actions={
          <>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search clients…"
            label="Search clients by name or industry"
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Add Client
          </Button>
        </Stack>
      
          </>
        }
      />

      {/* What the list is worth, and what is owed on it.
          A client list is names and industries; the value is not in the
          `Client` row at all, it is in the deals and invoices hanging off it.
          Won business and unpaid invoices stay separate figures because they
          are two different conversations — one is what the relationship has
          been worth, the other is a call to make this week. */}
      {book ? (
        <ListInsight
          headline={<><Amount value={moneyCompact(Number(book.won_value))} prefix="Rs " /> won</>}
          reading={
            book.open_deals > 0
              ? `across ${book.clients_active} active client${book.clients_active === 1 ? "" : "s"}, with ${moneyCompact(Number(book.open_value))} still in play over ${book.open_deals} open deal${book.open_deals === 1 ? "" : "s"}.`
              : `across ${book.clients_active} active client${book.clients_active === 1 ? "" : "s"}. Nothing is in play — every deal has been won or lost.`
          }
          aside={
            Number(book.overdue) > 0 ? (
              <>
                <Typography
                  color="error.main"
                  sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}
                >
                  <Amount value={moneyCompact(Number(book.overdue))} prefix="Rs " /> overdue
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {book.overdue_invoices} invoice{book.overdue_invoices === 1 ? "" : "s"} past due
                </Typography>
              </>
            ) : Number(book.outstanding) > 0 ? (
              <>
                <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                  <Amount value={moneyCompact(Number(book.outstanding))} prefix="Rs " /> awaited
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  sent, none of it late yet
                </Typography>
              </>
            ) : undefined
          }
        />
      ) : null}

      <DataGrid
        rows={clients?.results ?? []}
        columns={columns}
        loading={isLoading}
        disableRowSelectionOnClick
        autoHeight
        onRowClick={(params) => setDetailClient(params.row)}
        localeText={{ noRowsLabel: search ? `No clients match “${search}”.` : "No clients yet." }}
        sx={{ "& .MuiDataGrid-row": { cursor: "pointer" } }}
      />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editing ? "Edit client" : "New client"}</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" fullWidth value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="Industry" fullWidth value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
            <TextField label="Website" fullWidth value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            <TextField label="Address" fullWidth multiline minRows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <TextField label="Notes" fullWidth multiline minRows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <TextField select label="Status" fullWidth value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ClientStatus })}>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={createClient.isPending || updateClient.isPending}>
            {editing ? "Save" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete client?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete <strong>{confirmDelete?.name}</strong>? This also removes its contacts, deals and projects. This
            cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleteClient.isPending}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <ClientDetailDialog
        open={Boolean(detailClient)}
        onClose={() => setDetailClient(null)}
        clientId={detailClient?.id ?? null}
        clientName={detailClient?.name ?? ""}
      />
    </PageContainer>
  );
}
