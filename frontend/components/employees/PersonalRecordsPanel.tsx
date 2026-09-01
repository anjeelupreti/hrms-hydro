"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import VerifiedIcon from "@mui/icons-material/Verified";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { useCan } from "@/hooks/useMe";
import {
  useDeleteDependant,
  useDeleteEducation,
  useDeleteEmergencyContact,
  useDependants,
  useEducation,
  useEmergencyContacts,
  useSaveDependant,
  useSaveEducation,
  useSaveEmergencyContact,
  useVerifyEducation,
} from "@/hooks/usePersonalRecords";

/**
 * Who to call, who they support, what they studied.
 *
 * One panel rather than three tabs: they are all *lists about a person* and
 * each is short. Three tabs would make somebody click twice to answer "is this
 * profile complete", which is the only question this page gets asked.
 *
 * `employeeId` is omitted when somebody is looking at their own profile — the
 * endpoints default to the caller, so the page does not need to know its own id.
 */
export default function PersonalRecordsPanel({ employeeId }: { employeeId?: number | null }) {
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <EmergencyContactsCard employeeId={employeeId} />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <DependantsCard employeeId={employeeId} />
      </Grid>
      <Grid size={12}>
        <EducationCard employeeId={employeeId} />
      </Grid>
    </Grid>
  );
}

function SectionCard({
  title,
  caption,
  onAdd,
  children,
}: {
  title: string;
  caption: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "start", mb: 1 }}>
          <Box>
            <Typography variant="subtitle2">{title}</Typography>
            <Typography variant="caption" color="text.secondary">
              {caption}
            </Typography>
          </Box>
          <Button size="small" startIcon={<AddIcon />} onClick={onAdd}>
            Add
          </Button>
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
      {children}
    </Typography>
  );
}

// ── Emergency contacts ───────────────────────────────────────────────────

