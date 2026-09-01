"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import {
  SCHEMES,
  useCreateNominee,
  useDeleteNominee,
  useNominees,
  type Nominee,
  type SchemeValue,
} from "@/hooks/useNominees";

/**
 * Who receives each fund. One list per scheme, because they are separate
 * instruments.
 *
 * Where somebody names a beneficiary for their SSF, PF, CIT, gratuity or life
 * insurance. `Nominee` has a model, a share-validating serializer and a
 * person-scoped viewset behind it; this is the only screen that reaches them.
 *
 * **Grouped by scheme, not listed flat.** The model's own docstring makes the
 * argument: these are four separate legal instruments with separate nomination
 * forms, and somebody can name their spouse on one and their children on
 * another. A single list would invite the reader to assume one answer covers
 * everything, which is the misunderstanding that gets a claim rejected.
 *
 * **Each scheme shows its share total, and under 100 is stated but not
 * blocked.** The serializer refuses over-allocation only, on the grounds that a
 * half-finished list is a normal thing to save — so the UI must not be stricter
 * than the API or the first of two nominees becomes impossible to enter. It
 * says what is missing instead: a fund pays out on the shares recorded, and 60%
 * allocated means 40% goes to the estate.
 */

function shareOf(nominee: Nominee) {
  return Number(nominee.share_percent) || 0;
}

function AddDialog({
  open,
  scheme,
  onClose,
  employeeId,
}: {
  open: boolean;
  scheme: SchemeValue;
  onClose: () => void;
  employeeId?: number;
}) {
  const create = useCreateNominee(employeeId);
  const [form, setForm] = useState({
    name: "",
    relationship: "",
    date_of_birth: "",
    citizenship_number: "",
    share_percent: "100",
  });
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    create.mutate(
      {
        scheme,
        name: form.name.trim(),
        relationship: form.relationship.trim(),
        // An empty date field is "not given", which is null — not the empty
        // string, which the serializer rejects as an invalid date.
        date_of_birth: form.date_of_birth || null,
        citizenship_number: form.citizenship_number.trim(),
        share_percent: Number(form.share_percent),
      },
      {
        onSuccess: () => {
          setForm({ name: "", relationship: "", date_of_birth: "", citizenship_number: "", share_percent: "100" });
          onClose();
        },
        // The server's message is the useful one — it knows the running total
        // for this scheme and this component does not.
        onError: (err: Error) => setError(err.message),
      },
    );
  }

  const label = SCHEMES.find((s) => s.value === scheme)?.label ?? scheme;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add a nominee — {label}</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Full name"
            size="small"
            fullWidth
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextField
            label="Relationship"
            size="small"
            fullWidth
            placeholder="Spouse, son, daughter, mother…"
            value={form.relationship}
            onChange={(e) => setForm({ ...form, relationship: e.target.value })}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Date of birth"
              type="date"
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              value={form.date_of_birth}
              onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
            />
            <TextField
              label="Share (%)"
              type="number"
              size="small"
              fullWidth
              value={form.share_percent}
              onChange={(e) => setForm({ ...form, share_percent: e.target.value })}
            />
          </Stack>
          <TextField
            label="Citizenship number"
            size="small"
            fullWidth
            value={form.citizenship_number}
            onChange={(e) => setForm({ ...form, citizenship_number: e.target.value })}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!form.name.trim() || !form.relationship.trim() || create.isPending}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function NomineesCard({ employeeId }: { employeeId?: number }) {
  const { data: nominees, isLoading } = useNominees(employeeId);
  const remove = useDeleteNominee();
  const [adding, setAdding] = useState<SchemeValue | null>(null);

  if (isLoading) return <Skeleton variant="rounded" height={220} />;

  const rows = nominees ?? [];
  const named = SCHEMES.filter((scheme) => rows.some((n) => n.scheme === scheme.value));

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Nominees
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {named.length === 0
            ? "Nobody is named on any fund. If something happens, the money goes to your estate rather than to a person you chose."
            : "Who receives each fund. Named separately per scheme — they are separate legal instruments."}
        </Typography>

        <Stack spacing={2.5}>
          {SCHEMES.map((scheme) => {
            const forScheme = rows.filter((n) => n.scheme === scheme.value);
            const total = forScheme.reduce((sum, n) => sum + shareOf(n), 0);

            return (
              <Box key={scheme.value}>
                <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: ".03em" }}>
                    {scheme.label.toUpperCase()}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    {forScheme.length > 0 ? (
                      <Typography
                        variant="caption"
                        sx={{
                          fontVariantNumeric: "tabular-nums",
                          // Short of 100 is a real gap in the nomination, but it
                          // is a saveable state — so it is stated, not alarmed.
                          color: total === 100 ? "text.secondary" : "var(--hrms-status-warning-fg)",
                        }}
                      >
                        {total}% allocated
                      </Typography>
                    ) : null}
                    <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(scheme.value)}>
                      Add
                    </Button>
                  </Stack>
                </Stack>

                {forScheme.length === 0 ? (
                  <Typography variant="body2" sx={{ color: "text.disabled", py: 0.5 }}>
                    Nobody named.
                  </Typography>
                ) : (
                  <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                    {forScheme.map((nominee) => (
                      <Stack
                        key={nominee.id}
                        direction="row"
                        spacing={1}
                        sx={{
                          alignItems: "center",
                          px: 1,
                          py: 0.75,
                          borderRadius: 1.5,
                          "&:hover": { bgcolor: "action.hover" },
                          "&:hover .nominee-actions": { opacity: 1 },
                        }}
                      >
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                            {nominee.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {nominee.relationship}
                            {nominee.citizenship_number ? ` · ${nominee.citizenship_number}` : ""}
                          </Typography>
                        </Box>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
                        >
                          {shareOf(nominee)}%
                        </Typography>
                        <Box className="nominee-actions" sx={{ opacity: 0, transition: "opacity .15s" }}>
                          <Tooltip title="Remove">
                            <IconButton size="small" onClick={() => remove.mutate(nominee.id)}>
                              <DeleteOutlineIcon sx={{ fontSize: 17 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Stack>
                    ))}

                    {total < 100 ? (
                      <Typography variant="caption" sx={{ color: "var(--hrms-status-warning-fg)", px: 1 }}>
                        {100 - total}% is unallocated and would go to your estate.
                      </Typography>
                    ) : null}
                  </Stack>
                )}
              </Box>
            );
          })}
        </Stack>

        {adding ? (
          <AddDialog open scheme={adding} onClose={() => setAdding(null)} employeeId={employeeId} />
        ) : null}
      </CardContent>
    </Card>
  );
}
