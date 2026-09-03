"use client";

import AddIcon from "@mui/icons-material/Add";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DescriptionIcon from "@mui/icons-material/Description";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import DateTimeField from "@/components/common/DateTimeField";
import { CompanyPicker, EmployeePicker } from "@/components/common/pickers";
import {
  useAddAttachment,
  useAddStakeholder,
  useDeleteEvent,
  useRemoveAttachment,
  useRemoveStakeholder,
  useSaveEvent,
  useUpdateStakeholder,
} from "@/hooks/useEvents";
import { useCanDelete } from "@/hooks/useMe";
import {
  EVENT_KINDS,
  EVENT_STATUSES,
  STAKEHOLDER_ROLES,
  type CompanyEvent,
  type EventFormValues,
  type StakeholderRole,
} from "@/types/events";

/**
 * Creating and editing an event, its stakeholder list and its files.
 *
 * **Three tabs rather than one long form**, because the three are filled in at
 * different times by different people: the details before it happens, the
 * stakeholders as they confirm, the minutes and photographs afterwards.
 *
 * **Stakeholders and attachments are only reachable once the event exists.**
 * Both are child rows keyed on an event id, and there is no id until the
 * server has answered — so on a new event those tabs say so rather than
 * offering forms whose Save would have nothing to attach to.
 */

const EMPTY: EventFormValues = {
  title: "",
  kind: "meeting",
  status: "planned",
  subject_matter: "",
  description: "",
  starts_at: "",
  ends_at: "",
  is_all_day: false,
  location: "",
  company: null,
  organiser: null,
  outcome: "",
};

function fromEvent(event: CompanyEvent): EventFormValues {
  return {
    title: event.title,
    kind: event.kind,
    status: event.status,
    subject_matter: event.subject_matter,
    description: event.description,
    starts_at: event.starts_at,
    ends_at: event.ends_at ?? "",
    is_all_day: event.is_all_day,
    location: event.location,
    company: event.company,
    organiser: event.organiser,
    outcome: event.outcome,
  };
}

