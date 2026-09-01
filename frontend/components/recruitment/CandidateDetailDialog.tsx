"use client";

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import BlockIcon from "@mui/icons-material/Block";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Rating from "@mui/material/Rating";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateTimeField from "@/components/common/DateTimeField";
import HireActions from "@/components/recruitment/HireActions";
import { STAGE_META, STAGE_ORDER } from "@/components/recruitment/recruitmentMeta";
import UploadFileIcon from "@mui/icons-material/UploadFile";

import { useAddCandidateNote, useCandidateNotes, useSaveCandidate, useUploadCandidateResume } from "@/hooks/useRecruitment";
import type { Candidate, CandidateStage } from "@/types/recruitment";

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

// The forward path a candidate advances along (rejected is a side-exit).
const ADVANCE: Partial<Record<CandidateStage, CandidateStage>> = {
  applied: "screening",
  screening: "interview",
  interview: "offer",
  offer: "hired",
};

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CandidateDetailDialog({ candidate, onClose }: { candidate: Candidate; onClose: () => void }) {
  const { data: notes } = useCandidateNotes(candidate.id);
  const saveCandidate = useSaveCandidate();
  const addNote = useAddCandidateNote();
  const uploadResume = useUploadCandidateResume();
  const [noteBody, setNoteBody] = useState("");
  // Was `defaultValue` on a native control — uncontrolled, so it never
  // reflected a change it did not cause. `DateTimeField` is controlled, which
  // it has to be: the BS branch is two inputs and only the parent knows the
  // moment they add up to.
  const [interviewAt, setInterviewAt] = useState(() => toLocalInput(candidate.interview_at));
  const nextStage = ADVANCE[candidate.stage];

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogContent>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 2 }}>
          <Avatar sx={{ width: 56, height: 56, bgcolor: "transparent", color: "primary.main", border: "1.5px solid", borderColor: "primary.main" }}>
            {initials(candidate.name)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6">{candidate.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {candidate.job_title}
              {candidate.source ? ` · via ${candidate.source}` : ""}
            </Typography>
          </Box>
          <Chip size="small" label={STAGE_META[candidate.stage].label} color={STAGE_META[candidate.stage].color} />
        </Stack>

        <Stack spacing={2}>
          {/* Pipeline actions */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
            {/* Advancing stops at "offer". Past that the stage is a *result*,
                not an action: a candidate becomes offered by an offer existing,
                and hired by accepting it. Letting the arrow set those fields
                directly is what made the last two stages decorative — the label
                said hired and no account, offer or checklist existed. */}
            {nextStage && candidate.stage !== "interview" && candidate.stage !== "offer" && (
              <Button
                size="small"
                variant="contained"
                endIcon={<ArrowForwardIcon />}
                onClick={() => saveCandidate.mutate({ id: candidate.id, values: { stage: nextStage } })}
              >
                Advance to {STAGE_META[nextStage].label}
              </Button>
            )}
            {candidate.stage !== "rejected" && candidate.stage !== "hired" && (
              <Button
                size="small"
                color="error"
                variant="outlined"
                startIcon={<BlockIcon />}
                onClick={() => saveCandidate.mutate({ id: candidate.id, values: { stage: "rejected" } })}
              >
                Disqualify
              </Button>
            )}
          </Stack>

          {(candidate.stage === "interview" ||
            candidate.stage === "offer" ||
            candidate.stage === "hired") && <HireActions candidate={candidate} />}

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              select
              label="Stage"
              size="small"
              fullWidth
              value={candidate.stage}
              onChange={(e) => saveCandidate.mutate({ id: candidate.id, values: { stage: e.target.value as CandidateStage } })}
            >
              {STAGE_ORDER.map((s) => (
                <MenuItem key={s} value={s}>
                  {STAGE_META[s].label}
                </MenuItem>
              ))}
            </TextField>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Rating
              </Typography>
              <Rating
                value={candidate.rating ?? 0}
                onChange={(_, v) => saveCandidate.mutate({ id: candidate.id, values: { rating: v ?? 0 } })}
              />
            </Box>
          </Stack>

          <DateTimeField
            label="Interview date/time"
            size="small"
            value={interviewAt}
            onChange={(v) => {
              setInterviewAt(v);
              saveCandidate.mutate({
                id: candidate.id,
                values: { interview_at: v ? new Date(v).toISOString() : null },
              });
            }}
          />

          {(candidate.email || candidate.phone) && (
            <Typography variant="body2" color="text.secondary">
              {[candidate.email, candidate.phone].filter(Boolean).join(" · ")}
            </Typography>
          )}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            {candidate.has_resume && (
              <Link href={`/api/proxy/recruitment/candidates/${candidate.id}/resume`} target="_blank" rel="noopener" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                <AttachFileIcon fontSize="small" /> View résumé
              </Link>
            )}
            <Button component="label" size="small" startIcon={<UploadFileIcon />} disabled={uploadResume.isPending}>
              {candidate.has_resume ? "Replace résumé" : "Upload résumé"}
              <input
                hidden
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadResume.mutate({ id: candidate.id, file });
                }}
              />
            </Button>
          </Stack>

          <Divider />

          <Typography variant="overline" color="text.secondary">
            Notes & interview key points
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              placeholder="Add a note or interview key point…"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && noteBody.trim()) {
                  addNote.mutate({ candidateId: candidate.id, body: noteBody.trim() });
                  setNoteBody("");
                }
              }}
            />
            <Button
              variant="contained"
              disabled={!noteBody.trim() || addNote.isPending}
              onClick={() => {
                addNote.mutate({ candidateId: candidate.id, body: noteBody.trim() });
                setNoteBody("");
              }}
            >
              Add
            </Button>
          </Stack>
          <Stack spacing={1}>
            {(notes ?? []).length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No notes yet.
              </Typography>
            ) : (
              notes?.map((n) => (
                <Box key={n.id} sx={{ p: 1.25, borderRadius: 2, bgcolor: "action.hover" }}>
                  <Typography variant="body2">{n.body}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {n.author_name ?? "Someone"} · {new Date(n.created_at).toLocaleString()}
                  </Typography>
                </Box>
              ))
            )}
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
