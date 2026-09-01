"use client";

import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateText from "@/components/common/DateText";
import EmployeeLink from "@/components/common/EmployeeLink";
import { useApproveLeaveRequest, usePendingMyAction, useRejectLeaveRequest } from "@/hooks/useLeave";

export default function ApprovalsInbox() {
  const { data: pending } = usePendingMyAction();
  const approve = useApproveLeaveRequest();
  const reject = useRejectLeaveRequest();
  const [comments, setComments] = useState<Record<number, string>>({});

  if (!pending || pending.length === 0) return null;

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Awaiting your approval
      </Typography>
      <Stack spacing={2}>
        {pending.map((req) => (
          <Card key={req.id} variant="outlined">
            <CardContent>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ justifyContent: "space-between" }}
              >
                <Box>
                  <Typography variant="subtitle1" component="div">
                    <EmployeeLink id={req.employee} name={req.employee_name} variant="subtitle1" /> —{" "}
                    {req.leave_type_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    <DateText value={req.start_date} /> to <DateText value={req.end_date} /> · {req.days_requested} day(s)
                  </Typography>
                  {req.reason && (
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      &ldquo;{req.reason}&rdquo;
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    {req.exceeds_balance && (
                      <Chip size="small" color="warning" label="Exceeds balance" />
                    )}
                    {!req.is_paid && <Chip size="small" color="default" label="Unpaid" />}
                  </Stack>
                </Box>
              </Stack>
              <TextField
                label="Comment (optional)"
                size="small"
                fullWidth
                sx={{ mt: 2 }}
                value={comments[req.id] ?? ""}
                onChange={(e) => setComments((prev) => ({ ...prev, [req.id]: e.target.value }))}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                <Button
                  variant="contained"
                  color="success"
                  size="small"
                  startIcon={<CheckIcon />}
                  onClick={() => approve.mutate({ id: req.id, comment: comments[req.id] })}
                  disabled={approve.isPending || reject.isPending}
                >
                  Approve
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<CloseIcon />}
                  onClick={() => reject.mutate({ id: req.id, comment: comments[req.id] })}
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
