"use client";

import AddIcon from "@mui/icons-material/Add";
import ChecklistIcon from "@mui/icons-material/Checklist";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import CardContent from "@mui/material/CardContent";
import Tooltip from "@mui/material/Tooltip";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import RunProgress from "@/components/checklists/RunProgress";
import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import SearchField from "@/components/common/SearchField";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import ListPagination from "@/components/common/ListPagination";
// Still used for the template list further down, which is a handful of rows
// and genuinely does fit in one response.
import { useTextFilter } from "@/hooks/useTextFilter";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagedList } from "@/hooks/usePagedList";
import {
  useCancelChecklist,
  useChecklists,
  useChecklistTemplates,
  useCreateChecklist,
  useDeleteChecklistTemplate,
  useMyChecklistTasks,
  useSaveChecklistTemplate,
  useUpdateChecklistTask,
} from "@/hooks/useChecklists";
import { useArchive } from "@/hooks/useCollaboration";
import { useCan } from "@/hooks/useMe";
import type { Checklist, ChecklistTemplate, ChecklistTemplateItem } from "@/types/checklists";
import { EmployeePicker } from "@/components/common/pickers";

const KIND_LABEL = { onboarding: "Onboarding", offboarding: "Offboarding" } as const;

export default function ChecklistsPage() {
  const isHR = useCan("workplace.manage");
  const [tab, setTab] = useState(0);

  return (
    <PageContainer>
      <PageHeader
        title="Onboarding & Checklists"
        subtitle="Templated task lists for new hires and leavers"
        icon={<ChecklistIcon />}
      />
      {isHR && (
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="Checklists" />
          {/* The owner's original ask: somewhere for finished runs to go.
              Deleting one destroys the record that somebody was onboarded at
              all; archiving keeps it and stops it crowding the live list. */}
          <Tab label="Archive" />
          <Tab label="Templates" />
        </Tabs>
      )}
      {tab === 0 && <ChecklistsTab isHR={Boolean(isHR)} />}
      {tab === 1 && <ChecklistsTab isHR={Boolean(isHR)} archived />}
      {tab === 2 && <TemplatesTab />}
    </PageContainer>
  );
}

