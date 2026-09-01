"use client";

import HandshakeIcon from "@mui/icons-material/Handshake";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import ViewListIcon from "@mui/icons-material/ViewList";
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

import { moneyCompact } from "@/lib/format/money";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import ExportButton from "@/components/common/ExportButton";
import CrmSubNav from "@/components/crm/CrmSubNav";
import DealFormDialog from "@/components/crm/DealFormDialog";
import DealsKanban from "@/components/crm/DealsKanban";
import {
  useDealStageCounts,
  useDeals,
  useDeleteDeal,
  useUpdateDeal,
} from "@/hooks/useCrm";
import type { Deal, DealStage } from "@/types/crm";
import Amount from "@/components/common/Amount";
import CountFilterBar from "@/components/common/CountFilterBar";
import Typography from "@mui/material/Typography";

import ListInsight from "@/components/common/ListInsight";
import SearchField from "@/components/common/SearchField";
import { useTextFilter } from "@/hooks/useTextFilter";

export default function DealsPage() {
  const [view, setView] = useState<"list" | "kanban">("kanban");
  const [stageFilter, setStageFilter] = useState<string>("");
  const { data: deals, isLoading } = useDeals(
    stageFilter ? { stage: stageFilter } : {}
  );
  const { data: stageCounts } = useDealStageCounts();
  const updateDeal = useUpdateDeal();
  const deleteDeal = useDeleteDeal();

  const [formOpen, setFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Deal | null>(null);

  function openCreate() {
    setEditingDeal(null);
    setFormOpen(true);
  }
  function openEdit(deal: Deal) {
    setEditingDeal(deal);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    await deleteDeal.mutateAsync(confirmDelete.id);
    setConfirmDelete(null);
  }

  const columns: GridColDef<Deal>[] = [
    { field: "title", headerName: "Deal", flex: 1, minWidth: 180 },
    { field: "client_name", headerName: "Client", flex: 1, minWidth: 160 },
    { field: "value", headerName: "Value", width: 120 },
    {
      field: "stage",
      headerName: "Stage",
      width: 160,
      renderCell: (params) => (
        <TextField
          select
          size="small"
          value={params.value}
          onChange={(e) => updateDeal.mutate({ id: params.row.id, values: { stage: e.target.value as DealStage } })}
          onClick={(e) => e.stopPropagation()}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="lead">Lead</MenuItem>
          <MenuItem value="qualified">Qualified</MenuItem>
          <MenuItem value="proposal">Proposal</MenuItem>
          <MenuItem value="won">Won</MenuItem>
          <MenuItem value="lost">Lost</MenuItem>
        </TextField>
      ),
    },
    {
      field: "owner_name",
      headerName: "Owner",
      width: 140,
      valueFormatter: (value: string | null) => value ?? "—",
    },
    {
      field: "actions",
      headerName: "",
      width: 100,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5}>
          <IconButton size="small" title="Edit" onClick={() => openEdit(params.row)}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" title="Delete" color="error" onClick={() => setConfirmDelete(params.row)}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      ),
    },
  ];

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(
    deals?.results ?? [],
    (d) => [d.title, d.client_name, d.stage, d.owner_name]
  );

  return (
    <PageContainer>
      <CrmSubNav />
      <PageHeader
        title="Deals"
        subtitle="Opportunities and where each one stands"
        icon={<HandshakeIcon />}
        actions={
          <>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <IconButton onClick={() => setView("kanban")} color={view === "kanban" ? "primary" : "default"}>
            <ViewKanbanIcon />
          </IconButton>
          <IconButton onClick={() => setView("list")} color={view === "list" ? "primary" : "default"}>
            <ViewListIcon />
          </IconButton>
          <ExportButton
            path="crm/deals"
            filters={[
              {
                type: "select",
                param: "stage",
                label: "Stage",
                options: [
                  { value: "lead", label: "Lead" },
                  { value: "qualified", label: "Qualified" },
                  { value: "proposal", label: "Proposal" },
                  { value: "won", label: "Won" },
                  { value: "lost", label: "Lost" },
                ],
              },
            ]}
          />
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search deals…"
            label="Search deals by title, client or stage"
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            New Deal
          </Button>
        </Stack>
      
          </>
        }
      />

      {stageCounts ? (
        (() => {
          // Open means not yet decided — lead, qualified, proposal. Won and
          // lost are history, and adding them to "pipeline" is the oldest way
          // to make a forecast look healthy.
          const open =
            Number(stageCounts.lead.amount) +
            Number(stageCounts.qualified.amount) +
            Number(stageCounts.proposal.amount);
          const openCount =
            stageCounts.lead.count + stageCounts.qualified.count + stageCounts.proposal.count;
          const decided = stageCounts.won.count + stageCounts.lost.count;
          const winRate = decided > 0 ? Math.round((stageCounts.won.count / decided) * 100) : null;

          return (
            <ListInsight
              headline={<><Amount value={moneyCompact(open)} prefix="Rs " /> in open pipeline</>}
              reading={
                openCount === 0
                  ? "Nothing is in play — every deal here has been won or lost."
                  : `across ${openCount} deal${openCount === 1 ? "" : "s"} still to be decided.${
                      winRate == null
                        ? ""
                        : ` Of the ${decided} already settled, ${winRate}% were won.`
                    }`
              }
              aside={
                stageCounts.proposal.count > 0 ? (
                  <>
                    <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                      {stageCounts.proposal.count} at proposal
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      the stage that closes or stalls
                    </Typography>
                  </>
                ) : undefined
              }
              segments={[
                { label: "Lead", value: stageCounts.lead.count, depth: 0 },
                { label: "Qualified", value: stageCounts.qualified.count, depth: 0.4 },
                { label: "Proposal", value: stageCounts.proposal.count, depth: 0.75 },
                { label: "Won", value: stageCounts.won.count, depth: 1 },
              ]}
            />
          );
        })()
      ) : null}

      {/* The pipeline as money, and the filter at the same time. A stage
          count on its own says nothing useful about a pipeline — six deals in
          Proposal matters only alongside what they are worth. */}
      <CountFilterBar
        ariaLabel="Filter deals by stage"
        value={stageFilter}
        onChange={setStageFilter}
        loading={!stageCounts}
        options={[
          { value: "", label: "All", count: stageCounts?.total },
          { value: "lead", label: `Lead · ${moneyCompact(stageCounts?.lead.amount)}`, count: stageCounts?.lead.count },
          { value: "qualified", label: `Qualified · ${moneyCompact(stageCounts?.qualified.amount)}`, count: stageCounts?.qualified.count },
          { value: "proposal", label: `Proposal · ${moneyCompact(stageCounts?.proposal.amount)}`, count: stageCounts?.proposal.count, tone: "info" },
          { value: "won", label: `Won · ${moneyCompact(stageCounts?.won.amount)}`, count: stageCounts?.won.count, tone: "success" },
          { value: "lost", label: "Lost", count: stageCounts?.lost.count },
        ]}
      />

      {view === "kanban" ? (
        <DealsKanban deals={filtered} onEdit={openEdit} />
      ) : (
        <DataGrid
          rows={filtered}
          columns={columns}
          loading={isLoading}
          disableRowSelectionOnClick
          autoHeight
          localeText={{ noRowsLabel: isEmptyResult ? `No deals match “${query}”.` : "No deals yet." }}
        />
      )}

      {formOpen && (
        <DealFormDialog
          key={editingDeal?.id ?? "new"}
          open={formOpen}
          deal={editingDeal}
          onClose={() => setFormOpen(false)}
        />
      )}

      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete deal?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete <strong>{confirmDelete?.title}</strong>? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleteDeal.isPending}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}

