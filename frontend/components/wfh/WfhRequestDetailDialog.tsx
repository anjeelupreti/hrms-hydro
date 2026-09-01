"use client";

import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import HomeWorkIcon from "@mui/icons-material/HomeWork";
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
import Typography from "@mui/material/Typography";

import EmployeeLink from "@/components/common/EmployeeLink";
import { useWfhAction } from "@/hooks/useWfh";
import type { WFHRequest, WFHStatus } from "@/types/wfh";

const STATUS_COLOR: Record<WFHStatus, "success" | "warning" | "error" | "default"> = {
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
        {value || "—"}
      </Typography>
    </Box>
  );
}

export default function WfhRequestDetailDialog({
  request,
  canDecide,
  isOwner,
  onClose,
}: {
  request: WFHRequest;
  canDecide: boolean;
  isOwner: boolean;
  onClose: () => void;
}) {
  const action = useWfhAction();
  const pending = request.status === "pending";

  function run(kind: "approve" | "reject" | "cancel") {
    action.mutate({ id: request.id, action: kind }, { onSuccess: onClose });
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Avatar sx={{ bgcolor: "transparent", color: "secondary.main", border: "1.5px solid", borderColor: "secondary.main" }}>
            <HomeWorkIcon />
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <EmployeeLink id={request.employee} name={request.employee_name} variant="subtitle1" />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {request.department_name ?? "—"}
            </Typography>
          </Box>
          <Chip size="small" label={request.status} color={STATUS_COLOR[request.status]} />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={4} sx={{ mb: 2, flexWrap: "wrap", gap: 2 }}>
          <Field label="From" value={request.start_date} />
          <Field label="To" value={request.end_date} />
          <Field label="Days" value={request.days} />
          <Field label="Location" value={request.work_location === "home" ? "Home" : "Remote"} />
        </Stack>
        <Stack spacing={1.5}>
          <Field label="Location note" value={request.location_note} />
          <Field label="Reason" value={request.reason} />
        </Stack>
        {request.decided_by_name && (
          <>
            <Divider sx={{ my: 2 }} />
            <Field
              label="Decision"
              value={`${request.decided_by_name}${request.decided_at ? ` · ${new Date(request.decided_at).toLocaleString()}` : ""}`}
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        {pending && isOwner && (
          <Button color="inherit" onClick={() => run("cancel")} disabled={action.isPending}>
            Cancel request
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Close</Button>
        {pending && canDecide && (
          <>
            <Button color="error" startIcon={<CloseIcon />} onClick={() => run("reject")} disabled={action.isPending}>
              Reject
            </Button>
            <Button variant="contained" startIcon={<CheckIcon />} onClick={() => run("approve")} disabled={action.isPending}>
              Approve
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