function ChecklistsTab({ isHR, archived = false }: { isHR: boolean; archived?: boolean }) {
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query, 300);
  const { page, pageSize, setPage, setPageSize, reset } = usePagedList();
  const { data } = useChecklists({ archived, search: search || undefined, page, pageSize });

  useEffect(() => {
    reset();
  }, [archived, search, reset]);
  const archiveChecklist = useArchive("checklists", "checklists");
  const { data: myTasks } = useMyChecklistTasks();
  const updateTask = useUpdateChecklistTask();
  const [starting, setStarting] = useState(false);

  const checklists = data?.results ?? [];
  const mine = myTasks ?? [];

  const filtered = checklists;
  const isEmptyResult = Boolean(search) && checklists.length === 0;

  return (
    <Stack spacing={2}>
      {/* Only on the live tab. A run that has been archived is finished with,
          and reporting how long it stayed open would be a complaint about the
          past rather than something to act on. Read across every run, not the
          search results: a stalled onboarding is still stalled when somebody
          types a filter that hides it. */}
      {archived ? null : <RunProgress checklists={checklists} />}

      {mine.length > 0 && (
        <Card sx={{ borderColor: "primary.main" }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              My tasks ({mine.filter((t) => t.status === "pending").length} open)
            </Typography>
            <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
              {mine.map((t) => (
                <Stack key={t.id} direction="row" spacing={1} sx={{ py: 0.75, alignItems: "center" }}>
                  <Checkbox
                    checked={t.status === "done"}
                    onChange={(e) => updateTask.mutate({ id: t.id, status: e.target.checked ? "done" : "pending" })}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ textDecoration: t.status === "done" ? "line-through" : "none" }}>
                      {t.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t.checklist_title} · for {t.for_employee ?? "—"}
                      {t.due_date ? (
                        <>
                          {" · due "}
                          <DateText value={t.due_date} format="short" />
                        </>
                      ) : ""}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search checklists…"
          label="Search checklists by title, employee, status or task"
        />
        {isHR && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setStarting(true)}>
            Start a checklist
          </Button>
        )}
      </Stack>

      {filtered.length === 0 ? (
        <EmptyState
          variant={isEmptyResult ? "noResults" : "empty"}
          title={isEmptyResult ? `No checklists match “${query}”` : "No checklists running"}
          description={
            isEmptyResult
            ? "Try a different search, or clear it to see everything."
            : "Start a templated checklist when someone joins or leaves, so the same twenty tasks happen every time instead of from memory."
          }
          surface
        />
      ) : (
        filtered.map((c) => (
          <ChecklistCard key={c.id} checklist={c} isHR={isHR} archived={archived} onArchive={archiveChecklist} />
        ))
      )}

      <ListPagination
        page={page}
        pageSize={pageSize}
        count={data?.count ?? 0}
        noun="checklists"
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {starting && <StartChecklistDialog onClose={() => setStarting(false)} />}
    </Stack>
  );
}

function ChecklistCard({
  checklist,
  isHR,
  archived = false,
  onArchive,
}: {
  checklist: Checklist;
  isHR: boolean;
  archived?: boolean;
  onArchive: { mutate: (v: { id: number; archived: boolean }) => void };
}) {
  const updateTask = useUpdateChecklistTask();
  const cancel = useCancelChecklist();
  const statusColor = checklist.status === "completed" ? "success" : checklist.status === "cancelled" ? "default" : "primary";

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {checklist.title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {KIND_LABEL[checklist.kind]} · {checklist.employee_name}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Chip size="small" label={checklist.status} color={statusColor} variant="outlined" />
            {isHR && checklist.status === "active" && !archived && (
              <Button size="small" color="inherit" onClick={() => cancel.mutate(checklist.id)}>
                Cancel
              </Button>
            )}
            {isHR && (
              <Tooltip title={archived ? "Put it back in the live list" : "File this finished run away"}>
                <IconButton
                  size="small"
                  onClick={() => onArchive.mutate({ id: checklist.id, archived })}
                >
                  {archived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
          <LinearProgress
            variant="determinate"
            value={checklist.progress.pct}
            sx={{ flex: 1, height: 8, borderRadius: 4 }}
          />
          <Typography variant="caption" color="text.secondary">
            {checklist.progress.done}/{checklist.progress.total}
          </Typography>
        </Stack>

        <Stack>
          {checklist.tasks.map((t) => (
            <Stack key={t.id} direction="row" spacing={1} sx={{ alignItems: "center", py: 0.25 }}>
              <Checkbox
                size="small"
                checked={t.status === "done"}
                disabled={checklist.status === "cancelled"}
                onChange={(e) => updateTask.mutate({ id: t.id, status: e.target.checked ? "done" : "pending" })}
              />
              <Typography
                variant="body2"
                sx={{ flex: 1, textDecoration: t.status === "done" ? "line-through" : "none", color: t.status === "done" ? "text.secondary" : "text.primary" }}
              >
                {t.title}
              </Typography>
              {t.assignee_name && <Chip size="small" label={t.assignee_name} variant="outlined" />}
              {t.due_date && (
                <Typography variant="caption" color="text.secondary">
                  <DateText value={t.due_date} />
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

function StartChecklistDialog({ onClose }: { onClose: () => void }) {
  const { data: templates } = useChecklistTemplates();
  const create = useCreateChecklist();
  const [employee, setEmployee] = useState<number | "">("");
  const [template, setTemplate] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!employee || !template) {
      setError("Pick an employee and a template.");
      return;
    }
    try {
      await create.mutateAsync({ employee: Number(employee), template: Number(template) });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checklist.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Start a checklist</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <EmployeePicker value={employee || null} onChange={(id) => setEmployee(id ?? 0)} required />
          <TextField select label="Template" value={template} onChange={(e) => setTemplate(Number(e.target.value))}>
            {(templates?.results ?? []).filter((t) => t.is_active).map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name} ({KIND_LABEL[t.kind]}, {t.item_count} tasks)
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={create.isPending}>
          Start
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TemplatesTab() {
  const { data } = useChecklistTemplates();
  const del = useDeleteChecklistTemplate();
  const [editing, setEditing] = useState<ChecklistTemplate | null | undefined>(undefined);

  const templates = data?.results ?? [];
  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(templates, (t) => [
    t.name,
    t.description,
    KIND_LABEL[t.kind],
  ]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search templates…"
          label="Search templates by name, description or kind"
        />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>
          New template
        </Button>
      </Stack>
      {isEmptyResult && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
          No templates match “{query}”.
        </Typography>
      )}
      {filtered.map((t) => (
        <Card key={t.id}>
          <CardContent>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {t.name} <Chip size="small" label={KIND_LABEL[t.kind]} sx={{ ml: 0.5 }} />
                  {!t.is_active && <Chip size="small" label="Inactive" sx={{ ml: 0.5 }} />}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t.item_count} task(s)
                  {t.description ? ` · ${t.description}` : ""}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5}>
                <IconButton size="small" onClick={() => setEditing(t)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => del.mutate(t.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}
      {editing !== undefined && <TemplateDialog template={editing} onClose={() => setEditing(undefined)} />}
    </Stack>
  );
}

function TemplateDialog({ template, onClose }: { template: ChecklistTemplate | null; onClose: () => void }) {
  const save = useSaveChecklistTemplate();
  const [name, setName] = useState(template?.name ?? "");
  const [kind, setKind] = useState(template?.kind ?? "onboarding");
  const [description, setDescription] = useState(template?.description ?? "");
  const [isActive, setIsActive] = useState(template?.is_active ?? true);
  const [items, setItems] = useState<ChecklistTemplateItem[]>(
    template?.items?.length ? template.items : [{ title: "", order: 0, due_offset_days: 0 }]
  );
  const [error, setError] = useState<string | null>(null);

  function setItem(i: number, patch: Partial<ChecklistTemplateItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, { title: "", order: prev.length, due_offset_days: 0 }]);
  }
  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setError(null);
    const cleanItems = items
      .filter((it) => it.title.trim())
      .map((it, i) => ({ ...it, order: i }));
    if (!name.trim() || cleanItems.length === 0) {
      setError("A name and at least one task are required.");
      return;
    }
    try {
      await save.mutateAsync({
        id: template?.id,
        values: { name, kind: kind as ChecklistTemplate["kind"], description, is_active: isActive, items: cleanItems },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <Stack direction="row" spacing={2}>
            <TextField select label="Kind" value={kind} onChange={(e) => setKind(e.target.value as ChecklistTemplate["kind"])} sx={{ flex: 1 }}>
              <MenuItem value="onboarding">Onboarding</MenuItem>
              <MenuItem value="offboarding">Offboarding</MenuItem>
            </TextField>
            <TextField select label="Active" value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")} sx={{ flex: 1 }}>
              <MenuItem value="1">Active</MenuItem>
              <MenuItem value="0">Inactive</MenuItem>
            </TextField>
          </Stack>
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth multiline minRows={1} />

          <Typography variant="overline" color="text.secondary">
            Tasks
          </Typography>
          {items.map((it, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <TextField
                label={`Task ${i + 1}`}
                value={it.title}
                onChange={(e) => setItem(i, { title: e.target.value })}
                sx={{ flex: 1 }}
                size="small"
              />
              <TextField
                label="Due (days)"
                type="number"
                value={it.due_offset_days}
                onChange={(e) => setItem(i, { due_offset_days: Number(e.target.value) })}
                sx={{ width: 110 }}
                size="small"
              />
              <IconButton size="small" color="error" onClick={() => removeItem(i)} disabled={items.length === 1}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Button size="small" startIcon={<AddIcon />} onClick={addItem} sx={{ alignSelf: "flex-start" }}>
            Add task
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
