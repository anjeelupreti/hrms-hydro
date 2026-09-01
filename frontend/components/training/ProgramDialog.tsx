"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import { useState } from "react";

import { useSaveProgram } from "@/hooks/useTraining";
import type { DeliveryMode, TrainingProgram } from "@/types/training";

type Props = {
  open: boolean;
  onClose: () => void;
  program: TrainingProgram | null;
};

export default function ProgramDialog({ open, onClose, program }: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <ProgramForm key={program?.id ?? "new"} onClose={onClose} program={program} />
    </Dialog>
  );
}

function ProgramForm({ onClose, program }: Omit<Props, "open">) {
  const saveProgram = useSaveProgram();
  const [title, setTitle] = useState(program?.title ?? "");
  const [description, setDescription] = useState(program?.description ?? "");
  const [category, setCategory] = useState(program?.category ?? "");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(program?.delivery_mode ?? "in_person");
  const [isActive, setIsActive] = useState(program?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await saveProgram.mutateAsync({
        id: program?.id,
        values: { title, description, category, delivery_mode: deliveryMode, is_active: isActive },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
      <DialogTitle>{program ? "Edit program" : "New training program"}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextField
            label="Category"
            fullWidth
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Compliance, Technical, Onboarding"
          />
          <TextField
            select
            label="Delivery mode"
            fullWidth
            value={deliveryMode}
            onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}
          >
            <MenuItem value="in_person">In person</MenuItem>
            <MenuItem value="online">Online</MenuItem>
            <MenuItem value="hybrid">Hybrid</MenuItem>
          </TextField>
          <TextField
            label="Description"
            fullWidth
            multiline
            minRows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <FormControlLabel
            control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
            label="Active (visible to employees)"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saveProgram.isPending || !title.trim()}>
          Save
        </Button>
      </DialogActions>
    </>
  );
}
