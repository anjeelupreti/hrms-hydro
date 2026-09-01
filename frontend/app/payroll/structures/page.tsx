"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import LayersIcon from "@mui/icons-material/Layers";
import StarIcon from "@mui/icons-material/Star";
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
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import ConfirmDialog from "@/components/common/ConfirmDialog";
import DateField from "@/components/common/DateField";
import EmptyState from "@/components/common/EmptyState";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useSalaryComponents } from "@/hooks/usePayroll";
import { todayIso } from "@/lib/format/period";
import {
  type ApplyReport,
  type SalaryTemplate,
  useApplyTemplate,
  useDeleteSalaryTemplate,
  useSalaryTemplates,
  useSaveSalaryTemplate,
  useUnassignedEmployees,
} from "@/hooks/useSalaryTemplates";

/**
 * Salary structures at the level of the company rather than the person.
 *
 * Templates, and a way to align a workforce to one. A salary structure is
 * per-person and effective-dated — correctly, since it is the record of what
 * somebody was actually paid from when — which leaves no way to say "everyone
 * in this grade is paid like this", and no way to put a hundred new people on
 * pay without a hundred identical forms.
 *
 * **Templates are editable and structures are not**, and the page says so out
 * loud, because the difference looks like an inconsistency until you know why.
 * Applying a template *copies* it; the copy keeps no link back, so editing a
 * template never restates what somebody has already been paid.
 */

const emptyDraft = { name: "", description: "", is_default: false, lines: [] as { component: number; amount: string }[] };


