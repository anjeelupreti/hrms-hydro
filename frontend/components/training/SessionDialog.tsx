"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";

import DateTimeField from "@/components/common/DateTimeField";
import { useSaveSession } from "@/hooks/useTraining";
import type { TrainingSession } from "@/types/training";
import { EmployeePicker } from "@/components/common/pickers";

type Props = {
  open: boolean;
  onClose: () => void;
  programId: number;
  session: TrainingSession | null;
};

export default function SessionDialog({ open, onClose, programId, session }: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <SessionForm key={session?.id ?? "new"} onClose={onClose} programId={programId} session={session} />
    </Dialog>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SessionForm({ onClose, programId, session }: Omit<Props, "open">) {
  const saveSession = useSaveSession();

  const [start, setStart] = useState(session ? toLocalInput(session.start_datetime) : "");
  const [end, setEnd] = useState(session ? toLocalInput(session.end_datetime) : "");
  const [location, setLocation] = useState(session?.location ?? "");
  const [capacity, setCapacity] = useState(session?.capacity ?? 0);
  const [trainer, setTrainer] = useState<number | "">(session?.trainer ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await saveSession.mutateAsync({
        id: session?.id,
        values: {
          program: programId,
          start_datetime: new Date(start).toISOString(),
          end_datetime: new Date(end).toISOString(),
          location,
          capacity: Number(capacity),
          trainer: trainer === "" ? null : Number(trainer),
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
      <DialogTitle>{session ? "Edit session" : "Schedule a session"}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <DateTimeField label="Start" value={start} onChange={setStart} />
            <DateTimeField label="End" value={end} onChange={setEnd} />
          </Stack>
          <TextField
            label="Location / link"
            fullWidth
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <TextField
            label="Capacity (0 = unlimited)"
            type="number"
            fullWidth
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
          <EmployeePicker
            label="Trainer"
            value={trainer === "" ? null : trainer}
            onChange={(id) => setTrainer(id ?? "")}
            helperText="Optional — leave empty if the trainer is external."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saveSession.isPending || !start || !end}>
          Save
        </Button>
      </DialogActions>
    </>
  );
}
