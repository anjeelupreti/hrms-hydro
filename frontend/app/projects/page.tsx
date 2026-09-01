"use client";

/**
 * Every project, in whichever shape suits the reading.
 *
 * Its own module rather than a page under CRM. Sitting beside clients, deals
 * and invoices would say a project is something you do for a customer, and most
 * are not — which is also why the client is nullable.
 *
 * Three views, because a project list gets read three ways: cards to scan a
 * handful, a list to read many, a table to compare dates and owners. The choice
 * sticks per screen — see `ViewSwitch`.
 */

import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type GridColDef } from "@mui/x-data-grid";
import { useRouter } from "next/navigation";
import { useState } from "react";

import DataTable from "@/components/common/DataTable";
import { ArchiveButton, ArchiveTabs } from "@/components/common/ArchiveControls";
import { useArchive } from "@/hooks/useCollaboration";
import DateField from "@/components/common/DateField";
import DateText from "@/components/common/DateText";
import RecordGrid, { type RecordView } from "@/components/common/RecordGrid";
import SearchField from "@/components/common/SearchField";
import ViewSwitch, { useViewMode } from "@/components/common/ViewSwitch";
import { ClientPicker, EmployeePicker } from "@/components/common/pickers";
import PageContainer from "@/components/shell/PageContainer";
import ListInsight from "@/components/common/ListInsight";
import PageHeader from "@/components/shell/PageHeader";
import { useCreateProject, usePortfolioSummary, useProjects } from "@/hooks/useProjects";
import { useTextFilter } from "@/hooks/useTextFilter";
import type { Project, ProjectStatus } from "@/types/projects";

const STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_COLOR: Record<ProjectStatus, "default" | "info" | "warning" | "success" | "error"> = {
  planning: "default",
  active: "info",
  on_hold: "warning",
  completed: "success",
  cancelled: "error",
};

