"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import { useCreateLeaveRequest, useLeaveDayCount, useMyLeaveBalances } from "@/hooks/useLeave";
import { useMe } from "@/hooks/useMe";
import { LeaveTypePicker } from "@/components/common/pickers";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function LeaveRequestDialog({ open, onClose }: Props) {
  const { data: me } = useMe();
  const { data: balances } = useMyLeaveBalances(me?.employee_id ?? undefined);
  const createRequest = useCreateLeaveRequest();

  const [leaveTypeId, setLeaveTypeId] = useState<number | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Asked of the server, not counted here — see `useLeaveDayCount`. The
  // number shown and the number charged have to be the same number.
  const { data: cost } = useLeaveDayCount(startDate, endDate, halfDay);
  const days = cost ? Number(cost.days) : null;
  // How many of the calendar days in the range are not being charged. Named
  // rather than left implicit, because "4 days off, 2 charged" reads as a
  // miscount unless the form says why.
  const notCharged = cost ? cost.calendar_days - Number(cost.days) : 0;
  const balance = balances?.results.find((b) => b.leave_type === leaveTypeId);
  const willExceed = balance && days !== null && days > Number(balance.remaining_days);

  async function handleSubmit() {
    setError(null);
    if (!leaveTypeId) {
      setError("Choose a leave type.");
      return;
    }
    try {
      await createRequest.mutateAsync({
        leave_type: leaveTypeId,
        start_date: startDate,
        end_date: endDate,
        half_day: halfDay,
        reason,
      });
      setLeaveTypeId("");
      setStartDate("");
      setEndDate("");
      setHalfDay(false);
      setReason("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Request Leave</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid size={12}>
            <LeaveTypePicker
              value={leaveTypeId || null}
              onChange={(id) => setLeaveTypeId(id ?? 0)}
              required
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <DateField label="From" value={startDate} onChange={setStartDate} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <DateField label="To" value={endDate} onChange={setEndDate} />
          </Grid>
          <Grid size={12}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={halfDay}
                  disabled={startDate !== endDate}
                  onChange={(e) => setHalfDay(e.target.checked)}
                />
              }
              label="Half day (single date only)"
            />
          </Grid>
          <Grid size={12}>
            <TextField
              label="Reason"
              fullWidth
              multiline
              minRows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Grid>
          {days !== null && (
            <Grid size={12}>
              <Typography variant="body2" color="text.secondary">
                {days} day(s) will be deducted
                {notCharged > 0 &&
                  ` · ${notCharged} non-working day(s) in this range are not charged`}
                {balance && ` · ${balance.remaining_days} remaining in ${balance.leave_type_name}`}
              </Typography>
              {willExceed && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  This exceeds your remaining balance — it can still be submitted, but your approver
                  will see a warning and decide.
                </Alert>
              )}
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={createRequest.isPending}>
          {createRequest.isPending ? "Submitting..." : "Submit request"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
