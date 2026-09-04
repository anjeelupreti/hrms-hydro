"use client";

import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateText from "@/components/common/DateText";
import { useDecideSignature, useSignatures } from "@/hooks/useSignatures";
import { withCode } from "@/lib/people";

/**
 * Signatures waiting to be approved.
 *
 * **The second pair of eyes the whole apparatus depends on.** A memorandum
 * prints the marks of the people who recommended it, and that is only a record
 * if somebody other than the owner checked that the mark is theirs and legible.
 * The endpoint refuses self-approval outright; this is where everybody else's
 * gets looked at.
 *
 * Silent when the queue is empty — an HR page has enough on it without a card
 * saying nothing is waiting.
 */
export default function SignatureQueue() {
  const { data, isPending } = useSignatures("pending");
  const decide = useDecideSignature();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const rows = data?.results ?? [];
  if (isPending) return <Skeleton variant="rounded" height={120} />;
  if (rows.length === 0) return null;

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap" }} useFlexGap>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Signatures to approve
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Checked by somebody other than the person they belong to.
        </Typography>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Stack spacing={2} sx={{ mt: 1.5 }}>
        {rows.map((row) => (
          <Stack
            key={row.id}
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{
              alignItems: { sm: "center" },
              p: 2,
              borderRadius: 2,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            {/* On white, always: a signature scanned from a white sheet is
                invisible on a dark ground. */}
            <Box
              sx={{
                bgcolor: "#ffffff",
                borderRadius: 1,
                p: 1,
                minWidth: 180,
                display: "grid",
                placeItems: "center",
              }}
            >
              <Box
                component="img"
                src={row.image_url ?? ""}
                alt=""
                sx={{ maxHeight: 56, maxWidth: 170, objectFit: "contain" }}
              />
            </Box>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {withCode(row.employee_name, row.employee_code)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Uploaded <DateText value={row.created_at} withTime />
              </Typography>
              <TextField
                size="small"
                fullWidth
                placeholder="Reason, if you are turning it down"
                value={notes[row.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
                sx={{ mt: 1 }}
              />
            </Box>

            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                startIcon={<CheckIcon />}
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate(
                    { id: row.id, approved: true, note: notes[row.id] ?? "" },
                    { onError: (e) => setError(e.message) }
                  )
                }
              >
                Approve
              </Button>
              <Button
                size="small"
                color="error"
                startIcon={<CloseIcon />}
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate(
                    { id: row.id, approved: false, note: notes[row.id] ?? "" },
                    { onError: (e) => setError(e.message) }
                  )
                }
              >
                Reject
              </Button>
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
