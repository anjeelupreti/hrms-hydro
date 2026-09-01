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

import { useAddExperience } from "@/hooks/useProfile";

export default function ExperienceDialog({ onClose }: { onClose: () => void }) {
  const addExperience = useAddExperience();
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [startYear, setStartYear] = useState("");
  const [endYear, setEndYear] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await addExperience.mutateAsync({
        title,
        company,
        start_year: startYear ? Number(startYear) : null,
        end_year: endYear ? Number(endYear) : null,
        description,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add experience</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextField label="Company" fullWidth value={company} onChange={(e) => setCompany(e.target.value)} />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Start year"
              type="number"
              fullWidth
              value={startYear}
              onChange={(e) => setStartYear(e.target.value)}
            />
            <TextField
              label="End year"
              type="number"
              fullWidth
              value={endYear}
              onChange={(e) => setEndYear(e.target.value)}
              placeholder="Present"
            />
          </Stack>
          <TextField
            label="Description"
            fullWidth
            multiline
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={addExperience.isPending || !title.trim()}>
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