function EmergencyContactsCard({ employeeId }: { employeeId?: number | null }) {
  const { data: contacts } = useEmergencyContacts(employeeId);
  const save = useSaveEmergencyContact(employeeId);
  const remove = useDeleteEmergencyContact();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <SectionCard
        title="Emergency contacts"
        caption="Called in order. The first person is often unreachable exactly when needed."
        onAdd={() => setAdding(true)}
      >
        {(contacts ?? []).length === 0 ? (
          <Empty>Nobody listed yet.</Empty>
        ) : (
          <Stack spacing={1}>
            {(contacts ?? []).map((contact) => (
              <Stack
                key={contact.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {contact.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {contact.relationship} · {contact.phone}
                </Typography>
                {contact.is_primary && <Chip size="small" color="primary" label="First call" />}
                <IconButton
                  size="small"
                  sx={{ ml: "auto" }}
                  onClick={() => remove.mutate(contact.id)}
                  aria-label={`Remove ${contact.name}`}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </SectionCard>

      {adding && (
        <RecordDialog
          title="Add an emergency contact"
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "relationship", label: "Relationship", required: true },
            { name: "phone", label: "Phone", required: true },
            { name: "alternate_phone", label: "Alternate phone" },
            { name: "address", label: "Address" },
            { name: "is_primary", label: "Call this person first", type: "boolean" },
          ]}
          onSave={async (values) => {
            await save.mutateAsync(values);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

// ── Dependants ───────────────────────────────────────────────────────────

function DependantsCard({ employeeId }: { employeeId?: number | null }) {
  const { data: dependants } = useDependants(employeeId);
  const save = useSaveDependant(employeeId);
  const remove = useDeleteDependant();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <SectionCard
        title="Dependants"
        caption="For insurance and next of kin. Nepal's income tax is not banded by dependants, so this does not change pay."
        onAdd={() => setAdding(true)}
      >
        {(dependants ?? []).length === 0 ? (
          <Empty>Nobody listed yet.</Empty>
        ) : (
          <Stack spacing={1}>
            {(dependants ?? []).map((dependant) => (
              <Stack
                key={dependant.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {dependant.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {dependant.relationship}
                </Typography>
                {dependant.is_covered_by_insurance && (
                  <Chip size="small" variant="outlined" label="On the policy" />
                )}
                <IconButton
                  size="small"
                  sx={{ ml: "auto" }}
                  onClick={() => remove.mutate(dependant.id)}
                  aria-label={`Remove ${dependant.name}`}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </SectionCard>

      {adding && (
        <RecordDialog
          title="Add a dependant"
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "relationship", label: "Relationship", required: true },
            { name: "date_of_birth", label: "Date of birth", type: "date" },
            { name: "is_covered_by_insurance", label: "On the company policy", type: "boolean" },
            { name: "note", label: "Note" },
          ]}
          onSave={async (values) => {
            await save.mutateAsync(values);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

// ── Education ────────────────────────────────────────────────────────────

function EducationCard({ employeeId }: { employeeId?: number | null }) {
  const { data: records } = useEducation(employeeId);
  const save = useSaveEducation(employeeId);
  const remove = useDeleteEducation();
  const verify = useVerifyEducation();
  const canVerify = useCan("people.manage");
  const [adding, setAdding] = useState(false);

  return (
    <>
      <SectionCard
        title="Education"
        caption="A qualification somebody typed in and one HR has seen a certificate for are different facts."
        onAdd={() => setAdding(true)}
      >
        {(records ?? []).length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <Stack spacing={1.5}>
            {(records ?? []).map((record) => (
              <Stack
                key={record.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {record.qualification}
                    {record.field_of_study ? ` · ${record.field_of_study}` : ""}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {record.institution}
                    {record.end_year ? ` · ${record.end_year}` : ""}
                    {record.grade ? ` · ${record.grade}` : ""}
                  </Typography>
                </Box>

                {record.is_verified ? (
                  <Tooltip title={`Verified by ${record.verified_by_name ?? "HR"}`}>
                    <Chip
                      size="small"
                      color="success"
                      icon={<VerifiedIcon />}
                      label="Verified"
                      onClick={
                        canVerify
                          ? () => verify.mutate({ id: record.id, verified: false })
                          : undefined
                      }
                    />
                  </Tooltip>
                ) : (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={canVerify ? "Mark verified" : "Unverified"}
                    onClick={
                      canVerify ? () => verify.mutate({ id: record.id, verified: true }) : undefined
                    }
                  />
                )}

                <IconButton
                  size="small"
                  sx={{ ml: "auto" }}
                  onClick={() => remove.mutate(record.id)}
                  aria-label={`Remove ${record.qualification}`}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </SectionCard>

      {adding && (
        <RecordDialog
          title="Add a qualification"
          fields={[
            { name: "institution", label: "Institution", required: true },
            { name: "qualification", label: "Qualification (BSc, +2, SLC)", required: true },
            { name: "field_of_study", label: "Field of study" },
            { name: "start_year", label: "Start year", type: "number" },
            { name: "end_year", label: "End year", type: "number" },
            { name: "grade", label: "Grade (GPA, percentage, division)" },
          ]}
          onSave={async (values) => {
            await save.mutateAsync(values);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

// ── One dialog, three shapes ─────────────────────────────────────────────

type Field = {
  name: string;
  label: string;
  required?: boolean;
  type?: "text" | "number" | "date" | "boolean";
};

/**
 * A small declared form rather than three hand-written dialogs.
 *
 * These three records differ only in their fields — writing each dialog out
 * separately means three places to fix the same "the save failed and nothing
 * said so" bug.
 */
function RecordDialog({
  title,
  fields,
  onSave,
  onClose,
}: {
  title: string;
  fields: Field[];
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const missing = fields.filter((f) => f.required && !values[f.name]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      // Empty strings would overwrite optional fields with blanks and, for a
      // number or date, fail validation on the server.
      const cleaned = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== "" && v !== undefined)
      );
      await onSave(cleaned);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent>
        <form onSubmit={submit}>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {fields.map((field) =>
              field.type === "boolean" ? (
                <FormControlLabel
                  key={field.name}
                  control={
                    <Checkbox
                      checked={Boolean(values[field.name])}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [field.name]: e.target.checked }))
                      }
                    />
                  }
                  label={field.label}
                />
              ) : (
                <TextField
                  key={field.name}
                  label={field.label}
                  size="small"
                  required={field.required}
                  type={field.type ?? "text"}
                  slotProps={
                    field.type === "date" ? { inputLabel: { shrink: true } } : undefined
                  }
                  value={(values[field.name] as string) ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  fullWidth
                />
              )
            )}

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                type="submit"
                variant="contained"
                disabled={missing.length > 0 || saving}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </Stack>
          </Stack>
        </form>
      </DialogContent>
    </Dialog>
  );
}
