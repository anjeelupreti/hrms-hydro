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

import { useRequestableFields, useSubmitChangeRequest } from "@/hooks/useChangeRequests";

/**
 * Asking for one field to be changed, from the field itself.
 *
 * Opened from the pencil on a row, already knowing which field was meant.
 *
 * A panel at the foot of the page with a dropdown of twenty field names asks
 * somebody to scroll past the value they are looking at, find the panel, and
 * re-find the field by name in a list.
 *
 * So: click the pencil beside the account number
 * and this opens, already knowing which field you meant and what it currently
 * says.
 *
 * **The button says Request, not Save, and that is the whole point.** These
 * fields decide where money goes and who somebody legally is, so they are not
 * self-editable — a bank account changed quietly the day before payroll sends
 * a salary elsewhere and nothing about the run looks wrong. The modal looks
 * like an edit and behaves like a request, and the wording is what carries that
 * difference. Calling it Save would be a lie about what happens next.
 */
export default function RequestChangeDialog({
  field,
  currentValue,
  label,
  onClose,
}: {
  field: string;
  currentValue: string | null;
  label: string;
  onClose: () => void;
}) {
  const { data: fields } = useRequestableFields();
  const submit = useSubmitChangeRequest();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<string | null>(null);

  // The server decides what is legal, including whether this field is a choice
  // list — `marital_status` has exactly four valid values, and a text box over
  // it is how "Divorced" with a capital D reached the column.
  const spec = fields?.find((f) => f.name === field);
  const choices = spec?.choices ?? null;
  const isDate = spec?.is_date ?? false;

  async function send() {
    setFailed(null);
    try {
      await submit.mutateAsync({ field, new_value: value.trim(), reason: reason.trim() });
      onClose();
    } catch (error) {
      // The server's words, not a house message: it explains *why* — not a
      // valid option, already the value on record, not a requestable field.
      setFailed(error instanceof Error ? error.message : "That could not be sent.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Ask for {label.toLowerCase()} to be changed</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This does not change anything yet. It goes to whoever approves these, and they
          apply it — a second pair of eyes on the fields that decide where money goes.
        </Typography>

        <Stack spacing={2}>
          <TextField
            size="small"
            label="Currently on record"
            value={currentValue || "Nothing on file"}
            disabled
            fullWidth
          />
          {isDate ? (
            // The same picker the rest of the product uses, so a passport
            // expiry is chosen rather than spelled. Submission validates the
            // format either way — this is about not making somebody fail first.
            <DateField
              size="small"
              label={`New ${label.toLowerCase()}`}
              value={value}
              onChange={setValue}
            />
          ) : (
            <TextField
              size="small"
              autoFocus
              select={Boolean(choices?.length)}
              label={`New ${label.toLowerCase()}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              fullWidth
            >
              {choices?.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            size="small"
            label="Why? (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            helperText="Helps whoever approves it — never required."
          />
          {failed ? <Alert severity="error">{failed}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={submit.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={send}
          disabled={submit.isPending || !value.trim()}
        >
          Request
        </Button>
      </DialogActions>
    </Dialog>
  );
}
