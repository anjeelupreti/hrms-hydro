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

import Typography from "@mui/material/Typography";

import { useApproveLifecycleEvent, useCreateLifecycleEvent } from "@/hooks/useLifecycle";
import { useCan } from "@/hooks/useMe";
import type { LifecycleEvent, LifecycleEventType } from "@/types/lifecycle";
import DateField from "@/components/common/DateField";
import { DepartmentPicker, DesignationPicker, EmployeePicker } from "@/components/common/pickers";

type Props = {
  open: boolean;
  onClose: () => void;
  employeeId: number | null;
  employeeName: string;
};

const EVENT_LABELS: Record<LifecycleEventType, string> = {
  promotion: "Promotion",
  award: "Award",
  resignation: "Resignation",
  termination: "Termination",
  transfer: "Transfer",
};

export default function LifecycleEventDialog({ open, onClose, employeeId, employeeName }: Props) {
  const createEvent = useCreateLifecycleEvent();

  const [eventType, setEventType] = useState<LifecycleEventType>("promotion");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [newDesignation, setNewDesignation] = useState<number | "">("");
  const [newDepartment, setNewDepartment] = useState<number | "">("");
  const [newManager, setNewManager] = useState<number | "">("");
  const [awardTitle, setAwardTitle] = useState("");
  const [lastWorkingDate, setLastWorkingDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<LifecycleEvent | null>(null);
  const approveEvent = useApproveLifecycleEvent();
  const canApprove = useCan("people.manage");

  function reset() {
    setEventType("promotion");
    setEffectiveDate("");
    setReason("");
    setNewDesignation("");
    setNewDepartment("");
    setNewManager("");
    setAwardTitle("");
    setLastWorkingDate("");
    setError(null);
    setSubmitted(null);
  }

  async function handleSubmit() {
    if (!employeeId) return;
    setError(null);
    try {
      const created = await createEvent.mutateAsync({
        employee: employeeId,
        event_type: eventType,
        effective_date: effectiveDate,
        reason,
        ...(eventType === "promotion" && newDesignation ? { new_designation: newDesignation } : {}),
        ...(eventType === "transfer" && newDepartment ? { new_department: newDepartment } : {}),
        ...(eventType === "transfer" && newManager ? { new_manager: newManager } : {}),
        ...(eventType === "award" ? { award_title: awardTitle } : {}),
        ...(eventType === "resignation" || eventType === "termination"
          ? { last_working_date: lastWorkingDate }
          : {}),
      });
      // Do **not** just close. Submitting a termination does not terminate
      // anybody — it files a request that somebody still has to approve — and
      // a dialog that vanishes silently is indistinguishable from one that
      // failed. Reported exactly that way: "no success response, nothing".
      setSubmitted(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function approveNow() {
    if (!submitted) return;
    setError(null);
    try {
      const applied = await approveEvent.mutateAsync({ id: submitted.id, comment: "" });
      setSubmitted(applied);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve that.");
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>Lifecycle event — {employeeName}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* What actually happened, said plainly. A request that is filed and a
            change that has taken effect look identical from a dialog that just
            closes — and for a termination those are very different facts. */}
        {submitted ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {submitted.status === "applied" ? (
              <Alert severity="success">
                Applied. {employeeName} is now{" "}
                <strong>{submitted.event_type === "promotion" ? "promoted" : submitted.event_type + "d"}</strong>
                {(submitted.event_type === "resignation" || submitted.event_type === "termination") &&
                  " — their login is closed and an offboarding checklist has been started"}
                .
              </Alert>
            ) : (
              <Alert severity="info">
                Filed, and <strong>waiting for approval</strong>. Nothing has changed
                yet — {employeeName} is still active until somebody approves it.
              </Alert>
            )}

            {submitted.status !== "applied" && canApprove && (
              <>
                <Typography variant="body2" color="text.secondary">
                  You can approve it yourself, or leave it for another HR admin
                  in the approvals inbox.
                </Typography>
                <Button
                  variant="contained"
                  onClick={approveNow}
                  disabled={approveEvent.isPending}
                >
                  {approveEvent.isPending ? "Approving…" : "Approve it now"}
                </Button>
              </>
            )}

            {submitted.status !== "applied" && !canApprove && (
              <Typography variant="body2" color="text.secondary">
                An HR admin will see it in their approvals inbox.
              </Typography>
            )}
          </Stack>
        ) : (
          <>
        {eventType !== "award" && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Filing this does not change anything on its own — it needs approving
            before it takes effect.
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Event type"
            fullWidth
            value={eventType}
            onChange={(e) => setEventType(e.target.value as LifecycleEventType)}
          >
            {Object.entries(EVENT_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>

          <DateField
            label="Effective date"
            value={effectiveDate}
            onChange={setEffectiveDate}
            required
          />

          {eventType === "promotion" && (
            <DesignationPicker
              label="New designation"
              value={newDesignation || null}
              onChange={(id) => setNewDesignation(id ?? 0)}
              required
            />
          )}

          {eventType === "transfer" && (
            <>
              <DepartmentPicker
                label="New department"
                value={newDepartment || null}
                onChange={(id) => setNewDepartment(id ?? 0)}
                required
              />
              {/* Nobody reports to themselves — excluding the subject is the
                  one filter the server cannot know to apply. */}
              <EmployeePicker
                label="New manager"
                value={newManager || null}
                onChange={(id) => setNewManager(id ?? 0)}
                excludeIds={employeeId ? [employeeId] : undefined}
                required
              />
            </>
          )}

          {eventType === "award" && (
            <TextField
              label="Award title"
              fullWidth
              value={awardTitle}
              onChange={(e) => setAwardTitle(e.target.value)}
            />
          )}

          {(eventType === "resignation" || eventType === "termination") && (
            <DateField
              label="Last working date"
              value={lastWorkingDate}
              onChange={setLastWorkingDate}
              required
              helperText="Payroll prorates the final month from this, so it is required."
            />
          )}

          <TextField
            label="Reason / notes"
            fullWidth
            multiline
            minRows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            reset();
            onClose();
          }}
        >
          {submitted ? "Done" : "Cancel"}
        </Button>
        {!submitted && (
          <Button variant="contained" onClick={handleSubmit} disabled={createEvent.isPending}>
            Submit
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
