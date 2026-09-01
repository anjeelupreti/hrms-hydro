"use client";

import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import {
  useApproveLifecycleEvent,
  usePendingLifecycleApprovals,
  useRejectLifecycleEvent,
} from "@/hooks/useLifecycle";
import DateText from "@/components/common/DateText";
import EmployeeLink from "@/components/common/EmployeeLink";

const EVENT_LABELS: Record<string, string> = {
  promotion: "Promotion",
  resignation: "Resignation",
  termination: "Termination",
  transfer: "Transfer",
};

function eventSummary(event: {
  event_type: string;
  new_designation_title: string | null;
  new_department_name: string | null;
  new_manager_name: string | null;
  last_working_date: string | null;
}) {
  if (event.event_type === "promotion") return `New designation: ${event.new_designation_title ?? "—"}`;
  if (event.event_type === "transfer") {
    const parts = [];
    if (event.new_department_name) parts.push(`Dept: ${event.new_department_name}`);
    if (event.new_manager_name) parts.push(`Manager: ${event.new_manager_name}`);
    return parts.join(", ") || "—";
  }
  if (event.event_type === "resignation" || event.event_type === "termination") {
    return `Last working date: ${event.last_working_date ?? "—"}`;
  }
  return "";
}

export default function LifecycleApprovalsInbox() {
  const { data: pending } = usePendingLifecycleApprovals();
  const approve = useApproveLifecycleEvent();
  const reject = useRejectLifecycleEvent();
  const [comments, setComments] = useState<Record<number, string>>({});

  if (!pending || pending.length === 0) return null;

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Awaiting your approval
      </Typography>
      <Stack spacing={2}>
        {pending.map((event) => (
          <Card key={event.id} variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" component="div">
                <EmployeeLink id={event.employee} name={event.employee_name} variant="subtitle1" /> —{" "}
                {EVENT_LABELS[event.event_type] ?? event.event_type}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Effective <DateText value={event.effective_date} /> · {eventSummary(event)}
              </Typography>
              {event.reason && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  &ldquo;{event.reason}&rdquo;
                </Typography>
              )}
              <TextField
                label="Comment (optional)"
                size="small"
                fullWidth
                sx={{ mt: 2 }}
                value={comments[event.id] ?? ""}
                onChange={(e) => setComments((prev) => ({ ...prev, [event.id]: e.target.value }))}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                <Button
                  variant="contained"
                  color="success"
                  size="small"
                  startIcon={<CheckIcon />}
                  onClick={() => approve.mutate({ id: event.id, comment: comments[event.id] })}
                  disabled={approve.isPending || reject.isPending}
                >
                  Approve
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<CloseIcon />}
                  onClick={() => reject.mutate({ id: event.id, comment: comments[event.id] })}
                  disabled={approve.isPending || reject.isPending}
                >
                  Reject
                </Button>
              </Stack>
              {(approve.isError || reject.isError) && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  Something went wrong.
                </Alert>
              )}
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