export default function SalaryStructuresPage() {
  const { data: templates, isLoading } = useSalaryTemplates();
  const { data: unassigned } = useUnassignedEmployees();
  const { data: componentsPage } = useSalaryComponents();
  const components = componentsPage?.results ?? [];

  const save = useSaveSalaryTemplate();
  const remove = useDeleteSalaryTemplate();
  const applyTemplate = useApplyTemplate();

  const [editing, setEditing] = useState<SalaryTemplate | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [formOpen, setFormOpen] = useState(false);
  const [removing, setRemoving] = useState<SalaryTemplate | null>(null);
  const [applying, setApplying] = useState<SalaryTemplate | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [report, setReport] = useState<ApplyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setDraft(emptyDraft);
    setFormOpen(true);
  }

  function openEdit(template: SalaryTemplate) {
    setEditing(template);
    setDraft({
      name: template.name,
      description: template.description,
      is_default: template.is_default,
      lines: template.lines.map((l) => ({ component: l.component, amount: l.amount ?? "" })),
    });
    setFormOpen(true);
  }

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({
        id: editing?.id,
        values: {
          ...draft,
          lines: draft.lines.map((l) => ({ component: l.component, amount: l.amount === "" ? null : l.amount })),
        },
      });
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function runApply() {
    if (!applying) return;
    setError(null);
    try {
      const result = await applyTemplate.mutateAsync({
        id: applying.id,
        effective_from: effectiveFrom,
        replace_existing: replaceExisting,
      });
      setReport(result);
      setApplying(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Salary structures"
        subtitle="Define a structure once, then put people on it."
        icon={<LayersIcon />}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
            New template
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* The number that turns "align everyone" from a guess into a decision.
          Counted over the whole workforce on the server — counting a page in
          the browser would understate it on any company past the page cap, and
          understating this number means quietly leaving people unpaid. */}
      {unassigned !== undefined && unassigned.count > 0 && (
        <Alert
          severity="warning"
          icon={<GroupAddIcon />}
          sx={{ mb: 3 }}
          action={
            templates && templates.length > 0 ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  setApplying(templates.find((t) => t.is_default) ?? templates[0]);
                  setReplaceExisting(false);
                }}
              >
                Put them on pay
              </Button>
            ) : undefined
          }
        >
          <strong>
            {unassigned.count} {unassigned.count === 1 ? "person has" : "people have"} no salary
            structure.
          </strong>{" "}
          Payroll cannot pay somebody it has no structure for — they are skipped, silently, on
          every run.
        </Alert>
      )}

      {isLoading && <Skeleton variant="rounded" height={200} />}

      {!isLoading && (!templates || templates.length === 0) && (
        <EmptyState
          title="No salary templates yet"
          description="A template is a set of components with amounts — Basic, allowances, deductions — that you can stamp onto one person or the whole company. Unlike a salary structure, a template can be edited freely: it is a starting point, not a record of what anybody was paid."
          action={
            <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
              Create the first template
            </Button>
          }
        />
      )}

      <Grid container spacing={2}>
        {(templates ?? []).map((template) => (
          <Grid size={{ xs: 12, md: 6 }} key={template.id}>
            <Card variant="outlined" sx={{ height: "100%" }}>
              <CardContent>
                <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 0.5 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {template.name}
                  </Typography>
                  {template.is_default && (
                    <Chip
                      size="small"
                      color="primary"
                      icon={<StarIcon />}
                      label="Default"
                    />
                  )}
                  <Box sx={{ flex: 1 }} />
                  <Tooltip title="Edit this template">
                    <IconButton size="small" onClick={() => openEdit(template)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Remove this template">
                    <IconButton size="small" onClick={() => setRemoving(template)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>

                {template.description && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {template.description}
                  </Typography>
                )}

                <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 2 }}>
                  {template.lines.map((line) => (
                    <Chip
                      key={line.component_code}
                      size="small"
                      variant="outlined"
                      color={line.component_type === "deduction" ? "default" : "primary"}
                      label={
                        line.calc_type === "flat" && line.amount
                          ? `${line.component_name} · ${Number(line.amount).toLocaleString()}`
                          : line.component_name
                      }
                    />
                  ))}
                </Box>

                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<GroupAddIcon />}
                  onClick={() => {
                    setApplying(template);
                    setReplaceExisting(false);
                    setEffectiveFrom(todayIso());
                  }}
                >
                  Put people on this
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* ── The template form ─────────────────────────────────────────── */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Edit ${editing.name}` : "New salary template"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Name"
              fullWidth
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Officer, Technician, Plant operator…"
            />
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />

            <Typography variant="subtitle2" sx={{ pt: 1 }}>
              Components
            </Typography>
            {draft.lines.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Nothing yet. A template with no components would pay nothing, so at least one is
                needed.
              </Typography>
            )}
            {draft.lines.map((line, index) => {
              const component = components.find((c) => c.id === line.component);
              const needsAmount =
                component?.calc_type === "flat" || component?.calc_type === "percentage_of";
              return (
                <Box key={index} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <TextField
                    select
                    label="Component"
                    sx={{ flex: 2 }}
                    value={line.component || ""}
                    onChange={(e) => {
                      const next = [...draft.lines];
                      next[index] = { ...next[index], component: Number(e.target.value) };
                      setDraft({ ...draft, lines: next });
                    }}
                  >
                    {components.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label={component?.calc_type === "percentage_of" ? "Percent" : "Amount"}
                    sx={{ flex: 1 }}
                    value={line.amount}
                    disabled={!needsAmount}
                    // Formula and slab-based components work themselves out
                    // every run, so an amount here would be a number nobody
                    // reads — disabled rather than hidden, so the row still
                    // lines up with the ones above it.
                    helperText={needsAmount ? undefined : "Computed each run"}
                    onChange={(e) => {
                      const next = [...draft.lines];
                      next[index] = { ...next[index], amount: e.target.value };
                      setDraft({ ...draft, lines: next });
                    }}
                  />
                  <IconButton
                    aria-label="Remove this component"
                    onClick={() =>
                      setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })
                    }
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              );
            })}
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() =>
                setDraft({ ...draft, lines: [...draft.lines, { component: 0, amount: "" }] })
              }
            >
              Add a component
            </Button>

            <FormControlLabel
              control={
                <Switch
                  checked={draft.is_default}
                  onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })}
                />
              }
              label="Make this the default template"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={!draft.name || draft.lines.length === 0 || save.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Applying it ───────────────────────────────────────────────── */}
      <Dialog open={applying !== null} onClose={() => setApplying(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Put people on “{applying?.name}”</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              This creates a salary structure for{" "}
              <strong>
                {replaceExisting
                  ? "everybody active"
                  : `the ${unassigned?.count ?? 0} people who have none`}
              </strong>
              , effective from the date below.
            </Typography>

            <DateField
              label="Effective from"
              value={effectiveFrom}
              onChange={(value) => setEffectiveFrom(value || todayIso())}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                />
              }
              label="Also move people who are already on a structure"
            />
            {replaceExisting && (
              // Said plainly, because "replace" is a frightening word next to
              // payroll and the thing it actually does is additive.
              <Alert severity="info">
                Their existing structure is left exactly as it is and keeps governing every run
                dated before this. A new one is added alongside it.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApplying(null)}>Cancel</Button>
          <Button variant="contained" onClick={runApply} disabled={applyTemplate.isPending}>
            Apply
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── What actually happened ────────────────────────────────────── */}
      <Dialog open={report !== null} onClose={() => setReport(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Done</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1.5 }}>
            {report?.created_count} put on pay
            {report?.skipped_count ? `, ${report.skipped_count} skipped` : ""}.
          </Typography>
          {/* Named, not counted. "3 skipped" leaves somebody guessing which
              three, and the two reasons need different answers. */}
          {report?.already_on_pay?.length ? (
            <Alert severity="info" sx={{ mb: 1 }}>
              Already on a structure, and left alone: {report.already_on_pay.join(", ")}
            </Alert>
          ) : null}
          {report?.already_dated?.length ? (
            <Alert severity="info">
              Already had a structure starting on that exact date:{" "}
              {report.already_dated.join(", ")}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setReport(null)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        title={`Remove “${removing?.name}”?`}
        description="Nobody's pay changes. A structure stamped from this template is an independent copy and keeps working exactly as it does now — this only removes the starting point."
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.id);
          setRemoving(null);
        }}
      />
    </PageContainer>
  );
}
