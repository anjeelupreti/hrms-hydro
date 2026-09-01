"use client";

/**
 * Asking HR to change something on your own record.
 *
 * **Why this is not an edit form.** The fields here decide where somebody's
 * salary is paid and who they legally are. An account number changed the day
 * before payroll sends the money somewhere else and nothing about the run looks
 * wrong afterwards — so the employee proposes and a second person approves.
 *
 * The panel deliberately shows the *current* value beside the box. Somebody
 * correcting a digit in an account number needs to see what is on record, and
 * making them open another screen to check is how the wrong digit gets fixed.
 */

import SendIcon from "@mui/icons-material/Send";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import {
  useChangeRequests,
  useDecideChangeRequest,
  useRequestableFields,
  useSubmitChangeRequest,
} from "@/hooks/useChangeRequests";
import { STATUS_COLOR } from "@/types/changeRequests";

export default function ChangeRequestPanel({ employeeId }: { employeeId?: number }) {
  const { data: fields } = useRequestableFields(employeeId);
  const { data: requests, isLoading } = useChangeRequests(
    employeeId != null ? { employee: employeeId } : {}
  );
  const submit = useSubmitChangeRequest();
  const decide = useDecideChangeRequest();

  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const chosen = fields?.find((f) => f.name === field);
  const rows = requests?.results ?? [];

  async function send() {
    if (!field || !value.trim()) return;
    setError("");
    try {
      await submit.mutateAsync({
        field,
        new_value: value.trim(),
        reason: reason.trim(),
        ...(employeeId != null ? { employee: employeeId } : {}),
      });
      setField("");
      setValue("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be sent.");
    }
  }

  async function takeBack(id: number) {
    setError("");
    try {
      await decide.mutateAsync({ id, action: "withdraw" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be withdrawn.");
    }
  }

  return (
    <Stack spacing={2.5}>
      {error ? (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Ask HR to change something
        </Typography>
        <Typography variant="caption" color="text.secondary">
          These fields are checked before they change — an account number or a
          legal name reaches your payslip and your tax filing.
        </Typography>

        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          <TextField
            select
            size="small"
            label="What needs changing?"
            value={field}
            onChange={(e) => {
              setField(e.target.value);
              setValue("");
            }}
          >
            {(fields ?? []).map((f) => (
              <MenuItem key={f.name} value={f.name}>
                {f.label}
              </MenuItem>
            ))}
          </TextField>

          {chosen ? (
            <>
              {/* A picker when the column is constrained, a text box when
                  it is not. A text box for a four-value enum means the field
                  is filled by typing, and the server does not validate
                  `choices` on save — so whatever is typed is what the column
                  holds. */}
              <TextField
                size="small"
                select={Boolean(chosen.choices?.length)}
                label={`New ${chosen.label.toLowerCase()}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                // Shown, because somebody correcting one digit needs to see the
                // digits — and sending them to another screen to check is how
                // the wrong one gets "fixed".
                helperText={
                  chosen.current
                    ? `Currently ${chosen.current}`
                    : "Nothing on record yet"
                }
              >
                {chosen.choices?.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Why? (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Box>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<SendIcon />}
                  onClick={send}
                  disabled={!value.trim() || submit.isPending}
                >
                  Send to HR
                </Button>
              </Box>
            </>
          ) : null}
        </Stack>
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          What you have asked for
        </Typography>

        {!isLoading && rows.length === 0 ? (
          <EmptyState
            compact
            title="Nothing requested"
            description="Changes you ask for appear here with what HR decided."
          />
        ) : null}

        <Stack spacing={1}>
          {rows.map((row) => (
            <Box
              key={row.id}
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.5,
                p: 1.25,
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {row.field_label}
                </Typography>
                <Chip
                  size="small"
                  color={STATUS_COLOR[row.status]}
                  label={row.status}
                  sx={{ textTransform: "capitalize" }}
                />
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  <DateText value={row.created_at} />
                </Typography>
              </Stack>

              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {row.old_value || "—"} → <strong>{row.new_value}</strong>
              </Typography>

              {row.decision_note ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  {row.decided_by_name}: {row.decision_note}
                </Typography>
              ) : null}

              {/* §R2 — anything you can file you can take back, until somebody
                  has acted on it. */}
              {row.status === "pending" ? (
                <Button size="small" color="inherit" onClick={() => takeBack(row.id)}>
                  Withdraw
                </Button>
              ) : null}
            </Box>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
