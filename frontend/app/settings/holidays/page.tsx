"use client";

import EventBusyIcon from "@mui/icons-material/EventBusy";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  useCreateHoliday,
  useDeleteHoliday,
  useHolidays,
  useUpdateHoliday,
} from "@/hooks/useHolidays";
import type { Holiday } from "@/types/holidays";
import { useCan } from "@/hooks/useMe";
import SearchField from "@/components/common/SearchField";
import { useTextFilter } from "@/hooks/useTextFilter";

export default function HolidaysSettingsPage() {
  const canManage = useCan("settings.manage");
  const { data: holidays } = useHolidays();
  const createHoliday = useCreateHoliday();
  const deleteHoliday = useDeleteHoliday();
  const updateHoliday = useUpdateHoliday();
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");

  // Seeded when a row is opened, so an abandoned edit does not reappear on the
  // next one.
  function beginEdit(holiday: Holiday) {
    setEditName(holiday.name);
    setEditDate(holiday.date);
    setEditing(holiday);
  }

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    try {
      await createHoliday.mutateAsync({ name, date });
      setOpen(false);
      setName("");
      setDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(
    holidays?.results ?? [],
    (h) => [h.name, h.date]
  );

  return (
    <PageContainer>
      <PageHeader
        title="Holidays"
        subtitle="Company holiday calendar"
        icon={<EventBusyIcon />}
        actions={
          <>
        {canManage && (
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            Add holiday
          </Button>
        )}
      
          </>
        }
      />

      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search holidays…"
        label="Search holidays by name or date"
        sx={{ width: "100%", mb: 1 }}
      />

      <List>
        {filtered.map((h) => (
          <ListItem
            key={h.id}
            divider
            secondaryAction={
              canManage && (
                <Stack direction="row" spacing={0.5}>
                  {/* Edit before delete. A holiday on the wrong date could only
                      be removed and re-added, and holidays are read by the
                      attendance sweep and the leave day-count — a deleted and
                      recreated row is not the same as a corrected one. */}
                  <Tooltip title="Edit">
                    <IconButton edge="end" onClick={() => beginEdit(h)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <IconButton edge="end" onClick={() => deleteHoliday.mutate(h.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              )
            }
          >
            {editing?.id === h.id ? (
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ flex: 1, mr: 10 }}>
                <TextField
                  size="small"
                  fullWidth
                  autoFocus
                  label="Name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <DateField label="Date" value={editDate} onChange={(v) => setEditDate(v ?? "")} />
                <Button
                  size="small"
                  variant="contained"
                  disabled={!editName.trim() || !editDate || updateHoliday.isPending}
                  onClick={async () => {
                    await updateHoliday.mutateAsync({
                      id: h.id,
                      values: { name: editName.trim(), date: editDate },
                    });
                    setEditing(null);
                  }}
                >
                  Save
                </Button>
                <Button size="small" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </Stack>
            ) : (
              <ListItemText primary={h.name} secondary={h.date} />
            )}
          </ListItem>
        ))}
        {holidays && filtered.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
            {isEmptyResult ? `No holidays match “${query}”.` : "No holidays configured yet."}
          </Typography>
        )}
      </List>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add holiday</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
            <DateField label="Date" value={date} onChange={setDate} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createHoliday.isPending}>
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
