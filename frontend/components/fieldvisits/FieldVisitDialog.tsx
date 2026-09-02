"use client";

import PlaceIcon from "@mui/icons-material/Place";
import Alert from "@mui/material/Alert";
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
import { useEffect, useState } from "react";

import DateText from "@/components/common/DateText";
import StateChip from "@/components/common/StateChip";
import {
  VISIT_STATUS_TONE,
  useApproveFieldVisit,
  useCompleteFieldVisit,
  useGenerateTimesheet,
  useRejectFieldVisit,
  useRequestFieldVisit,
  type FieldVisit,
} from "@/hooks/useFieldVisits";
import { useCan, useMe } from "@/hooks/useMe";

/**
 * One visit, and whatever it needs next.
 *
 * The dialog shows a single action bar rather than every button greyed out,
 * because a travel order is only ever at one point in its life: it is waiting
 * to be sent, waiting on an approver, waiting for the traveller to come back
 * and write it up, or finished. Which of those it is decides what is on screen.
 *
 * **The report is required to complete.** The server refuses an empty one —
 * a visit whose report is blank is a trip nobody can account for, and the
 * expense claim attached to it has nothing to sit on. The field is here rather
 * than in a second dialog so that "mark it done" and "say what happened" are
 * the same act.
 */
export default function FieldVisitDialog({
  visit,
  onClose,
}: {
  visit: FieldVisit | null;
  onClose: () => void;
}) {
  const { data: me } = useMe();
  const managesAttendance = useCan("attendance.manage");

  const request = useRequestFieldVisit();
  const approve = useApproveFieldVisit();
  const reject = useRejectFieldVisit();
  const complete = useCompleteFieldVisit();
  const generate = useGenerateTimesheet();

  const [note, setNote] = useState("");
  const [report, setReport] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Seeded from the visit each time a different one is opened, so reopening
  // does not carry the previous visit's half-written report across.
  useEffect(() => {
    setReport(visit?.report ?? "");
    setNote("");
    setError(null);
    setDone(null);
  }, [visit?.id, visit?.report]);

  if (!visit) return null;

  const isTraveller = me?.employee_id === visit.employee;
  const isApprover = me?.employee_id === visit.approver;
  const canDecide = isApprover || managesAttendance;
  const busy =
    request.isPending ||
    approve.isPending ||
    reject.isPending ||
    complete.isPending ||
    generate.isPending;

  async function run(what: () => Promise<unknown>, message?: string) {
    setError(null);
    setDone(null);
    try {
      await what();
      if (message) setDone(message);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be done.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
          <Typography variant="h6" component="span">
            {visit.title}
          </Typography>
          <StateChip label={visit.status_display} tone={VISIT_STATUS_TONE[visit.status] ?? "muted"} />
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {done ? (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setDone(null)}>
            {done}
          </Alert>
        ) : null}

        <Stack spacing={1.5}>
          <Fact label="Traveller" value={`${visit.employee_name} (${visit.employee_code})`} />
          <Fact
            label="Where"
            value={
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <PlaceIcon sx={{ fontSize: 16 }} />
                <span>{[visit.destination, visit.district].filter(Boolean).join(", ")}</span>
              </Stack>
            }
          />
          <Fact
            label="When"
            value={
              <>
                <DateText value={visit.starts_on} /> – <DateText value={visit.ends_on} />
                {` · ${visit.days} day${visit.days === 1 ? "" : "s"}`}
              </>
            }
          />
          <Fact label="Purpose" value={visit.purpose_display} />
          {visit.company_name ? <Fact label="Company" value={visit.company_name} /> : null}
          {visit.project_name ? <Fact label="Project" value={visit.project_name} /> : null}
          {visit.transport ? <Fact label="Transport" value={visit.transport} /> : null}
          {visit.estimated_cost ? <Fact label="Estimated cost" value={visit.estimated_cost} /> : null}
          {visit.approver_name ? <Fact label="Approver" value={visit.approver_name} /> : null}
          {visit.decision_note ? <Fact label="Decision note" value={visit.decision_note} /> : null}

          {visit.description ? (
            <>
              <Divider />
              <Typography variant="overline" color="text.secondary">
                Details
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {visit.description}
              </Typography>
            </>
          ) : null}

          {visit.participants.length > 0 ? (
            <>
              <Divider />
              <Typography variant="overline" color="text.secondary">
                Who else went
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
                {visit.participants.map((person) => (
                  <Chip
                    key={person.id}
                    size="small"
                    variant="outlined"
                    label={
                      person.organisation ? `${person.name} · ${person.organisation}` : person.name
                    }
                  />
                ))}
              </Stack>
            </>
          ) : null}

          <Divider />
          <Typography variant="overline" color="text.secondary">
            Report
          </Typography>
          {visit.status === "completed" ? (
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
              {visit.report}
            </Typography>
          ) : visit.status === "approved" && (isTraveller || managesAttendance) ? (
            <TextField
              fullWidth
              multiline
              minRows={4}
              value={report}
              onChange={(event) => setReport(event.target.value)}
              placeholder="What was seen, what was decided, what needs doing next."
              helperText="Required — a visit with no report cannot be closed."
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              Written when the traveller returns.
            </Typography>
          )}
        </Stack>

        {/* The note travels with an approval or a refusal, so it sits with the
            buttons that use it rather than in the body above. */}
        {visit.status === "requested" && canDecide ? (
          <TextField
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            label="Note (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        ) : null}
      </DialogContent>

      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button onClick={onClose}>Close</Button>
        <Box sx={{ flex: 1 }} />

        {visit.status === "draft" && isTraveller ? (
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => run(() => request.mutateAsync({ id: visit.id }))}
          >
            Send for approval
          </Button>
        ) : null}

        {visit.status === "requested" && canDecide ? (
          <>
            <Button
              color="error"
              disabled={busy}
              onClick={() => run(() => reject.mutateAsync({ id: visit.id, note }))}
            >
              Reject
            </Button>
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => run(() => approve.mutateAsync({ id: visit.id, note }))}
            >
              Approve
            </Button>
          </>
        ) : null}

        {visit.status === "approved" && (isTraveller || managesAttendance) ? (
          <Button
            variant="contained"
            disabled={busy || !report.trim()}
            onClick={() => run(() => complete.mutateAsync({ id: visit.id, report }))}
          >
            Complete with report
          </Button>
        ) : null}

        {visit.status === "completed" && (isTraveller || managesAttendance) ? (
          <Button
            disabled={busy}
            onClick={async () => {
              // Not routed through `run`: this one reports back into the open
              // dialog rather than closing it, because the useful part is the
              // count of lines written.
              setError(null);
              setDone(null);
              try {
                const result = await generate.mutateAsync({ id: visit.id });
                setDone(`${result.created} timesheet line(s) written across ${result.days} day(s).`);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Those lines could not be written.");
              }
            }}
          >
            Write timesheet lines
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "baseline" }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 120 }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div">
        {value}
      </Typography>
    </Stack>
  );
}
