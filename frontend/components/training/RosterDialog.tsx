"use client";

import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import VerifiedIcon from "@mui/icons-material/Verified";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import Link from "@mui/material/Link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import EmployeeLink from "@/components/common/EmployeeLink";
import { EmployeePicker } from "@/components/common/pickers";
import {
  useAssignEmployees,
  useCompleteEnrollment,
  useEnrollmentAction,
  useEnrollments,
  useIssueCertificate,
} from "@/hooks/useTraining";
import { ENROLLMENT_META } from "@/components/training/trainingMeta";
import type { Enrollment, TrainingSession } from "@/types/training";

type Props = {
  open: boolean;
  onClose: () => void;
  session: TrainingSession;
};

export default function RosterDialog({ open, onClose, session }: Props) {
  const { data: enrollments } = useEnrollments({ session: session.id });
  const action = useEnrollmentAction();
  const complete = useCompleteEnrollment();
  const assign = useAssignEmployees();
  const issueCertificate = useIssueCertificate();

  const [assignIds, setAssignIds] = useState<number[]>([]);
  const [completing, setCompleting] = useState<Enrollment | null>(null);

  const active = (enrollments ?? []).filter((e) => e.status !== "cancelled" && e.status !== "declined");
  const enrolledIds = new Set(active.map((e) => e.employee));
  // `capacity: 0` means uncapped, which is not the same as "no seats left".
  const seatsLeft = session.capacity > 0 ? Math.max(session.capacity - active.length, 0) : null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Roster · {session.program_title}
        <Typography variant="body2" color="text.secondary">
          {session.seats_taken} enrolled{session.capacity > 0 ? ` / ${session.capacity} seats` : ""}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {/* Assign. Multi-select because filling a roster is one task, not
            twenty — and the chips show who is queued before you commit. */}
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "flex-start" }}>
          <EmployeePicker
            multiple
            label="Add attendees"
            value={assignIds}
            onChange={setAssignIds}
            excludeIds={[...enrolledIds]}
            size="small"
            max={seatsLeft ?? undefined}
            helperText={
              seatsLeft === null
                ? undefined
                : `${seatsLeft} of ${session.capacity} seats left.`
            }
          />
          <Button
            variant="outlined"
            startIcon={<PersonAddIcon />}
            disabled={assignIds.length === 0 || assign.isPending}
            sx={{ flexShrink: 0, mt: 0.5 }}
            onClick={async () => {
              await assign.mutateAsync({ sessionId: session.id, employeeIds: assignIds });
              setAssignIds([]);
            }}
          >
            Assign{assignIds.length > 0 ? ` (${assignIds.length})` : ""}
          </Button>
        </Stack>

        <Divider sx={{ mb: 1 }} />

        {active.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
            No one enrolled yet.
          </Typography>
        ) : (
          <Stack spacing={1} divider={<Divider flexItem />}>
            {active.map((enr) => (
              <Box key={enr.id}>
                <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <EmployeeLink id={enr.employee} name={enr.employee_name} />
                    <Chip
                      size="small"
                      label={ENROLLMENT_META[enr.status].label}
                      color={ENROLLMENT_META[enr.status].color}
                      variant="outlined"
                    />
                    {enr.status === "completed" && enr.score != null && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        Score {enr.score}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={0.5}>
                    {enr.status === "requested" && (
                      <>
                        <Button size="small" startIcon={<CheckIcon />} onClick={() => action.mutate({ id: enr.id, action: "approve" })}>
                          Approve
                        </Button>
                        <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => action.mutate({ id: enr.id, action: "decline" })}>
                          Decline
                        </Button>
                      </>
                    )}
                    {enr.status === "enrolled" && (
                      <>
                        <Button size="small" onClick={() => setCompleting(enr)}>
                          Complete
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => complete.mutate({ id: enr.id, status: "no_show" })}
                        >
                          No-show
                        </Button>
                      </>
                    )}
                    {/* Certificate: view if issued, otherwise let HR issue it
                        (which completes + emails the participant). */}
                    {(enr.status === "enrolled" || enr.status === "completed") &&
                      (enr.certificate_issued_at ? (
                        <Button
                          size="small"
                          color="success"
                          startIcon={<VerifiedIcon />}
                          component={Link}
                          href={`/training/certificate/${enr.id}`}
                        >
                          Certificate
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          startIcon={<WorkspacePremiumIcon />}
                          disabled={issueCertificate.isPending}
                          onClick={() => issueCertificate.mutate(enr.id)}
                        >
                          Issue certificate
                        </Button>
                      ))}

                    {/* Adding someone must be undoable — except once they hold
                        a certificate, which is already out of our hands. The
                        server refuses either way (see cancel_enrollment); this
                        just explains why rather than letting them click and
                        collect an error. */}
                    <Tooltip
                      title={
                        enr.certificate_issued_at
                          ? "Certificate already issued — revoke it first"
                          : "Remove from this roster"
                      }
                    >
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          aria-label={`Remove ${enr.employee_name} from the roster`}
                          disabled={Boolean(enr.certificate_issued_at) || action.isPending}
                          onClick={() => action.mutate({ id: enr.id, action: "cancel" })}
                        >
                          <PersonRemoveIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>

      {completing && (
        <CompleteDialog
          enrollment={completing}
          onClose={() => setCompleting(null)}
          onSubmit={async (score, feedback) => {
            await complete.mutateAsync({ id: completing.id, status: "completed", score, feedback });
            setCompleting(null);
          }}
          pending={complete.isPending}
        />
      )}
    </Dialog>
  );
}

function CompleteDialog({
  enrollment,
  onClose,
  onSubmit,
  pending,
}: {
  enrollment: Enrollment;
  onClose: () => void;
  onSubmit: (score: number | null, feedback: string) => void;
  pending: boolean;
}) {
  const [score, setScore] = useState<string>("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Complete · {enrollment.employee_name}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Score (0–100, optional)"
            type="number"
            fullWidth
            value={score}
            onChange={(e) => setScore(e.target.value)}
          />
          <TextField
            label="Feedback (optional)"
            fullWidth
            multiline
            minRows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={pending}
          onClick={() => {
            const n = score === "" ? null : Number(score);
            if (n != null && (n < 0 || n > 100)) {
              setError("Score must be between 0 and 100.");
              return;
            }
            onSubmit(n, feedback);
          }}
        >
          Mark completed
        </Button>
      </DialogActions>
    </Dialog>
  );
}
