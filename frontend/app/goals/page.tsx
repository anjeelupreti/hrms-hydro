"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import FlagIcon from "@mui/icons-material/Flag";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import ObjectiveRoadmap from "@/components/goals/ObjectiveRoadmap";
import PageContainer from "@/components/shell/PageContainer";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import { ArchiveButton, ArchiveTabs } from "@/components/common/ArchiveControls";
import { useArchive } from "@/hooks/useCollaboration";
import { useTextFilter } from "@/hooks/useTextFilter";
import {
  useCheckinKeyResult,
  useDeleteObjective,
  useObjectives,
  useSaveObjective,
  type KeyResult,
  type Objective,
} from "@/hooks/useGoals";
import { useCan, useMe } from "@/hooks/useMe";

export default function GoalsPage() {
  const { data: me } = useMe();
  const isHR = useCan("workplace.manage");
  const [archived, setArchived] = useState(false);
  const { data } = useObjectives({ archived });
  const archiveObjective = useArchive("goals/objectives", "goals");
  const del = useDeleteObjective();
  const [editing, setEditing] = useState<Objective | null | undefined>(undefined);

  const objectives = data?.results ?? [];
  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(objectives, (o) => [
    o.title,
    o.description,
    o.period,
    o.owner_name,
    ...o.key_results.map((kr) => kr.title),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Goals & OKRs"
        subtitle="Objectives and measurable key results"
        icon={<FlagIcon />}
        actions={
          <>
            
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>
              New objective
            </Button>
          </>
        }
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search objectives…"
        searchLabel="Search objectives by title, owner, period or key result"
      />
      {/* The reading, before the list. Only on the live list — a spread of
          archived objectives describes a year nobody is working on. */}
      {/* The roadmap, and deliberately not also a spread of every objective on
          a 0–100 axis: the roadmap shows the same percentages plus what they
          are made of, so the two together would be one reading twice.

          The list below stays because it does a different job: it is where a check-in
          is *entered*. Graph above, editor below. */}
      {archived ? null : <ObjectiveRoadmap objectives={objectives} />}
      <Stack spacing={2}>
        <ArchiveTabs archived={archived} onChange={setArchived} />
        {filtered.length === 0 ? (
          <EmptyState
            variant={isEmptyResult ? "noResults" : "empty"}
            title={isEmptyResult ? `No objectives match “${query}”` : "No objectives yet"}
            description={
              isEmptyResult
              ? "Try a different search, or clear it to see everything."
              : "Objectives are what the team is trying to achieve; key results are how you will know. Each key result carries a start, a target and a current value, so progress is measured rather than asserted."
            }
            surface
          />
        ) : (
          filtered.map((o) => (
            <ObjectiveCard
              key={o.id}
              objective={o}
              canEdit={Boolean(isHR) || o.owner === me?.employee_id}
              onEdit={() => setEditing(o)}
              onDelete={() => del.mutate(o.id)}
              archived={archived}
              onArchive={() => archiveObjective.mutate({ id: o.id, archived })}
            />
          ))
        )}
      </Stack>
      {editing !== undefined && (
        <ObjectiveDialog objective={editing} isHR={Boolean(isHR)} onClose={() => setEditing(undefined)} />
      )}
    </PageContainer>
  );
}

function ObjectiveCard({
  objective,
  canEdit,
  onEdit,
  onDelete,
  archived = false,
  onArchive,
}: {
  objective: Objective;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  archived?: boolean;
  onArchive?: () => void;
}) {
  const checkin = useCheckinKeyResult();

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {objective.title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {objective.owner_name}
              {objective.period ? ` · ${objective.period}` : ""}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Chip size="small" label={`${objective.progress}%`} color={objective.progress >= 100 ? "success" : "primary"} />
            {canEdit && (
              <>
                {onArchive && (
                  <ArchiveButton archived={archived} noun="objective" onToggle={onArchive} />
                )}
                <IconButton size="small" onClick={onEdit}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={onDelete}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </>
            )}
          </Stack>
        </Stack>

        <LinearProgress variant="determinate" value={objective.progress} sx={{ my: 1.5, height: 8, borderRadius: 4 }} />

        <Stack spacing={1.5}>
          {objective.key_results.map((kr) => (
            <Box key={kr.id}>
              <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="body2">{kr.title}</Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {canEdit ? (
                    <TextField
                      size="small"
                      type="number"
                      defaultValue={kr.current_value}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (kr.id != null && v !== Number(kr.current_value)) {
                          checkin.mutate({ objectiveId: objective.id, key_result: kr.id, current_value: v });
                        }
                      }}
                      sx={{ width: 90 }}
                    />
                  ) : (
                    <Typography variant="body2">{kr.current_value}</Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    / {kr.target_value} {kr.unit}
                  </Typography>
                  <Chip size="small" variant="outlined" label={`${kr.progress ?? 0}%`} />
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

function ObjectiveDialog({
  objective,
  isHR,
  onClose,
}: {
  objective: Objective | null;
  isHR: boolean;
  onClose: () => void;
}) {
  const save = useSaveObjective();
  const [title, setTitle] = useState(objective?.title ?? "");
  const [period, setPeriod] = useState(objective?.period ?? "");
  const [description, setDescription] = useState(objective?.description ?? "");
  const [krs, setKrs] = useState<KeyResult[]>(
    objective?.key_results?.length
      ? objective.key_results
      : [{ title: "", start_value: 0, target_value: 100, current_value: 0, unit: "" }]
  );
  const [error, setError] = useState<string | null>(null);

  function setKr(i: number, patch: Partial<KeyResult>) {
    setKrs((prev) => prev.map((k, idx) => (idx === i ? { ...k, ...patch } : k)));
  }

  async function submit() {
    setError(null);
    const clean = krs.filter((k) => k.title.trim()).map((k, i) => ({ ...k, order: i }));
    if (!title.trim() || clean.length === 0) {
      setError("A title and at least one key result are required.");
      return;
    }
    try {
      await save.mutateAsync({ id: objective?.id, values: { title, period, description, key_results: clean } });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{objective ? "Edit objective" : "New objective"}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Objective" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
          <TextField label="Period (e.g. Q3 2026)" value={period} onChange={(e) => setPeriod(e.target.value)} fullWidth />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth multiline minRows={1} />
          {isHR && !objective && (
            <Typography variant="caption" color="text.secondary">
              Leave unassigned to create a company-wide objective, or assign it later.
            </Typography>
          )}

          <Typography variant="overline" color="text.secondary">Key results</Typography>
          {krs.map((kr, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <TextField label={`KR ${i + 1}`} value={kr.title} onChange={(e) => setKr(i, { title: e.target.value })} size="small" sx={{ flex: 1 }} />
              <TextField label="Start" type="number" value={kr.start_value} onChange={(e) => setKr(i, { start_value: e.target.value })} size="small" sx={{ width: 80 }} />
              <TextField label="Target" type="number" value={kr.target_value} onChange={(e) => setKr(i, { target_value: e.target.value })} size="small" sx={{ width: 80 }} />
              <TextField label="Unit" value={kr.unit} onChange={(e) => setKr(i, { unit: e.target.value })} size="small" sx={{ width: 70 }} />
              <IconButton size="small" color="error" onClick={() => setKrs((prev) => prev.filter((_, idx) => idx !== i))} disabled={krs.length === 1}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Button size="small" startIcon={<AddIcon />} onClick={() => setKrs((prev) => [...prev, { title: "", start_value: 0, target_value: 100, current_value: 0, unit: "" }])} sx={{ alignSelf: "flex-start" }}>
            Add key result
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
