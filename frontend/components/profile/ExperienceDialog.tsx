"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { useAddExperience, type ExperienceKind } from "@/hooks/useProfile";

/**
 * Adding a post somebody has held.
 *
 * `kind` is fixed by the caller rather than offered as a dropdown. The two
 * sections on the profile are already labelled — "Previous employment" and
 * "Held here" — so asking again inside the dialog would be the same question
 * twice, and the answer somebody picks would be able to contradict the button
 * they pressed to get here.
 */
export default function ExperienceDialog({
  onClose,
  kind = "previous",
}: {
  onClose: () => void;
  kind?: ExperienceKind;
}) {
  const addExperience = useAddExperience();
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [startYear, setStartYear] = useState("");
  const [endYear, setEndYear] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isInternal = kind === "internal";

  async function handleSave() {
    setError(null);
    try {
      await addExperience.mutateAsync({
        kind,
        title,
        company,
        start_year: startYear ? Number(startYear) : null,
        end_year: endYear ? Number(endYear) : null,
        description,
        // Only HR verifies, and only a previous post needs it — an internal
        // one is a fact this system wrote itself.
        is_verified: false,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isInternal ? "Add a post held here" : "Add previous employment"}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {isInternal
            ? "A post held inside this company."
            : "Somewhere else, before joining. HR marks it verified once they have seen a document."}
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Title"
            fullWidth
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {/* Meaningless on an internal post — the company is this one — so it
              is not shown rather than shown and left empty. */}
          {!isInternal && (
            <TextField
              label="Company"
              fullWidth
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          )}
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
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={addExperience.isPending || !title.trim()}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
