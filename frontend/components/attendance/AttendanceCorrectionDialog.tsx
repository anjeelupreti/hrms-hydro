"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateTimeField from "@/components/common/DateTimeField";
import { useAttendanceEditLogs, useCorrectAttendanceLog } from "@/hooks/useAttendance";
import type { AttendanceLog, AttendanceStatus } from "@/types/attendance";

const STATUSES: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
  { value: "half_day", label: "Half Day" },
];

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  log: AttendanceLog | null;
};

export default function AttendanceCorrectionDialog({ open, onClose, log }: Props) {
  if (!log) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <CorrectionForm key={log.id} log={log} onClose={onClose} />
    </Dialog>
  );
}

function CorrectionForm({ log, onClose }: { log: AttendanceLog; onClose: () => void }) {
  const [checkIn, setCheckIn] = useState(toDatetimeLocal(log.check_in_time));
  const [checkOut, setCheckOut] = useState(toDatetimeLocal(log.check_out_time));
  const [status, setStatus] = useState<AttendanceStatus>(log.status);
  const [notes, setNotes] = useState(log.notes);
  const [error, setError] = useState<string | null>(null);
  const correct = useCorrectAttendanceLog();
  const { data: editLogs } = useAttendanceEditLogs(log.id);

  async function handleSubmit() {
    setError(null);
    try {
      await correct.mutateAsync({
        id: log.id,
        values: {
          check_in_time: fromDatetimeLocal(checkIn),
          check_out_time: fromDatetimeLocal(checkOut),
          status,
          notes,
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
      <DialogTitle>
        Correct attendance — {log.employee_name} ({log.employee_code})
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <DateTimeField label="Check-in time" value={checkIn} onChange={setCheckIn} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <DateTimeField label="Check-out time" value={checkOut} onChange={setCheckOut} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Status"
              fullWidth
              value={status}
              onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
            >
              {STATUSES.map((s) => (
                <MenuItem key={s.value} value={s.value}>
                  {s.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Notes"
              fullWidth
              multiline
              minRows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Grid>
        </Grid>

        {editLogs && editLogs.length > 0 && (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" gutterBottom>
              Correction history
            </Typography>
            <List dense disablePadding>
              {editLogs.map((entry) => (
                <ListItem key={entry.id} disableGutters>
                  <ListItemText
                    primary={`${entry.field}: ${entry.from_value || "—"} → ${entry.to_value || "—"}`}
                    secondary={`${new Date(entry.created_at).toLocaleString()}${entry.actor_name ? ` · by ${entry.actor_name}` : ""}`}
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={correct.isPending}>
          {correct.isPending ? "Saving..." : "Save correction"}
        </Button>
      </DialogActions>
    </>
  );
}