const labelOf = (status: ProjectStatus) =>
  STATUSES.find((s) => s.value === status)?.label ?? status;

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <Stack spacing={0.5} sx={{ width: "100%" }}>
      <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3 }} />
      <Typography variant="caption" color="text.secondary">
        {total === 0 ? "No tasks yet" : `${done} of ${total} done`}
      </Typography>
    </Stack>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [archived, setArchived] = useState(false);
  const { data, isLoading, error } = useProjects({ archived });
  const { data: portfolio } = usePortfolioSummary();
  const archiveProject = useArchive("projects/projects", "projects");
  const createProject = useCreateProject();
  const { mode: view, setMode: setView } = useViewMode("projects", "cards");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [clientId, setClientId] = useState<number | null>(null);
  const [owner, setOwner] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const {
    query,
    setQuery,
    filtered: rows,
    isEmptyResult,
  } = useTextFilter(data?.results ?? [], (p) => [p.name, p.client_name, p.status, p.description]);

  const open = (project: Project) => router.push(`/projects/${project.id}`);

  async function handleCreate() {
    setFormError(null);
    if (!name.trim()) {
      setFormError("Give the project a name.");
      return;
    }
    try {
      const created = await createProject.mutateAsync({
        name: name.trim(),
        status,
        client: clientId,
        owner,
        start_date: startDate || null,
        end_date: endDate || null,
      });
      setDialogOpen(false);
      setName("");
      setClientId(null);
      setOwner(null);
      setStartDate("");
      setEndDate("");
      // Straight into the new project. The next thing anybody does after
      // creating one is add work to it, and returning to the list makes them
      // find the thing they just made.
      router.push(`/projects/${created.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  const columns: GridColDef<Project>[] = [
    { field: "name", headerName: "Project", flex: 1, minWidth: 200 },
    {
      field: "client_name",
      headerName: "Client",
      flex: 1,
      minWidth: 150,
      // Blank reads as missing data; this project genuinely has no customer.
      renderCell: (params) =>
        params.value ?? (
          <Typography variant="body2" color="text.secondary">
            Internal
          </Typography>
        ),
    },
    {
      field: "status",
      headerName: "Status",
      width: 130,
      renderCell: (params) => (
        <Chip
          size="small"
          variant="outlined"
          label={labelOf(params.value as ProjectStatus)}
          color={STATUS_COLOR[params.value as ProjectStatus]}
        />
      ),
    },
    {
      field: "done_count",
      headerName: "Progress",
      width: 170,
      sortable: false,
      renderCell: (params) => (
        <Stack sx={{ height: "100%", justifyContent: "center", width: "100%" }}>
          <Progress done={params.row.done_count} total={params.row.task_count} />
        </Stack>
      ),
    },
    {
      field: "owner_name",
      headerName: "Owner",
      width: 150,
      valueFormatter: (value: string | null) => value ?? "Unassigned",
    },
    {
      field: "end_date",
      headerName: "Due",
      width: 120,
      renderCell: (params) => (params.value ? <DateText value={params.value} /> : "—"),
    },
    {
      // The archive tab is reachable from the list, so the list needs a way to
      // put a project into it — otherwise it is a door to an empty room.
      field: "archive",
      headerName: "",
      width: 56,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <ArchiveButton
          archived={archived}
          noun="project"
          onToggle={() => archiveProject.mutate({ id: params.row.id, archived })}
        />
      ),
    },
  ];

  const cardView: RecordView<Project> = {
    key: (p) => p.id,
    title: (p) => p.name,
    subtitle: (p) => p.client_name ?? "Internal project",
    badge: (p) => (
      <Chip
        size="small"
        variant="outlined"
        label={labelOf(p.status)}
        color={STATUS_COLOR[p.status]}
      />
    ),
    facts: (p) => [
      { label: "Tasks", value: p.task_count },
      { label: "Done", value: p.done_count },
      { label: "Owner", value: p.owner_name ?? "Unassigned" },
      { label: "Due", value: p.end_date ? <DateText value={p.end_date} /> : "—" },
    ],
    // Outside the click target, so filing a project away does not
    // also open it — the same reason the recruitment card puts it in
    // its own corner.
    actions: (p) => (
      <ArchiveButton
        archived={archived}
        noun="project"
        onToggle={() => archiveProject.mutate({ id: p.id, archived })}
      />
    ),
    onOpen: open,
  };

  return (
    <PageContainer>
      <PageHeader
        title="Projects"
        subtitle="Work, its people and how far along it is"
        icon={<AccountTreeIcon />}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
            New project
          </Button>
        }
      />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Projects could not be loaded.
        </Alert>
      ) : null}

      {portfolio && portfolio.tasks_total > 0 ? (
        <ListInsight
          headline={`${Math.round((portfolio.tasks_done / portfolio.tasks_total) * 100)}% of the work is done`}
          reading={`${portfolio.tasks_done} of ${portfolio.tasks_total} tasks finished across ${portfolio.projects_active} active project${portfolio.projects_active === 1 ? "" : "s"}, with ${portfolio.tasks_in_progress} being worked on right now.`}
          aside={
            // Blocked first, overdue second — blocked is the only state on the
            // board that working harder cannot clear, so it is the one that
            // needs a person to intervene rather than a person to hurry.
            portfolio.tasks_blocked > 0 || portfolio.tasks_overdue > 0 ? (
              <>
                <Typography
                  sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}
                  color={portfolio.tasks_blocked > 0 ? "error.main" : "text.primary"}
                >
                  {portfolio.tasks_blocked > 0
                    ? `${portfolio.tasks_blocked} blocked`
                    : `${portfolio.tasks_overdue} overdue`}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {portfolio.tasks_blocked > 0
                    ? portfolio.tasks_overdue > 0
                      ? `and ${portfolio.tasks_overdue} past their date`
                      : "waiting on something outside the team"
                    : "past the date they were promised"}
                </Typography>
              </>
            ) : undefined
          }
          segments={[
            {
              label: "Not started",
              value:
                portfolio.tasks_total -
                portfolio.tasks_done -
                portfolio.tasks_in_progress -
                portfolio.tasks_blocked,
              depth: 0,
            },
            { label: "In progress", value: portfolio.tasks_in_progress, depth: 0.55 },
            { label: "Done", value: portfolio.tasks_done, depth: 1 },
            { label: "Blocked", value: portfolio.tasks_blocked, depth: 0, attention: true },
          ]}
        />
      ) : null}

      <Card sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          useFlexGap
          sx={{ flexWrap: "wrap", alignItems: { sm: "center" } }}
        >
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search projects…"
            label="Search projects by name, client or status"
            sx={{ width: "100%", maxWidth: { sm: 280 } }}
          />
          <Box sx={{ flex: 1 }} />
          <ViewSwitch value={view} onChange={setView} />
        </Stack>
      </Card>

      <ArchiveTabs archived={archived} onChange={setArchived} liveLabel="Active" />

      {view === "table" ? (
        <DataTable
          rows={rows}
          columns={columns}
          tableId="projects"
          loading={isLoading}
          filtered={isEmptyResult}
          onRowNavigate={(row) => open(row)}
          empty={{
            title: "No projects yet",
            description:
              "A project is any body of work — for a client or for yourselves. Internal work needs no client.",
            action: (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
                New project
              </Button>
            ),
          }}
          noResults={{
            title: `Nothing matches “${query}”`,
            description: "Try a project name, a client or a status.",
            action: <Button onClick={() => setQuery("")}>Clear search</Button>,
          }}
        />
      ) : (
        <RecordGrid
          rows={rows}
          view={cardView}
          variant={view}
          loading={isLoading}
          filtered={isEmptyResult}
          empty={{
            title: isEmptyResult ? `Nothing matches “${query}”` : "No projects yet",
            description: isEmptyResult
              ? "Try a project name, a client or a status."
              : "A project is any body of work — for a client or for yourselves. Internal work needs no client.",
            action: isEmptyResult ? (
              <Button onClick={() => setQuery("")}>Clear search</Button>
            ) : (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
                New project
              </Button>
            ),
          }}
        />
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          {formError ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {formError}
            </Alert>
          ) : null}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Name"
              fullWidth
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                select
                label="Status"
                fullWidth
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              >
                {STATUSES.map((s) => (
                  <MenuItem key={s.value} value={s.value}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>
              <EmployeePicker
                label="Owner"
                value={owner}
                onChange={(id) => setOwner(id ?? null)}
                helperText="They can run the project without HR."
              />
            </Stack>
            <ClientPicker
              value={clientId}
              onChange={(id) => setClientId(id ?? null)}
              helperText="Leave empty for internal work."
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <DateField label="Start date" value={startDate} onChange={setStartDate} />
              <DateField label="End date" value={endDate} onChange={setEndDate} />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createProject.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
