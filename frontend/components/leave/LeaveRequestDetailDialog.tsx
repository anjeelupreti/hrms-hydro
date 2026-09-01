"use client";

import BlockIcon from "@mui/icons-material/Block";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import EventIcon from "@mui/icons-material/Event";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import EmployeeLink from "@/components/common/EmployeeLink";
import {
  useApproveLeaveRequest,
  useCancelLeaveRequest,
  useLeaveRequestActions,
  useRejectLeaveRequest,
} from "@/hooks/useLeave";
import type { LeaveRequest, LeaveStatus } from "@/types/leave";

const STATUS_COLOR: Record<LeaveStatus, "success" | "warning" | "error" | "default"> = {
  approved: "success",
  pending: "warning",
  rejected: "error",
  cancelled: "default",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function LeaveRequestDetailDialog({
  request,
  canManage,
  isOwner,
  onClose,
}: {
  request: LeaveRequest;
  canManage: boolean;
  isOwner: boolean;
  onClose: () => void;
}) {
  const { data: history } = useLeaveRequestActions(request.id);
  const approve = useApproveLeaveRequest();
  const reject = useRejectLeaveRequest();
  const cancel = useCancelLeaveRequest();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pending = request.status === "pending";
  const busy = approve.isPending || reject.isPending || cancel.isPending;

  async function run(mutation: typeof approve, withComment = true) {
    setError(null);
    try {
      await mutation.mutateAsync({ id: request.id, comment: withComment ? comment : undefined });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Avatar sx={{ bgcolor: "transparent", color: "primary.main", border: "1.5px solid", borderColor: "primary.main" }}>
            <EventIcon />
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">{request.leave_type_name}</Typography>
            <EmployeeLink id={request.employee} name={request.employee_name} />
          </Box>
          <Chip size="small" label={request.status} color={STATUS_COLOR[request.status]} />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {request.exceeds_balance && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            This request exceeds the employee&apos;s available balance.
          </Alert>
        )}

        <Stack direction="row" spacing={4} sx={{ mb: 2, flexWrap: "wrap", gap: 2 }}>
          <Field label="From" value={request.start_date} />
          <Field label="To" value={request.end_date} />
          <Field label="Days" value={`${request.days_requested}${request.half_day ? " (half day)" : ""}`} />
          <Field label="Paid" value={request.is_paid ? "Paid" : "Unpaid"} />
        </Stack>
        {request.reason && <Field label="Reason" value={request.reason} />}

        <Divider sx={{ my: 2 }} />
        <Typography variant="overline" color="text.secondary">
          Approval history
        </Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {(history ?? []).length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No decisions recorded yet.
            </Typography>
          ) : (
            history?.map((h) => (
              <Box key={h.id} sx={{ p: 1.25, borderRadius: 2, bgcolor: "action.hover" }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Chip
                    size="small"
                    label={h.decision}
                    color={h.decision === "approved" ? "success" : "error"}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Step {h.step_sequence} · {h.actor_name ?? "—"} · {new Date(h.created_at).toLocaleString()}
                  </Typography>
                </Stack>
                {h.comment && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {h.comment}
                  </Typography>
                )}
              </Box>
            ))
          )}
        </Stack>

        {pending && (canManage || isOwner) && (
          <TextField
            label="Comment (optional)"
            fullWidth
            size="small"
            multiline
            minRows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            sx={{ mt: 2 }}
          />
        )}
      </DialogContent>
      <DialogActions>
        {pending && isOwner && (
          <Button color="inherit" startIcon={<CancelIcon />} onClick={() => run(cancel, false)} disabled={busy}>
            Cancel request
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Close</Button>
        {pending && canManage && (
          <>
            <Button color="error" startIcon={<BlockIcon />} onClick={() => run(reject)} disabled={busy}>
              Reject
            </Button>
            <Button variant="contained" startIcon={<CheckCircleIcon />} onClick={() => run(approve)} disabled={busy}>
              Approve
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
