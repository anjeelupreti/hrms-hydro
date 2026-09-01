"use client";

import BadgeIcon from "@mui/icons-material/Badge";
import DescriptionIcon from "@mui/icons-material/Description";
import SendIcon from "@mui/icons-material/Send";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import { DepartmentPicker, DesignationPicker } from "@/components/common/pickers";
import {
  useConvertCandidate,
  useOfferAction,
  useOfferForCandidate,
  useSaveOffer,
  type ConversionResult,
} from "@/hooks/useRecruitment";
import type { Candidate } from "@/types/recruitment";

/**
 * The half of hiring the browser could not reach.
 *
 * The pipeline advanced a candidate to "offer" and then "hired" by setting a
 * field, and nothing else happened: no `Offer` row, no acceptance recorded, no
 * account, no onboarding checklist. Every one of those existed on the server
 * and had tests. So the last two stages of hiring looked like they worked and
 * changed only a label — which is worse than a missing button, because the
 * label says the thing is done.
 *
 * **Acceptance and provisioning stay separate**, matching the service: an offer
 * accepted on Friday for a March start should not create a login in November.
 * So "Accepted" and "Create their account" are two buttons, not one.
 */
export default function HireActions({ candidate }: { candidate: Candidate }) {
  const { data: offer } = useOfferForCandidate(candidate.id);
  const saveOffer = useSaveOffer();
  const act = useOfferAction();
  const convert = useConvertCandidate();

  const [drafting, setDrafting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ConversionResult | null>(null);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  const busy = saveOffer.isPending || act.isPending || convert.isPending;

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }} useFlexGap>
        {offer && (
          <Chip
            size="small"
            label={`Offer ${offer.status}`}
            color={
              offer.status === "accepted"
                ? "success"
                : offer.status === "declined" || offer.status === "expired"
                  ? "error"
                  : "default"
            }
          />
        )}

        {!offer && (
          <Button
            size="small"
            variant="contained"
            startIcon={<DescriptionIcon />}
            disabled={busy}
            onClick={() => setDrafting(true)}
          >
            Draft an offer
          </Button>
        )}

        {offer?.status === "draft" && (
          <Button
            size="small"
            variant="contained"
            startIcon={<SendIcon />}
            disabled={busy}
            onClick={() => run(() => act.mutateAsync({ id: offer.id, action: "send" }))}
          >
            Send it
          </Button>
        )}

        {offer?.status === "sent" && (
          <>
            <Button
              size="small"
              variant="contained"
              color="success"
              disabled={busy}
              onClick={() => run(() => act.mutateAsync({ id: offer.id, action: "accept" }))}
            >
              They accepted
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() => setDeclining(true)}
            >
              They declined
            </Button>
          </>
        )}

        {/* Only once they have actually said yes. A "create the account" button
            on an unanswered offer is how somebody gets a login for a job they
            turned down. */}
        {candidate.stage === "hired" && (
          <Button
            size="small"
            variant="contained"
            startIcon={<BadgeIcon />}
            disabled={busy}
            onClick={() =>
              run(async () => setCreated(await convert.mutateAsync(candidate.id)))
            }
          >
            Create their employee account
          </Button>
        )}
      </Stack>

      {offer?.status === "declined" && offer.decline_reason && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          Reason given: {offer.decline_reason}
        </Typography>
      )}

      {created && (
        <Alert severity="success" sx={{ mt: 2 }}>
          <strong>{created.employee_code}</strong> created. Their username is{" "}
          <strong>{created.username}</strong> and a temporary password has been emailed to{" "}
          {created.email} — they will be asked to choose their own on first sign-in.
          {created.onboarding_tasks > 0 &&
            ` ${created.onboarding_tasks} onboarding tasks are waiting for them.`}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {drafting && (
        <OfferDialog
          candidateName={candidate.name}
          saving={saveOffer.isPending}
          onSave={async (values) => {
            await run(async () => {
              await saveOffer.mutateAsync({ candidate: candidate.id, ...values });
              setDrafting(false);
            });
          }}
          onClose={() => setDrafting(false)}
        />
      )}

      {declining && offer && (
        <Dialog open onClose={() => setDeclining(false)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ fontWeight: 700 }}>Why did they decline?</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              {/* A decline is not a rejection, and the reason is the most
                  useful thing recruitment learns here — it is exactly what
                  gets lost when a decline is filed as "rejected". */}
              <TextField
                label="Reason"
                size="small"
                autoFocus
                fullWidth
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Counter-offer, relocation, salary…"
              />
              <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                <Button onClick={() => setDeclining(false)}>Cancel</Button>
                <Button
                  variant="contained"
                  color="error"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await act.mutateAsync({ id: offer.id, action: "decline", reason });
                      setDeclining(false);
                      setReason("");
                    })
                  }
                >
                  Record decline
                </Button>
              </Stack>
            </Stack>
          </DialogContent>
        </Dialog>
      )}
    </Box>
  );
}

function OfferDialog({
  candidateName,
  saving,
  onSave,
  onClose,
}: {
  candidateName: string;
  saving: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [salary, setSalary] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [department, setDepartment] = useState<number | null>(null);
  const [designation, setDesignation] = useState<number | null>(null);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Offer for {candidateName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            These carry across to the employee record on conversion, so what is
            agreed here is what they are hired on — nobody re-keys it later.
          </Typography>

          <TextField
            label="Annual salary"
            size="small"
            type="number"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            fullWidth
          />
          <DepartmentPicker value={department} onChange={setDepartment} />
          <DesignationPicker
            value={designation}
            onChange={setDesignation}
            departmentId={department ?? undefined}
          />
          <DateField label="Start date" value={startDate} onChange={setStartDate} size="small" />
          <DateField
            label="Expires on"
            value={expiresOn}
            onChange={setExpiresOn}
            size="small"
            helperText="After this, accepting is refused and the lapse is recorded."
          />

          <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              disabled={saving}
              onClick={() =>
                onSave({
                  annual_salary: salary || null,
                  start_date: startDate || null,
                  expires_on: expiresOn || null,
                  department,
                  designation,
                })
              }
            >
              {saving ? "Saving…" : "Save draft"}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
