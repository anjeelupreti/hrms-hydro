"use client";

import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import RuleIcon from "@mui/icons-material/Rule";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import StateChip from "@/components/common/StateChip";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  useDeleteMemorandumAction,
  useMemorandumActions,
  useSaveMemorandumAction,
} from "@/hooks/useMemoranda";
import { useCan, useCanCreate, useCanDelete } from "@/hooks/useMe";
import type { MemorandumAction, MemorandumEffect } from "@/types/memoranda";

/**
 * The words a handler can put on a memorandum, and what each one does.
 *
 * **Configuration, not code**, for the same reason salary components are: every
 * organisation has its own vocabulary — *recommended*, *noted*, *reviewed*,
 * *verified*, *supported* — and the list is argued over and added to. A fixed
 * enum would mean a deploy to add "verified".
 *
 * **`Effect` is what makes a word more than a label.** There are exactly two
 * things a handler can do: send it on, or send it back. Everything else is
 * which word appears in the log — so the machinery reads the effect and never
 * the name, and a new word is a row rather than a branch.
 *
 * Set by the owner or an HR admin; read by everybody, because a dropdown whose
 * meaning the reader cannot look up is worse than no dropdown.
 */

const EMPTY = {
  name: "",
  code: "",
  effect: "proceed" as MemorandumEffect,
  description: "",
  order: 0,
  is_active: true,
  for_approver: false,
};

export default function MemorandumActionsPage() {
  const canManage = useCan("settings.manage");
  const canCreate = useCanCreate("settings.manage");
  const canDelete = useCanDelete("settings.manage");

  const { data, isLoading } = useMemorandumActions();
  const save = useSaveMemorandumAction();
  const remove = useDeleteMemorandumAction();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MemorandumAction | null>(null);
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const actions = data?.results ?? [];

  function start(action: MemorandumAction | null) {
    setEditing(action);
    setValues(
      action
        ? {
            name: action.name,
            code: action.code,
            effect: action.effect,
            description: action.description,
            order: action.order,
            is_active: action.is_active,
            for_approver: action.for_approver,
          }
        : { ...EMPTY, order: (actions.at(-1)?.order ?? 0) + 1 }
    );
    setError(null);
    setOpen(true);
  }

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({ id: editing?.id, values });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  async function drop(action: MemorandumAction) {
    setError(null);
    try {
      await remove.mutateAsync(action.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be removed.");
    }
  }

  return (
    <PageContainer>
      <Breadcrumbs />
      <Button component={Link} href="/memoranda" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 2 }}>
        Memoranda
      </Button>

      <PageHeader
        title="Memorandum actions"
        subtitle="The words a recommender or approver puts on a memorandum, and what each one does"
        icon={<RuleIcon />}
        actions={
          canCreate ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => start(null)}>
              Add an action
            </Button>
          ) : null
        }
      />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Alert severity="info" sx={{ mb: 2 }}>
        A memorandum can only go two ways: <strong>on</strong>, to the next
        person in the chain, or <strong>back</strong>, to somebody who has
        already seen it. These are the words for those two things — the wording
        is yours, the effect is what the system reads.
      </Alert>

      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Word</TableCell>
                <TableCell>Code</TableCell>
                <TableCell>Effect</TableCell>
                <TableCell>Meaning</TableCell>
                <TableCell align="center">Approver</TableCell>
                <TableCell align="center">Active</TableCell>
                {canManage ? <TableCell /> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7}>Loading…</TableCell>
                </TableRow>
              ) : actions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      None yet. Without at least one “send on” word, nobody can
                      move a memorandum forward.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                actions.map((action) => (
                  <TableRow key={action.id} sx={{ opacity: action.is_active ? 1 : 0.55 }}>
                    <TableCell sx={{ fontWeight: 600 }}>{action.name}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                      {action.code}
                    </TableCell>
                    <TableCell>
                      <StateChip
                        label={action.effect === "proceed" ? "Sends it on" : "Sends it back"}
                        tone={action.effect === "proceed" ? "normal" : "caution"}
                      />
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary" }}>{action.description || "—"}</TableCell>
                    <TableCell align="center">
                      <Checkbox size="small" checked={action.for_approver} disabled />
                    </TableCell>
                    <TableCell align="center">
                      <Checkbox size="small" checked={action.is_active} disabled />
                    </TableCell>
                    {canManage ? (
                      <TableCell align="right">
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => start(action)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {canDelete ? (
                          <Tooltip title="Remove — refused once it has been used">
                            <IconButton size="small" onClick={() => drop(action)}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Edit “${editing.name}”` : "Add an action"}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 7 }}>
              <TextField
                label="Word"
                fullWidth
                required
                autoFocus
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
                helperText="What appears in the log — “Recommended”, “Verified”."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField
                label="Code"
                fullWidth
                required
                value={values.code}
                onChange={(e) => setValues({ ...values, code: e.target.value.toUpperCase() })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                label="Effect"
                fullWidth
                value={values.effect}
                onChange={(e) =>
                  setValues({ ...values, effect: e.target.value as MemorandumEffect })
                }
                helperText="The only part the system reads."
              >
                <MenuItem value="proceed">Send it on</MenuItem>
                <MenuItem value="return">Send it back</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Order"
                type="number"
                fullWidth
                value={values.order}
                onChange={(e) => setValues({ ...values, order: Number(e.target.value) })}
                helperText="Where it sits in the dropdown."
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Meaning"
                fullWidth
                value={values.description}
                onChange={(e) => setValues({ ...values, description: e.target.value })}
                helperText="What choosing it says. Shown to whoever is picking."
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={values.for_approver}
                    onChange={(e) => setValues({ ...values, for_approver: e.target.checked })}
                  />
                }
                label="Also offered to the approver"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                Most recommendation words are not. “Recommended” is not something
                an approver says, and offering it there leaves a memorandum
                neither approved nor refused with nowhere left to go.
              </Typography>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={values.is_active}
                    onChange={(e) => setValues({ ...values, is_active: e.target.checked })}
                  />
                }
                label="Active"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                Deactivating takes it out of every dropdown and keeps the history
                readable — which is why a used word cannot be deleted.
              </Typography>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={save.isPending || !values.name.trim() || !values.code.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
