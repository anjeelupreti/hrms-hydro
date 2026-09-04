"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DrawIcon from "@mui/icons-material/Draw";
import UploadIcon from "@mui/icons-material/Upload";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateText from "@/components/common/DateText";
import { useMySignatures, useUploadSignature, type Signature } from "@/hooks/useSignatures";

const TONE: Record<Signature["status"], "success" | "warning" | "error" | "default"> = {
  approved: "success",
  pending: "warning",
  rejected: "error",
  superseded: "default",
};

/**
 * Somebody's own signature: upload one, see whether it may be used yet.
 *
 * **The image is theirs and the decision is not.** They provide it — nobody
 * else should be drawing somebody's signature — and it is checked by whoever
 * manages people before it goes anywhere near a memorandum. That is the whole
 * reason the approval step exists: a printed memorandum carrying the marks of
 * the people who recommended it is only a record if those marks were verified.
 *
 * Old versions stay on the list rather than being replaced in place. A
 * memorandum signed last year was signed with last year's image, and quietly
 * swapping it would restate history.
 */
export default function SignatureCard() {
  const { data: signatures, isPending } = useMySignatures();
  const upload = useUploadSignature();
  const [error, setError] = useState<string | null>(null);

  const rows = signatures ?? [];
  const live = rows.find((row) => row.status === "approved") ?? null;
  const waiting = rows.find((row) => row.status === "pending") ?? null;
  const refused = rows.find((row) => row.status === "rejected") ?? null;

  function choose(file: File | null) {
    if (!file) return;
    setError(null);
    upload.mutate(file, { onError: (e) => setError(e.message) });
  }

  if (isPending) return <Skeleton variant="rounded" height={180} />;

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
        <DrawIcon fontSize="small" color="action" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Signature
        </Typography>
        {live ? <Chip size="small" color="success" icon={<CheckCircleIcon />} label="In use" /> : null}
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Applied automatically to memoranda you recommend or approve. Somebody in
        HR has to approve it before it is used.
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {live ? (
        <Box
          sx={{
            p: 2,
            mb: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            // White regardless of theme: a signature is ink on paper, and one
            // scanned on a white sheet disappears on a dark ground.
            bgcolor: "#ffffff",
          }}
        >
          <Box
            component="img"
            src={live.image_url ?? ""}
            alt="Your signature"
            sx={{ maxHeight: 72, maxWidth: "100%", objectFit: "contain", display: "block" }}
          />
        </Box>
      ) : null}

      {waiting ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Uploaded <DateText value={waiting.created_at} withTime /> — waiting for approval.
        </Alert>
      ) : null}

      {refused && !waiting && !live ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Your last signature was not approved.{refused.note ? ` ${refused.note}` : ""} Upload
          another.
        </Alert>
      ) : null}

      <Button
        component="label"
        variant={live ? "outlined" : "contained"}
        size="small"
        startIcon={<UploadIcon />}
        disabled={upload.isPending}
      >
        {live ? "Replace signature" : "Upload signature"}
        <Box
          component="input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => choose(e.target.files?.[0] ?? null)}
        />
      </Button>

      {rows.length > 1 ? (
        <Stack spacing={0.5} sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Earlier versions
          </Typography>
          {rows
            .filter((row) => row.status !== "approved")
            .map((row) => (
              <Stack key={row.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Chip size="small" color={TONE[row.status]} label={row.status} />
                <Typography variant="caption" color="text.secondary">
                  <DateText value={row.created_at} withTime />
                </Typography>
              </Stack>
            ))}
        </Stack>
      ) : null}
    </Box>
  );
}
