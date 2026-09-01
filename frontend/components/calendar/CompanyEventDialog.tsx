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

import DateTimeField from "@/components/common/DateTimeField";
import { useCreateCompanyEvent, useDeleteCompanyEvent, useUpdateCompanyEvent } from "@/hooks/useCalendar";
import type { CompanyEvent, CompanyEventType } from "@/types/calendar";

type Props = {
  open: boolean;
  onClose: () => void;
  initialStart: Date | null;
  initialEnd: Date | null;
  editingEvent: CompanyEvent | null;
};

function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The outer Dialog stays mounted regardless of `open` (so MUI's close
// transition still animates) — only the inner form is keyed by
// event/slot identity, forcing a clean remount (fresh useState initial
// values) whenever a *different* event/slot is being edited, instead of
// a useEffect+setState sync (which trips react-hooks/set-state-in-effect
// and cascades renders). Same shape as EmployeeFormDialog's outer/inner
// split.
export default function CompanyEventDialog({ open, onClose, initialStart, initialEnd, editingEvent }: Props) {
  const formKey = editingEvent ? `edit-${editingEvent.id}` : `new-${initialStart?.toISOString() ?? "blank"}`;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <CompanyEventForm
        key={formKey}
        onClose={onClose}
        initialStart={initialStart}
        initialEnd={initialEnd}
        editingEvent={editingEvent}
      />
    </Dialog>
  );
}

type FormProps = Omit<Props, "open">;

function CompanyEventForm({ onClose, initialStart, initialEnd, editingEvent }: FormProps) {
  const createEvent = useCreateCompanyEvent();
  const updateEvent = useUpdateCompanyEvent();
  const deleteEvent = useDeleteCompanyEvent();

  const [title, setTitle] = useState(editingEvent?.title ?? "");
  const [description, setDescription] = useState(editingEvent?.description ?? "");
  const [eventType, setEventType] = useState<CompanyEventType>(editingEvent?.event_type ?? "meeting");
  const [start, setStart] = useState(() =>
    editingEvent ? toLocalInput(new Date(editingEvent.start_datetime)) : initialStart ? toLocalInput(initialStart) : ""
  );
  const [end, setEnd] = useState(() =>
    editingEvent ? toLocalInput(new Date(editingEvent.end_datetime)) : initialEnd ? toLocalInput(initialEnd) : ""
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const values = {
      title,
      description,
      event_type: eventType,
      start_datetime: new Date(start).toISOString(),
      end_datetime: new Date(end).toISOString(),
      all_day: false,
      location: "",
    };
    try {
      if (editingEvent) {
        await updateEvent.mutateAsync({ id: editingEvent.id, values });
      } else {
        await createEvent.mutateAsync(values);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function handleDelete() {
    if (!editingEvent) return;
    setError(null);
    try {
      await deleteEvent.mutateAsync(editingEvent.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
      <DialogTitle>{editingEvent ? "Edit event" : "New event"}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextField
            select
            label="Type"
            fullWidth
            value={eventType}
            onChange={(e) => setEventType(e.target.value as CompanyEventType)}
          >
            <MenuItem value="meeting">Meeting</MenuItem>
            <MenuItem value="interview">Interview</MenuItem>
            <MenuItem value="announcement">Announcement</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </TextField>
          <DateTimeField label="Start" value={start} onChange={setStart} />
          <DateTimeField label="End" value={end} onChange={setEnd} />
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
        {editingEvent && (
          <Button color="error" onClick={handleDelete} disabled={deleteEvent.isPending} sx={{ mr: "auto" }}>
            Delete
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={createEvent.isPending || updateEvent.isPending}>
          Save
        </Button>
      </DialogActions>
    </>
  );
}
