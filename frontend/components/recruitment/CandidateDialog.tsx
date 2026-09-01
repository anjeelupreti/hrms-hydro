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

import { useSaveCandidate } from "@/hooks/useRecruitment";

type Props = { open: boolean; onClose: () => void; jobId: number };

export default function CandidateDialog({ open, onClose, jobId }: Props) {
  const saveCandidate = useSaveCandidate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await saveCandidate.mutateAsync({ values: { job: jobId, name, email, phone, source } });
      setName("");
      setEmail("");
      setPhone("");
      setSource("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add candidate</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Name" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Email" fullWidth value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="Phone" fullWidth value={phone} onChange={(e) => setPhone(e.target.value)} />
          <TextField label="Source" fullWidth placeholder="LinkedIn, Referral…" value={source} onChange={(e) => setSource(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saveCandidate.isPending || !name.trim()}>
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
