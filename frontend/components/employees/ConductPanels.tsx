"use client";

import AddIcon from "@mui/icons-material/Add";
import BlockIcon from "@mui/icons-material/Block";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DescriptionIcon from "@mui/icons-material/Description";
import EditIcon from "@mui/icons-material/Edit";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import GavelIcon from "@mui/icons-material/Gavel";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import StateChip from "@/components/common/StateChip";
import {
  useAwards,
  useDeleteAward,
  useDeleteDisciplinaryAction,
  useDisciplinaryActions,
  useLiftSuspension,
  useSaveAward,
  useSaveDisciplinaryAction,
  useSuspend,
  useSuspensions,
} from "@/hooks/useEmployeeRecords";
import { useCan, useCanCreate, useCanDelete } from "@/hooks/useMe";
import {
  AWARD_KINDS,
  DISCIPLINARY_SEVERITIES,
  DISCIPLINARY_STATUSES,
  type Award,
  type DisciplinaryAction,
  type Suspension,
} from "@/types/employees";

/**
 * What the company has recorded about somebody's conduct — the recognition and
 * the discipline, and the suspension that sometimes follows.
 *
 * **All three are readable by the person and writable only by HR.** An award
 * nobody can see is not recognition, and a disciplinary file the subject cannot
 * open is not due process. That is a different rule from the next-of-kin lists
 * people maintain themselves, which is why these do not live in
 * `PersonalRecordsPanel`.
 *
 * **Kept together on one tab, not merged into one list.** They are read at the
 * same moment — an appraisal, a promotion decision, an exit — and a single
 * chronological stream would put a long-service award next to a written warning
 * with nothing but an icon to tell them apart.
 */

function useCanWrite() {
  // Creating and deleting are refused by the API for an officer regardless;
  // these only decide whether the button is offered. See the verb section of
  // `accounts/policy.py`, which these mirror clause for clause.
  const canManage = useCan("people.manage");
  const canCreate = useCanCreate("people.manage");
  const canDelete = useCanDelete("people.manage");
  return { canManage, canCreate, canDelete };
}

/* ── Awards ──────────────────────────────────────────────────────────────── */

const EMPTY_AWARD = {
  title: "",
  kind: "other" as Award["kind"],
  awarded_on: "",
  awarded_by: "",
  citation: "",
  reward: "",
};

