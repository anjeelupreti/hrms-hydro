"use client";

import AttachFileIcon from "@mui/icons-material/AttachFile";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubble";
import EventIcon from "@mui/icons-material/Event";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CardContent from "@mui/material/CardContent";
import Rating from "@mui/material/Rating";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import PersonAvatar from "@/components/common/PersonAvatar";
import { useState } from "react";

import DateText from "@/components/common/DateText";
import KanbanBoard from "@/components/common/KanbanBoard";
import CandidateDetailDialog from "@/components/recruitment/CandidateDetailDialog";
import { STAGE_META, STAGE_ORDER } from "@/components/recruitment/recruitmentMeta";
import { useMoveCandidate } from "@/hooks/useRecruitment";
import type { Candidate, CandidateStage } from "@/types/recruitment";

/** Six statuses, three things worth knowing at a glance: waiting on them,
 *  they said yes, they said no. Draft is shown too because an offer that was
 *  written and never sent is a candidate quietly stalled. */
const OFFER_META: Record<string, { label: string; color: "default" | "info" | "success" | "error" | "warning" }> = {
  draft: { label: "Offer drafted", color: "default" },
  sent: { label: "Offer sent", color: "info" },
  accepted: { label: "Accepted", color: "success" },
  declined: { label: "Declined", color: "error" },
  withdrawn: { label: "Withdrawn", color: "warning" },
  expired: { label: "Offer expired", color: "error" },
};

function OfferBadge({ candidate }: { candidate: Candidate }) {
  const meta = OFFER_META[candidate.offer_status ?? ""] ?? null;
  if (!meta) return null;

  // Days left, only while it is still theirs to answer — an expiry on an
  // accepted offer is noise; on a sent one it is the only urgent thing about
  // the card.
  //
  // Taken from the server rather than computed here. Reading the clock during
  // render is impure, and a browser comparing a date against its own clock
  // disagrees with the server about what has already lapsed — the same
  // reasoning that put `is_open` on the offer.
  const daysLeft =
    candidate.offer_status === "sent" ? candidate.offer_expires_in_days : null;

  return (
    <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, alignItems: "center", flexWrap: "wrap" }}>
      <Chip size="small" color={meta.color} label={meta.label} />
      {daysLeft !== null && daysLeft <= 7 && (
        <Chip
          size="small"
          variant="outlined"
          color={daysLeft < 0 ? "error" : "warning"}
          label={daysLeft < 0 ? "lapsed" : daysLeft === 0 ? "today" : `${daysLeft}d left`}
        />
      )}
    </Stack>
  );
}

export default function CandidatePipeline({ candidates }: { candidates: Candidate[] }) {
  const moveCandidate = useMoveCandidate();
  /**
   * The *id* of the open candidate, not the record.
   *
   * **A snapshot cannot show the result of its own action.** This held the
   * candidate object taken at click time, so pressing "Advance to Screening"
   * updated the server and the board behind the dialog while the dialog itself
   * went on saying Applied — the button appeared to do nothing at all. Holding
   * the id and looking the record up on every render means the dialog is
   * rendered from the same refreshed list the board is.
   */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = candidates.find((c) => c.id === selectedId) ?? null;

  const columns = STAGE_ORDER.map((stage) => ({
    value: stage,
    label: STAGE_META[stage].label,
    cards: candidates.filter((c) => c.stage === stage),
    is_terminal: stage === "hired" || stage === "rejected",
  }));

  return (
    <>
      {/* The shared board. What stays here is the only recruitment-specific
          part — what a candidate card says.

          No `transitions`: an offer decides the last two stages, not a drag,
          and `HireActions` owns that. Dragging still works for the stages
          before them, where moving somebody back to screening is ordinary. */}
      <KanbanBoard
        columns={columns}
        getId={(c) => c.id}
        onMove={(candidate, to) =>
          moveCandidate.mutate({ id: candidate.id, stage: to as CandidateStage })
        }
        emptyHint="Nobody at this stage"
        columnWidth={264}
        renderCard={(c) => (
          <Card>
            {/* 🔒 A `ButtonBase` inside a `Draggable` swallows the mousedown
                that starts a drag — see `TaskCard`, which had the same fault.
                This board looked drag-enabled and was not. */}
            <Box
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(c.id);
                }
              }}
              sx={{
                cursor: "pointer",
                borderRadius: 2,
                outline: "none",
                "&:focus-visible": {
                  boxShadow: (t) => `0 0 0 2px ${t.vars.palette.primary.main}`,
                },
              }}
            >
              <CardContent sx={{ p: "12px !important" }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
                  {/* `PersonAvatar`, not a hand-styled `Avatar`. Its initials,
                      its accent shading and its photo handling are the ones
                      used everywhere else — a second set of rules here is how a
                      candidate ends up looking unlike the same person on their
                      employee card. */}
                  <PersonAvatar name={c.name} size={28} variant="outlined" />
                  <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }} noWrap>
                    {c.name}
                  </Typography>
                </Stack>
                {c.rating ? <Rating value={c.rating} size="small" readOnly /> : null}

                {c.offer_status && <OfferBadge candidate={c} />}

                <Stack direction="row" spacing={1.5} sx={{ mt: 0.75, color: "text.secondary", alignItems: "center", flexWrap: "wrap" }}>
                  {c.note_count > 0 && (
                    <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
                      <ChatBubbleOutlineIcon sx={{ fontSize: 14 }} />
                      <Typography variant="caption">{c.note_count}</Typography>
                    </Stack>
                  )}
                  {c.has_resume && <AttachFileIcon sx={{ fontSize: 14 }} />}
                  {c.interview_at && (
                    <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
                      <EventIcon sx={{ fontSize: 14 }} />
                      <Typography variant="caption">
                        <DateText value={c.interview_at} format="short" />
                      </Typography>
                    </Stack>
                  )}
                </Stack>
              </CardContent>
            </Box>
          </Card>
        )}
      />

      {selected && <CandidateDetailDialog candidate={selected} onClose={() => setSelectedId(null)} />}
    </>
  );
}
