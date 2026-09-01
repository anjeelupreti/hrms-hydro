"use client";

import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import ConfirmDialog from "@/components/common/ConfirmDialog";
import {
  useCreateLeaveType,
  useDeleteLeaveType,
  useLeaveTypes,
  useSetLeaveTypeActive,
} from "@/hooks/useLeave";
import type { LeaveType } from "@/types/leave";

export default function LeaveTypeManager() {
  const { data: leaveTypes } = useLeaveTypes();
  const createType = useCreateLeaveType();
  const removeType = useDeleteLeaveType();
  const setActive = useSetLeaveTypeActive();
  const [confirmDelete, setConfirmDelete] = useState<LeaveType | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [isPaid, setIsPaid] = useState(true);
  const [quota, setQuota] = useState("");
  const [carryForward, setCarryForward] = useState(false);
  const [maxCarryForward, setMaxCarryForward] = useState("0");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    try {
      await createType.mutateAsync({
        name,
        code,
        is_paid: isPaid,
        annual_quota_days: quota || "0",
        carry_forward_allowed: carryForward,
        max_carry_forward_days: maxCarryForward || "0",
      });
      setOpen(false);
      setName("");
      setCode("");
      setQuota("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <Typography variant="h6">Leave types</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Add leave type
        </Button>
      </Stack>
      {/* `onDelete` removes a leave type outright, which the API allows
          only while nothing references it — otherwise it refuses with the
          count. The retire toggle is the answer in that case: it stops the
          type being offered without erasing anyone's leave history. */}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        {leaveTypes?.results.map((lt) => (
          <Chip
            key={lt.id}
            label={`${lt.name} · ${lt.annual_quota_days}d${lt.is_paid ? "" : " (unpaid)"}`}
            variant={lt.is_active ? "filled" : "outlined"}
            color={lt.is_active ? "default" : "warning"}
            onDelete={() => setConfirmDelete(lt)}
            icon={
              <Tooltip title={lt.is_active ? "Retire this type" : "Offer this type again"}>
                <IconButton
                  size="small"
                  aria-label={lt.is_active ? `Retire ${lt.name}` : `Reactivate ${lt.name}`}
                  onClick={() => setActive.mutate({ id: lt.id, active: !lt.is_active })}
                  disabled={setActive.isPending}
                >
                  {lt.is_active ? (
                    <ArchiveIcon sx={{ fontSize: 15 }} />
                  ) : (
                    <UnarchiveIcon sx={{ fontSize: 15 }} />
                  )}
                </IconButton>
              </Tooltip>
            }
          />
        ))}
      </Stack>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={`Delete ${confirmDelete?.name ?? ""}?`}
        description={
          "If anyone has requested this leave type it cannot be deleted — you " +
          "will be told how many requests use it, and can retire it instead so " +
          "it disappears from new requests without touching the old ones."
        }
        confirmLabel="Delete"
        loading={removeType.isPending}
        onConfirm={() => {
          if (confirmDelete) removeType.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onClose={() => setConfirmDelete(null)}
      />

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add leave type</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Name" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Code" fullWidth value={code} onChange={(e) => setCode(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Annual quota (days)"
                type="number"
                fullWidth
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControlLabel
                control={<Checkbox checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} />}
                label="Paid"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={carryForward}
                    onChange={(e) => setCarryForward(e.target.checked)}
                  />
                }
                label="Allow carry-forward"
              />
            </Grid>
            {carryForward && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Max carry-forward (days)"
                  type="number"
                  fullWidth
                  value={maxCarryForward}
                  onChange={(e) => setMaxCarryForward(e.target.value)}
                />
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createType.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