export function AwardsPanel({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useAwards(employeeId);
  const save = useSaveAward();
  const remove = useDeleteAward();
  const { canManage, canCreate, canDelete } = useCanWrite();

  const [editing, setEditing] = useState<Award | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(EMPTY_AWARD);
  const [certificate, setCertificate] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const awards = data?.results ?? [];

  function start(award: Award | null) {
    setEditing(award);
    setValues(
      award
        ? {
            title: award.title,
            kind: award.kind,
            awarded_on: award.awarded_on,
            awarded_by: award.awarded_by,
            citation: award.citation,
            reward: award.reward,
          }
        : { ...EMPTY_AWARD }
    );
    setCertificate(null);
    setError(null);
    setOpen(true);
  }

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({
        id: editing?.id,
        values: {
          ...values,
          employee: employeeId,
          ...(certificate ? { certificate } : {}),
        },
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <EmojiEventsIcon color="primary" fontSize="small" />
            <Typography variant="overline" color="text.secondary">
              Awards and recognition
            </Typography>
          </Stack>
          {canCreate ? (
            <Button size="small" startIcon={<AddIcon />} onClick={() => start(null)}>
              Record one
            </Button>
          ) : null}
        </Stack>

        {isLoading ? (
          <Skeleton variant="rounded" height={80} />
        ) : awards.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Awards, commendations and long-service recognition appear here."
          />
        ) : (
          <Stack spacing={1.5} divider={<Divider flexItem />}>
            {awards.map((award) => (
              <Stack key={award.id} direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 700 }}>{award.title}</Typography>
                    <Chip size="small" label={award.kind_display} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    <DateText value={award.awarded_on} />
                    {award.awarded_by ? ` · ${award.awarded_by}` : ""}
                    {award.reward ? ` · ${award.reward}` : ""}
                  </Typography>
                  {award.citation ? (
                    <Typography variant="body2" sx={{ mt: 0.5, fontStyle: "italic" }}>
                      “{award.citation}”
                    </Typography>
                  ) : null}
                  {award.certificate ? (
                    <Button
                      size="small"
                      startIcon={<DescriptionIcon />}
                      href={award.certificate}
                      target="_blank"
                      rel="noopener"
                      sx={{ mt: 0.5 }}
                    >
                      Certificate
                    </Button>
                  ) : null}
                </Box>
                {canManage ? (
                  <Stack direction="row">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => start(award)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {canDelete ? (
                      <Tooltip title="Remove">
                        <IconButton size="small" onClick={() => remove.mutate(award.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Stack>
                ) : null}
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? "Edit award" : "Record an award"}</DialogTitle>
        <DialogContent>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField
                label="Title"
                fullWidth
                required
                autoFocus
                value={values.title}
                onChange={(e) => setValues({ ...values, title: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                label="Kind"
                fullWidth
                value={values.kind}
                onChange={(e) => setValues({ ...values, kind: e.target.value as Award["kind"] })}
              >
                {AWARD_KINDS.map((k) => (
                  <MenuItem key={k.value} value={k.value}>
                    {k.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateField
                label="Awarded on"
                required
                value={values.awarded_on}
                onChange={(value) => setValues({ ...values, awarded_on: value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Awarded by"
                fullWidth
                value={values.awarded_by}
                onChange={(e) => setValues({ ...values, awarded_by: e.target.value })}
                helperText="Often a body rather than a person — a ministry, a client, the board."
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Citation"
                fullWidth
                multiline
                minRows={2}
                value={values.citation}
                onChange={(e) => setValues({ ...values, citation: e.target.value })}
                helperText="The sentence read out. Reprinted on the certificate."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Reward"
                fullWidth
                value={values.reward}
                onChange={(e) => setValues({ ...values, reward: e.target.value })}
                helperText="Cash, a scholarship, extra leave — where there was one."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Button component="label" variant="outlined" fullWidth sx={{ height: 56 }}>
                {certificate ? certificate.name : "Attach certificate"}
                <input
                  type="file"
                  hidden
                  onChange={(e) => setCertificate(e.target.files?.[0] ?? null)}
                />
              </Button>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={save.isPending || !values.title.trim() || !values.awarded_on}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

/* ── Disciplinary actions ────────────────────────────────────────────────── */

const SEVERITY_TONE: Record<string, "normal" | "caution" | "alarm" | "muted"> = {
  verbal: "muted",
  written: "caution",
  final: "caution",
  suspension: "alarm",
  demotion: "alarm",
  dismissal: "alarm",
};

const EMPTY_ACTION = {
  subject: "",
  severity: "verbal" as DisciplinaryAction["severity"],
  status: "open" as DisciplinaryAction["status"],
  incident_date: "",
  issued_on: "",
  description: "",
  employee_response: "",
  action_taken: "",
  expires_on: "",
};

export function DisciplinaryPanel({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useDisciplinaryActions(employeeId);
  const save = useSaveDisciplinaryAction();
  const remove = useDeleteDisciplinaryAction();
  const { canManage, canCreate, canDelete } = useCanWrite();

  const [editing, setEditing] = useState<DisciplinaryAction | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(EMPTY_ACTION);
  const [document, setDocument] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = data?.results ?? [];

  function start(action: DisciplinaryAction | null) {
    setEditing(action);
    setValues(
      action
        ? {
            subject: action.subject,
            severity: action.severity,
            status: action.status,
            incident_date: action.incident_date,
            issued_on: action.issued_on,
            description: action.description,
            employee_response: action.employee_response,
            action_taken: action.action_taken,
            expires_on: action.expires_on ?? "",
          }
        : { ...EMPTY_ACTION }
    );
    setDocument(null);
    setError(null);
    setOpen(true);
  }

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({
        id: editing?.id,
        values: {
          ...values,
          employee: employeeId,
          // An empty date is not a date. Sent as-is it becomes a field error
          // about a box nobody typed in.
          expires_on: values.expires_on || null,
          ...(document ? { document } : {}),
        },
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <GavelIcon color="warning" fontSize="small" />
            <Typography variant="overline" color="text.secondary">
              Disciplinary record
            </Typography>
          </Stack>
          {canCreate ? (
            <Button size="small" startIcon={<AddIcon />} onClick={() => start(null)}>
              Issue one
            </Button>
          ) : null}
        </Stack>

        {isLoading ? (
          <Skeleton variant="rounded" height={80} />
        ) : actions.length === 0 ? (
          <EmptyState title="Clean record" description="Nothing has been issued." />
        ) : (
          <Stack spacing={1.5} divider={<Divider flexItem />}>
            {actions.map((action) => (
              <Stack key={action.id} direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 700 }}>{action.subject}</Typography>
                    <StateChip
                      label={action.severity_display}
                      tone={SEVERITY_TONE[action.severity] ?? "muted"}
                    />
                    <Chip size="small" variant="outlined" label={action.status_display} />
                    {/* The one fact a reader needs first: does this still count
                        against them? A warning that never expires is a
                        dismissal on the instalment plan. */}
                    {!action.is_current ? (
                      <Chip size="small" variant="outlined" label="Spent" />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    Incident <DateText value={action.incident_date} /> · issued{" "}
                    <DateText value={action.issued_on} />
                    {action.expires_on ? (
                      <>
                        {" "}
                        · expires <DateText value={action.expires_on} />
                      </>
                    ) : null}
                  </Typography>
                  {action.description ? (
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      {action.description}
                    </Typography>
                  ) : null}
                  {action.employee_response ? (
                    <Box sx={{ mt: 1, pl: 1.5, borderLeft: "3px solid", borderColor: "divider" }}>
                      <Typography variant="caption" color="text.secondary">
                        Their response
                      </Typography>
                      <Typography variant="body2">{action.employee_response}</Typography>
                    </Box>
                  ) : null}
                  {action.document ? (
                    <Button
                      size="small"
                      startIcon={<DescriptionIcon />}
                      href={action.document}
                      target="_blank"
                      rel="noopener"
                      sx={{ mt: 0.5 }}
                    >
                      Letter
                    </Button>
                  ) : null}
                </Box>
                {canManage ? (
                  <Stack direction="row">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => start(action)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {canDelete ? (
                      <Tooltip title="Remove">
                        <IconButton size="small" onClick={() => remove.mutate(action.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Stack>
                ) : null}
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? "Edit record" : "Issue a disciplinary action"}</DialogTitle>
        <DialogContent>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Subject"
                fullWidth
                required
                autoFocus
                value={values.subject}
                onChange={(e) => setValues({ ...values, subject: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                label="Severity"
                fullWidth
                value={values.severity}
                onChange={(e) =>
                  setValues({ ...values, severity: e.target.value as DisciplinaryAction["severity"] })
                }
              >
                {DISCIPLINARY_SEVERITIES.map((s) => (
                  <MenuItem key={s.value} value={s.value}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                label="Status"
                fullWidth
                value={values.status}
                onChange={(e) =>
                  setValues({ ...values, status: e.target.value as DisciplinaryAction["status"] })
                }
              >
                {DISCIPLINARY_STATUSES.map((s) => (
                  <MenuItem key={s.value} value={s.value}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <DateField
                label="Incident date"
                required
                value={values.incident_date}
                onChange={(value) => setValues({ ...values, incident_date: value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <DateField
                label="Issued on"
                required
                value={values.issued_on}
                onChange={(value) => setValues({ ...values, issued_on: value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <DateField
                label="Expires on"
                value={values.expires_on}
                onChange={(value) => setValues({ ...values, expires_on: value })}
                helperText="After this it no longer counts."
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="What happened"
                fullWidth
                multiline
                minRows={2}
                value={values.description}
                onChange={(e) => setValues({ ...values, description: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Their response"
                fullWidth
                multiline
                minRows={2}
                value={values.employee_response}
                onChange={(e) => setValues({ ...values, employee_response: e.target.value })}
                helperText="On the record rather than in an attachment — a file nobody opens is not a right of reply."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Action taken"
                fullWidth
                value={values.action_taken}
                onChange={(e) => setValues({ ...values, action_taken: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Button component="label" variant="outlined" fullWidth sx={{ height: 56 }}>
                {document ? document.name : "Attach the letter"}
                <input
                  type="file"
                  hidden
                  onChange={(e) => setDocument(e.target.files?.[0] ?? null)}
                />
              </Button>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={
              save.isPending ||
              !values.subject.trim() ||
              !values.incident_date ||
              !values.issued_on
            }
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

/* ── Suspension ──────────────────────────────────────────────────────────── */

export function SuspensionPanel({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useSuspensions(employeeId);
  const suspend = useSuspend();
  const lift = useLiftSuspension();
  const { canManage, canCreate, canDelete } = useCanWrite();

  const [open, setOpen] = useState(false);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [lifting, setLifting] = useState<Suspension | null>(null);
  const [outcome, setOutcome] = useState<"reinstated" | "withdrawn" | "terminated">("reinstated");
  const [note, setNote] = useState("");

  const suspensions = data?.results ?? [];
  const live = suspensions.find((s) => s.is_active) ?? null;

  async function submit() {
    setError(null);
    try {
      await suspend.mutateAsync({
        employee: employeeId,
        starts_on: startsOn,
        // Empty means indefinite, which is a deliberate and much rarer thing
        // to record than a fixed interval.
        ends_on: endsOn || null,
        reason,
      });
      setOpen(false);
      setStartsOn("");
      setEndsOn("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be recorded.");
    }
  }

  async function submitLift() {
    if (!lifting) return;
    setError(null);
    try {
      await lift.mutateAsync({ id: lifting.id, outcome, note });
      setLifting(null);
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be recorded.");
    }
  }

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <BlockIcon color="error" fontSize="small" />
            <Typography variant="overline" color="text.secondary">
              Suspension
            </Typography>
          </Stack>
          {canCreate && !live ? (
            <Button size="small" color="error" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
              Suspend
            </Button>
          ) : null}
        </Stack>

        {live ? (
          <Alert
            severity="warning"
            action={
              canManage ? (
                <Button size="small" onClick={() => setLifting(live)}>
                  Lift
                </Button>
              ) : null
            }
            sx={{ mb: 2 }}
          >
            <strong>Suspended</strong> since <DateText value={live.starts_on} />
            {live.ends_on ? (
              <>
                , until <DateText value={live.ends_on} />
              </>
            ) : (
              " — until further notice"
            )}
            . They cannot sign in. {live.reason}
          </Alert>
        ) : null}

        {isLoading ? (
          <Skeleton variant="rounded" height={60} />
        ) : suspensions.length === 0 ? (
          <EmptyState title="Never suspended" description="Nothing to show." />
        ) : (
          <Stack spacing={1.5} divider={<Divider flexItem />}>
            {suspensions.map((suspension) => (
              <Box key={suspension.id}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Typography sx={{ fontWeight: 700 }}>
                    <DateText value={suspension.starts_on} />
                    {" – "}
                    {suspension.ends_on ? <DateText value={suspension.ends_on} /> : "indefinite"}
                  </Typography>
                  <Chip
                    size="small"
                    variant={suspension.is_active ? "filled" : "outlined"}
                    color={suspension.is_active ? "warning" : "default"}
                    label={suspension.is_active ? "In force" : suspension.outcome_display}
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {suspension.reason}
                </Typography>
                {suspension.outcome_note ? (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {suspension.outcome_note}
                    {suspension.lifted_by_name ? ` — ${suspension.lifted_by_name}` : ""}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Suspend this employee</DialogTitle>
        <DialogContent>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <Alert severity="warning" sx={{ mb: 2 }}>
            They will be signed out and unable to sign in again until this is
            lifted.
          </Alert>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateField
                label="Starts on"
                required
                value={startsOn}
                onChange={setStartsOn}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateField
                label="Ends on"
                value={endsOn}
                onChange={setEndsOn}
                helperText="Leave empty for an indefinite suspension."
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Reason"
                fullWidth
                required
                multiline
                minRows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={submit}
            disabled={suspend.isPending || !startsOn || !reason.trim()}
          >
            Suspend
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={lifting !== null} onClose={() => setLifting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Lift the suspension</DialogTitle>
        <DialogContent>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            How it ended has to be recorded. Reinstating and dismissing are
            different outcomes, and only one of them gives the account back.
          </Typography>
          <Stack spacing={2}>
            <TextField
              select
              label="Outcome"
              fullWidth
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as typeof outcome)}
            >
              <MenuItem value="reinstated">Reinstated — back to work</MenuItem>
              <MenuItem value="withdrawn">Withdrawn — it should not have happened</MenuItem>
              <MenuItem value="terminated">Ended in termination</MenuItem>
            </TextField>
            <TextField
              label="Note"
              fullWidth
              multiline
              minRows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLifting(null)}>Cancel</Button>
          <Button variant="contained" onClick={submitLift} disabled={lift.isPending}>
            Record
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
