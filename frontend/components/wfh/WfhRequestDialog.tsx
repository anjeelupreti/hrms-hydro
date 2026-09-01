"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import { useCreateWfh } from "@/hooks/useWfh";
import type { WorkLocation } from "@/types/wfh";

export default function WfhRequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createWfh = useCreateWfh();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState<WorkLocation>("home");
  const [locationNote, setLocationNote] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await createWfh.mutateAsync({
        start_date: start,
        end_date: end,
        work_location: location,
        location_note: locationNote,
        reason,
      });
      setStart("");
      setEnd("");
      setLocationNote("");
      setReason("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Request work from home</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={2}>
            <DateField label="From" value={start} onChange={setStart} />
            <DateField label="To" value={end} onChange={setEnd} />
          </Stack>
          <TextField select label="Location" fullWidth value={location} onChange={(e) => setLocation(e.target.value as WorkLocation)}>
            <MenuItem value="home">Home</MenuItem>
            <MenuItem value="remote">Remote (other)</MenuItem>
          </TextField>
          <TextField label="Location note" fullWidth placeholder="e.g. Pokhara" value={locationNote} onChange={(e) => setLocationNote(e.target.value)} />
          <TextField label="Reason" fullWidth multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={createWfh.isPending || !start || !end}>
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
}
