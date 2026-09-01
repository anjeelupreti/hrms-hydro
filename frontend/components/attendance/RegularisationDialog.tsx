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
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import { useRaiseRegularisation } from "@/hooks/useRegularisation";
import { todayIso } from "@/lib/format/period";

/**
 * Reporting that an attendance record is wrong.
 *
 * **A claim, not an edit.** Nothing here touches the attendance log — the
 * request goes to whoever can approve it, and only approval writes. Letting
 * this save directly would make attendance self-service editable, which is the
 * same thing as not recording attendance at all.
 *
 * **The reason is required and the times are not.** The commonest case is a
 * day with no record whatsoever — a badge that did not read — so a form that
 * insists on correcting existing times cannot report the very thing it exists
 * for. What the approver actually decides on is the reason.
 */

const STATUS_OPTIONS = [
  { value: "", label: "Leave as it is" },
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "half_day", label: "Half day" },
  { value: "absent", label: "Absent" },
];

export default function RegularisationDialog({
  open,
  onClose,
  /** Pre-filled when raised from a specific day. */
  date,
}: {
  open: boolean;
  onClose: () => void;
  date?: string;
}) {
  const raise = useRaiseRegularisation();
  const [form, setForm] = useState({
    date: date ?? todayIso(),
    reason: "",
    requested_check_in: "",
    requested_check_out: "",
    requested_status: "",
  });
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!form.reason.trim()) {
      setError("Say what was wrong — the approver decides on the reason.");
      return;
    }
    try {
      await raise.mutateAsync({
        date: form.date,
        reason: form.reason.trim(),
        // Times are sent only when given. An empty string is not "midnight".
        requested_check_in: form.requested_check_in
          ? new Date(`${form.date}T${form.requested_check_in}`).toISOString()
          : null,
        requested_check_out: form.requested_check_out
          ? new Date(`${form.date}T${form.requested_check_out}`).toISOString()
          : null,
        requested_status: form.requested_status || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Report an attendance problem</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          This does not change your attendance. It goes to whoever approves
          attendance, and only their approval updates the record.
        </Alert>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        <Stack spacing={2}>
          <DateField
            label="Which day"
            value={form.date}
            onChange={(value) => setForm({ ...form, date: value ?? form.date })}
          />

          <TextField
            label="What was wrong"
            placeholder="My badge did not read when I arrived at 09:15."
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            multiline
            minRows={3}
            required
            fullWidth
          />

          <Typography variant="caption" color="text.secondary">
            The rest is optional — fill in only what you know. A day with no record at all is
            the commonest case, and leaving these blank is fine.
          </Typography>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Arrived"
              type="time"
              value={form.requested_check_in}
              onChange={(e) => setForm({ ...form, requested_check_in: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              label="Left"
              type="time"
              value={form.requested_check_out}
              onChange={(e) => setForm({ ...form, requested_check_out: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Stack>

          <TextField
            select
            label="Should the day be recorded as"
            value={form.requested_status}
            onChange={(e) => setForm({ ...form, requested_status: e.target.value })}
            fullWidth
          >
            {STATUS_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={raise.isPending}>
          {raise.isPending ? "Sending…" : "Send request"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
