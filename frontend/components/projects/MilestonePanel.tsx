"use client";

/**
 * The dates this project owes somebody else.
 *
 * **Deliberately not the sprints tab.** A sprint is the team's own cadence —
 * internal, repeating, moved without a conversation. A milestone is a promise
 * made outwards, and on a client project it is what gets invoiced. Showing them
 * in one list would teach people the two can be treated the same, which is the
 * misunderstanding that lets a commitment slip quietly.
 *
 * **Nothing here marks a milestone done.** Progress comes from the tasks
 * beneath it, so the screen cannot claim delivery while work is open. The one
 * control that matters is the date, because moving it is a decision — and the
 * original is kept and shown, so "we said the 12th" survives the move.
 */

import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteOutlineIcon from "@mui/icons-material/Delete";
import FlagIcon from "@mui/icons-material/Flag";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import {
  useCreateMilestone,
  useDeleteMilestone,
  useMilestones,
  useUpdateMilestone,
} from "@/hooks/useProjects";
import type { Milestone } from "@/types/projects";

export default function MilestonePanel({
  projectId,
  canEdit,
  onError,
}: {
  projectId: number;
  canEdit: boolean;
  onError: (message: string) => void;
}) {
  const { data, isLoading } = useMilestones(projectId);
  const create = useCreateMilestone();
  const update = useUpdateMilestone();
  const remove = useDeleteMilestone();

  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [billable, setBillable] = useState(false);

  const rows = data?.results ?? [];

  async function add() {
    if (!name.trim() || !dueDate) return;
    try {
      await create.mutateAsync({
        project: projectId,
        name: name.trim(),
        description: description.trim(),
        due_date: dueDate,
        is_billable: billable,
      });
      setDialog(false);
      setName("");
      setDescription("");
      setDueDate("");
      setBillable(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "That milestone could not be saved.");
    }
  }

  if (isLoading) return <LinearProgress />;

  return (
    <Box>
      {rows.length === 0 ? (
        <EmptyState
          surface
          title="Nothing promised yet"
          description="A milestone is a date this project owes somebody outside the team — a delivery to a client, a handover, the point an invoice goes out. Unlike a sprint, it is not moved without a conversation, so the date it was first set for is kept when it changes."
          action={
            canEdit ? (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog(true)}>
                Add a milestone
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {canEdit ? (
            <Button
              startIcon={<AddIcon />}
              onClick={() => setDialog(true)}
              sx={{ mb: 1.5 }}
            >
              Add a milestone
            </Button>
          ) : null}

          <Stack spacing={1.5}>
            {rows.map((row) => (
              <MilestoneRow
                key={row.id}
                milestone={row}
                canEdit={canEdit}
                onMove={(due_date) =>
                  update
                    .mutateAsync({ id: row.id, values: { due_date } })
                    .catch((err: unknown) =>
                      onError(err instanceof Error ? err.message : "That date could not be saved."),
                    )
                }
                onRemove={() =>
                  remove
                    .mutateAsync(row.id)
                    .catch((err: unknown) =>
                      // The server refuses a milestone that has been reached,
                      // and its message says why. Shown verbatim.
                      onError(
                        err instanceof Error ? err.message : "That could not be removed.",
                      ),
                    )
                }
              />
            ))}
          </Stack>
        </>
      )}

      <Dialog open={dialog} onClose={() => setDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New milestone</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              label="Name"
              size="small"
              fullWidth
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Beta to the client"
            />
            <DateField
              label="Promised for"
              value={dueDate}
              onChange={(value) => setDueDate(value ?? "")}
            />
            <TextField
              label="What it covers"
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <FormControlLabel
              control={
                <Checkbox checked={billable} onChange={(e) => setBillable(e.target.checked)} />
              }
              label="Reaching this triggers an invoice"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={add}
            disabled={!name.trim() || !dueDate || create.isPending}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function MilestoneRow({
  milestone,
  canEdit,
  onMove,
  onRemove,
}: {
  milestone: Milestone;
  canEdit: boolean;
  onMove: (dueDate: string) => void;
  onRemove: () => void;
}) {
  const { done_count: done, task_count: total } = milestone;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Card
      variant="outlined"
      sx={{
        borderLeft: "4px solid",
        borderLeftColor: milestone.is_complete
          ? "success.main"
          : milestone.is_late
            ? "error.main"
            : "divider",
      }}
    >
      <CardContent sx={{ pb: "12px !important" }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          <FlagIcon
            fontSize="small"
            sx={{ mt: 0.25 }}
            color={milestone.is_complete ? "success" : milestone.is_late ? "error" : "disabled"}
          />

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {milestone.name}
              </Typography>

              {milestone.is_complete ? (
                <Chip
                  size="small"
                  color="success"
                  icon={<CheckCircleIcon />}
                  label="Reached"
                />
              ) : milestone.is_late ? (
                <Chip
                  size="small"
                  color="error"
                  icon={<WarningAmberIcon />}
                  label="Overdue"
                />
              ) : null}

              {milestone.is_billable ? (
                <Tooltip title="Reaching this triggers an invoice">
                  <ReceiptLongIcon sx={{ fontSize: 15 }} color="disabled" />
                </Tooltip>
              ) : null}
            </Stack>

            {milestone.description ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {milestone.description}
              </Typography>
            ) : null}

            {/* **The first date is shown next to the current one when they
                differ.** "We said the 12th and delivered on the 30th" is what
                anybody reviewing a project asks, and it is the only reason the
                original is stored rather than overwritten. */}
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: "center" }}>
              <Typography variant="caption" color="text.secondary">
                <DateText value={milestone.due_date} />
              </Typography>
              {milestone.has_slipped && milestone.original_due_date ? (
                <Tooltip title="The date this was first promised for">
                  <Typography
                    variant="caption"
                    color="warning.main"
                    sx={{ textDecoration: "line-through" }}
                  >
                    <DateText value={milestone.original_due_date} />
                  </Typography>
                </Tooltip>
              ) : null}
            </Stack>

            {/* Progress, from the tasks. A milestone with nothing attached
                reads as such rather than as 0% — they are different answers. */}
            {total > 0 ? (
              <Box sx={{ mt: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={percent}
                  color={milestone.is_complete ? "success" : milestone.is_late ? "error" : "primary"}
                  sx={{ height: 5, borderRadius: 3 }}
                />
                <Typography variant="caption" color="text.secondary">
                  {done} of {total} tasks done
                </Typography>
              </Box>
            ) : (
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.75 }}>
                No tasks attached yet
              </Typography>
            )}
          </Box>

          {canEdit ? (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 150 }}>
                <DateField
                  label="Move to"
                  value={milestone.due_date}
                  onChange={(value) => value && value !== milestone.due_date && onMove(value)}
                />
              </Box>
              {/* Offered on every milestone, refused by the server once one has
                  been reached — the guard lives in the service, not in whether
                  the button is drawn. */}
              <Tooltip title="Remove this milestone">
                <IconButton size="small" onClick={onRemove} aria-label={`Remove ${milestone.name}`}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