export default function EventDialog({
  open,
  event,
  onClose,
  canEdit,
}: {
  open: boolean;
  /** `null` creates. */
  event: CompanyEvent | null;
  onClose: () => void;
  canEdit: boolean;
}) {
  const save = useSaveEvent();
  const remove = useDeleteEvent();
  const canDelete = useCanDelete("workplace.manage");
  const [tab, setTab] = useState(0);
  const [values, setValues] = useState<EventFormValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  // Keyed on opening rather than on every render: editing a field and having a
  // background refetch reset it is the failure this avoids.
  useEffect(() => {
    if (!open) return;
    setValues(event ? fromEvent(event) : EMPTY);
    setTab(0);
    setError(null);
  }, [open, event]);

  function set<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({ id: event?.id, values });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{event ? event.title : "New event"}</DialogTitle>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ px: 3 }}>
        <Tab label="Details" />
        <Tab label={`Stakeholders${event ? ` (${event.stakeholders.length})` : ""}`} />
        <Tab label={`Attachments${event ? ` (${event.attachments.length})` : ""}`} />
      </Tabs>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        {tab === 0 ? (
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField
                label="Title"
                fullWidth
                required
                autoFocus
                value={values.title}
                onChange={(e) => set("title", e.target.value)}
                disabled={!canEdit}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                label="Kind"
                fullWidth
                value={values.kind}
                onChange={(e) => set("kind", e.target.value as EventFormValues["kind"])}
                disabled={!canEdit}
              >
                {EVENT_KINDS.map((k) => (
                  <MenuItem key={k.value} value={k.value}>
                    {k.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Subject matter"
                fullWidth
                value={values.subject_matter}
                onChange={(e) => set("subject_matter", e.target.value)}
                disabled={!canEdit}
                helperText="What it is about, in one line. This is what somebody searches for six months later."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateTimeField
                label="Starts"
                value={values.starts_at}
                onChange={(value) => set("starts_at", value)}
                disabled={!canEdit}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateTimeField
                label="Ends"
                value={values.ends_at}
                onChange={(value) => set("ends_at", value)}
                disabled={!canEdit}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={values.is_all_day}
                    onChange={(e) => set("is_all_day", e.target.checked)}
                    disabled={!canEdit}
                  />
                }
                label="All day"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField
                label="Location"
                fullWidth
                value={values.location}
                onChange={(e) => set("location", e.target.value)}
                disabled={!canEdit}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                label="Status"
                fullWidth
                value={values.status}
                onChange={(e) => set("status", e.target.value as EventFormValues["status"])}
                disabled={!canEdit}
              >
                {EVENT_STATUSES.map((s) => (
                  <MenuItem key={s.value} value={s.value}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <CompanyPicker
                label="Company"
                value={values.company}
                onChange={(id) => set("company", id)}
                disabled={!canEdit}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <EmployeePicker
                label="Organiser"
                value={values.organiser}
                onChange={(id) => set("organiser", id)}
                disabled={!canEdit}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Description"
                fullWidth
                multiline
                minRows={2}
                value={values.description}
                onChange={(e) => set("description", e.target.value)}
                disabled={!canEdit}
                helperText="What is intended."
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              {/* Separate from the description, and written afterwards. One is
                  what we intend to do and the other is what happened;
                  overwriting the first with the second loses the reason it was
                  called. */}
              <TextField
                label="Outcome"
                fullWidth
                multiline
                minRows={2}
                value={values.outcome}
                onChange={(e) => set("outcome", e.target.value)}
                disabled={!canEdit}
                helperText="Minutes, decisions, what came of it."
              />
            </Grid>
          </Grid>
        ) : null}

        {tab === 1 ? (
          event ? (
            <StakeholderTable event={event} canEdit={canEdit} />
          ) : (
            <Alert severity="info">
              Save the event first. Stakeholders attach to it, and there is
              nothing to attach them to yet.
            </Alert>
          )
        ) : null}

        {tab === 2 ? (
          event ? (
            <AttachmentList event={event} canEdit={canEdit} />
          ) : (
            <Alert severity="info">
              Save the event first, then attach the minutes and the photographs.
            </Alert>
          )
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>

        {/* Deletion is the admin's, never the officer's — the same verb rule
            the rest of the system runs on, so the button simply is not there
            for somebody the server would refuse. A saved event only: there is
            nothing to delete before one exists. */}
        {event && canDelete ? (
          <Button
            color="error"
            disabled={remove.isPending}
            onClick={async () => {
              setError(null);
              try {
                await remove.mutateAsync(event.id);
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : "That could not be removed.");
              }
            }}
          >
            Delete
          </Button>
        ) : null}

        <Box sx={{ flex: 1 }} />
        {canEdit && tab === 0 ? (
          <Button
            variant="contained"
            onClick={submit}
            disabled={save.isPending || !values.title.trim() || !values.starts_at}
          >
            Save
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}

/* ── Stakeholders ────────────────────────────────────────────────────────── */

/**
 * The list of who is in it.
 *
 * A table with a name column and an *optional* employee column, exactly as the
 * model is shaped. Picking an employee fills the name and code; leaving it
 * empty is how a ward chair or a contractor's foreman gets recorded, which is
 * most of the list at a public hearing.
 */
function StakeholderTable({ event, canEdit }: { event: CompanyEvent; canEdit: boolean }) {
  const add = useAddStakeholder();
  const update = useUpdateStakeholder();
  const remove = useRemoveStakeholder();

  const [employee, setEmployee] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [role, setRole] = useState<StakeholderRole>("attendee");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await add.mutateAsync({
        eventId: event.id,
        employee,
        // Left empty when an employee is picked — the server fills it from the
        // record, and typing it here would only invite the two to disagree.
        name: name || undefined,
        organisation,
        role,
      });
      setEmployee(null);
      setName("");
      setOrganisation("");
      setRole("attendee");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be added.");
    }
  }

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Employee</TableCell>
            <TableCell>Organisation</TableCell>
            <TableCell>Role</TableCell>
            <TableCell align="center">Attended</TableCell>
            {canEdit ? <TableCell /> : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {event.stakeholders.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.name}</TableCell>
              <TableCell>
                {row.employee_code ? (
                  <Chip size="small" label={row.employee_code} />
                ) : (
                  <Typography variant="caption" color="text.disabled">
                    External
                  </Typography>
                )}
              </TableCell>
              <TableCell>{row.organisation || "—"}</TableCell>
              <TableCell>{row.role_display}</TableCell>
              <TableCell align="center">
                {/* Left indeterminate until the event has happened — a
                    default of "no" would be a claim nobody made. */}
                <Checkbox
                  size="small"
                  checked={row.attended === true}
                  indeterminate={row.attended === null}
                  disabled={!canEdit}
                  onChange={(e) =>
                    update.mutate({
                      eventId: event.id,
                      id: row.id,
                      attended: e.target.checked,
                    })
                  }
                />
              </TableCell>
              {canEdit ? (
                <TableCell align="right">
                  <Tooltip title="Remove">
                    <IconButton
                      size="small"
                      onClick={() => remove.mutate({ eventId: event.id, id: row.id })}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          {event.stakeholders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canEdit ? 6 : 5}>
                <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                  Nobody added yet.
                </Typography>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {canEdit ? (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="overline" color="text.secondary">
            Add somebody
          </Typography>
          <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <EmployeePicker
                label="Employee"
                size="small"
                value={employee}
                onChange={setEmployee}
                helperText="Leave empty for somebody outside the company."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Name"
                size="small"
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={employee != null}
                helperText={employee != null ? "Filled from the record." : "Required for an outsider."}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Organisation"
                size="small"
                fullWidth
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="Ward Chair, Uttargaya-4"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                label="Role"
                size="small"
                fullWidth
                value={role}
                onChange={(e) => setRole(e.target.value as StakeholderRole)}
              >
                {STAKEHOLDER_ROLES.map((r) => (
                  <MenuItem key={r.value} value={r.value}>
                    {r.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={submit}
                disabled={add.isPending || (employee == null && !name.trim())}
                sx={{ height: 40 }}
              >
                Add
              </Button>
            </Grid>
          </Grid>
        </>
      ) : null}
    </Box>
  );
}

/* ── Attachments ─────────────────────────────────────────────────────────── */

function AttachmentList({ event, canEdit }: { event: CompanyEvent; canEdit: boolean }) {
  const add = useAddAttachment();
  const remove = useRemoveAttachment();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file) return;
    setError(null);
    try {
      await add.mutateAsync({ eventId: event.id, file, caption });
      setFile(null);
      setCaption("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be uploaded.");
    }
  }

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Stack spacing={1} divider={<Divider flexItem />}>
        {event.attachments.map((attachment) => (
          <Stack key={attachment.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <DescriptionIcon fontSize="small" color="action" />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                component="a"
                href={attachment.file_url ?? attachment.file}
                target="_blank"
                rel="noopener"
                variant="body2"
                sx={{ fontWeight: 600, color: "inherit" }}
              >
                {attachment.caption || attachment.file.split("/").pop()}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {attachment.uploaded_by_name ?? "System"}
              </Typography>
            </Box>
            {canEdit ? (
              <IconButton
                size="small"
                onClick={() => remove.mutate({ eventId: event.id, id: attachment.id })}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            ) : null}
          </Stack>
        ))}
        {event.attachments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            Nothing attached. Minutes, an attendance sheet and photographs all
            belong here — there is no single &ldquo;the&rdquo; document.
          </Typography>
        ) : null}
      </Stack>

      {canEdit ? (
        <>
          <Divider sx={{ my: 2 }} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button component="label" variant="outlined" startIcon={<AttachFileIcon />}>
              {file ? file.name : "Choose a file"}
              <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Button>
            <TextField
              label="Caption"
              size="small"
              fullWidth
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Minutes, attendance sheet, photograph…"
            />
            <Button variant="contained" onClick={submit} disabled={!file || add.isPending}>
              Upload
            </Button>
          </Stack>
        </>
      ) : null}
    </Box>
  );
}
