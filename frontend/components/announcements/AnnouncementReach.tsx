"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect } from "react";

import { useAcknowledgeAnnouncement, useMarkAnnouncementSeen } from "@/hooks/useCollaboration";
import type { Announcement } from "@/types/collaboration";

/**
 * How far a notice has got, and the reader's own part in it.
 *
 * Two audiences in one strip, which is deliberate: the author wants to know
 * how many have read it, and the reader wants to say that they have. Splitting
 * them into separate components would mean the same row of data fetched twice
 * and two places to keep in step.
 */
export default function AnnouncementReach({
  announcement,
  canSeeNames,
  onOpenReceipts,
}: {
  announcement: Announcement;
  /** The author, or somebody managing the workplace. */
  canSeeNames: boolean;
  onOpenReceipts: () => void;
}) {
  const markSeen = useMarkAnnouncementSeen();
  const acknowledge = useAcknowledgeAnnouncement();

  const receipt = announcement.my_receipt;
  const seen = Boolean(receipt?.seen_at);
  const acknowledged = Boolean(receipt?.acknowledged_at);

  /**
   * Recorded on render, once.
   *
   * **Observed rather than asked for.** "Have you read this?" answered by a
   * button is an assertion; the fact that the page was open is an observation,
   * and the two are worth keeping apart. The guard on `seen` stops this firing
   * on every re-render — the server ignores repeats anyway, but a request per
   * keystroke elsewhere on the page would be silly.
   */
  useEffect(() => {
    if (!seen) markSeen.mutate(announcement.id);
    // Deliberately keyed on the id alone: this should fire when a different
    // notice is shown, not when the mutation object changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcement.id]);

  const { audience, seen: seenCount, acknowledged: ackCount } = announcement.metrics;
  const tracked = announcement.require_acknowledgement ? ackCount : seenCount;
  const share = audience > 0 ? tracked / audience : 0;

  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
        <Chip
          size="small"
          variant="outlined"
          icon={<VisibilityIcon />}
          label={`${seenCount} of ${audience} opened`}
        />
        {announcement.require_acknowledgement ? (
          <Chip
            size="small"
            variant="outlined"
            color={ackCount === audience && audience > 0 ? "success" : "warning"}
            icon={<CheckCircleIcon />}
            label={`${ackCount} confirmed`}
          />
        ) : null}

        <Box sx={{ flex: 1 }} />

        {/* The reader's own part. Only where the notice asks for it — a button
            on every notice is how the button stops meaning anything. */}
        {announcement.require_acknowledgement ? (
          acknowledged ? (
            <Chip size="small" color="success" icon={<CheckCircleIcon />} label="You confirmed" />
          ) : (
            <Button
              size="small"
              variant="contained"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate(announcement.id)}
            >
              I have read this
            </Button>
          )
        ) : null}

        {canSeeNames ? (
          <Button size="small" onClick={onOpenReceipts}>
            Who has read it
          </Button>
        ) : null}
      </Stack>

      {audience > 0 ? (
        <LinearProgress
          variant="determinate"
          value={Math.min(share, 1) * 100}
          color={share >= 1 ? "success" : "primary"}
          sx={{ height: 6, borderRadius: 3 }}
        />
      ) : null}
    </Stack>
  );
}
