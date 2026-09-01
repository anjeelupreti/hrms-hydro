"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import {
  batchDownloadUrl,
  useAcknowledgeBatch,
  useBuildPayments,
  useEmailBatch,
  useMarkBatchSent,
  useRunPayments,
  type BatchStatus,
  type PaymentBatch,
} from "@/hooks/useDisbursement";
import { CURRENCY_PREFIX, money } from "@/lib/format/money";

/**
 * Paying the run — one instruction per bank, and who is not in any of them.
 *
 * The batch workflow, in place of a flat `bank-file` spreadsheet and a
 * `mark-all-paid` button. Two things that route cannot do:
 *
 * **It cannot show who could not be paid.** `build_payment_batches` records an
 * *exclusion* per payslip it cannot pay — no account number, no bank — with the
 * comment that this is "returned alongside, not buried behind a second request:
 * whoever builds the file needs to see who is *not* in it before sending". A
 * flat sheet emits those rows with blank account numbers and the bank silently
 * drops them, so somebody finds out they were not paid when they check their
 * account. That is why exclusions sit **above** the batches here, in warning,
 * before anything can be downloaded.
 *
 * **It collapsed sent into paid.** The backend keeps them apart deliberately:
 * *sent* means handed over, *acknowledged* means the bank confirmed, and only
 * acknowledgement flips a payslip to paid. `mark-all-paid` asserts the end state
 * directly. Here the two are separate buttons, and acknowledging demands the
 * bank's reference — without one a payslip saying "paid" cannot be reconciled
 * against a statement, which is the only reason to record it.
 *
 * **Download does not change the status**, matching the endpoint: generating a
 * file to check it is a normal thing to do, and treating that as "the money has
 * gone" would make the status a lie the first time anybody looked.
 */

const STATUS_LABEL: Record<BatchStatus, string> = {
  draft: "Draft",
  sent: "Sent to bank",
  acknowledged: "Acknowledged",
  failed: "Failed",
};

function StatusChip({ status }: { status: BatchStatus }) {
  const colour =
    status === "acknowledged"
      ? "success"
      : status === "failed"
        ? "error"
        : status === "sent"
          ? "info"
          : "default";
  return <Chip size="small" label={STATUS_LABEL[status]} color={colour} variant={status === "draft" ? "outlined" : "filled"} />;
}

function AcknowledgeDialog({
  batch,
  runId,
  onClose,
}: {
  batch: PaymentBatch;
  runId: number;
  onClose: () => void;
}) {
  const acknowledge = useAcknowledgeBatch(runId);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Acknowledge — {batch.bank_name}</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This marks {batch.payslip_count} payslip{batch.payslip_count === 1 ? "" : "s"} as paid. Only
          do it once the bank has confirmed the transfer.
        </Typography>
        <TextField
          label="Bank reference"
          size="small"
          fullWidth
          autoFocus
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          helperText="Required — without it the payment cannot be matched to a statement."
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!reference.trim() || acknowledge.isPending}
          onClick={() =>
            acknowledge.mutate(
              { batchId: batch.id, reference: reference.trim() },
              { onSuccess: onClose, onError: (err: Error) => setError(err.message) },
            )
          }
        >
          Mark paid
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EmailDialog({
  batch,
  runId,
  format,
  onClose,
}: {
  batch: PaymentBatch;
  runId: number;
  format: string;
  onClose: () => void;
}) {
  const send = useEmailBatch(runId);
  const [recipients, setRecipients] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Email the instruction — {batch.bank_name}</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sends the file to the bank and marks the batch sent — but only if the
          send succeeds. It stays a draft if the mail bounces.
        </Typography>
        <Stack spacing={2}>
          <TextField
            label="Recipients"
            size="small"
            fullWidth
            autoFocus
            placeholder="payments@bank.com, ops@bank.com"
            value={recipients}
            onChange={(event) => setRecipients(event.target.value)}
            helperText="Comma-separated."
          />
          <TextField
            label="Message"
            size="small"
            fullWidth
            multiline
            minRows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!recipients.trim() || send.isPending}
          onClick={() =>
            send.mutate(
              { batchId: batch.id, recipients: recipients.trim(), format, message },
              { onSuccess: onClose, onError: (err: Error) => setError(err.message) },
            )
          }
        >
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function DisbursementPanel({ runId }: { runId: number }) {
  const { data, isLoading } = useRunPayments(runId);
  const build = useBuildPayments(runId);
  const markSent = useMarkBatchSent(runId);

  const [format, setFormat] = useState("generic");
  const [acknowledging, setAcknowledging] = useState<PaymentBatch | null>(null);
  const [emailing, setEmailing] = useState<PaymentBatch | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  if (isLoading) return <Skeleton variant="rounded" height={260} sx={{ mt: 2 }} />;

  const batches = data?.batches ?? [];
  const excluded = data?.excluded ?? [];
  const formats = data?.formats ?? [{ key: "generic", label: "Generic CSV" }];
  const total = batches.reduce((sum, batch) => sum + Number(batch.total_amount || 0), 0);

  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.25 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Paying this run
          </Typography>
          <Button
            size="small"
            variant={batches.length === 0 ? "contained" : "text"}
            disabled={build.isPending}
            onClick={() => {
              setBuildError(null);
              build.mutate(undefined, { onError: (err: Error) => setBuildError(err.message) });
            }}
          >
            {batches.length === 0 ? "Build instructions" : "Rebuild"}
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {batches.length === 0
            ? "Group this run's payslips into one instruction per bank."
            : `${batches.length} bank${batches.length === 1 ? "" : "s"} · ${CURRENCY_PREFIX}${money(total)} across ${batches.reduce((sum, b) => sum + b.payslip_count, 0)} payslips.`}
        </Typography>

        {buildError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {buildError}
          </Alert>
        ) : null}

        {/* Exclusions first. Somebody who cannot be paid is the finding; the
            batches are the routine part. Putting this under the tables would
            mean scrolling past the money to reach the people missing from it. */}
        {excluded.length > 0 ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
              {excluded.length} {excluded.length === 1 ? "person is" : "people are"} not in any
              instruction and will not be paid
            </Typography>
            <Stack spacing={0.25}>
              {excluded.map((row) => (
                <Typography key={row.id} variant="caption" sx={{ display: "block" }}>
                  <strong>{row.employee_name}</strong> ({row.employee_code}) — {row.reason}
                </Typography>
              ))}
            </Stack>
          </Alert>
        ) : null}

        {batches.length === 0 ? null : (
          <>
            <TextField
              select
              size="small"
              label="Bank file format"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
              sx={{ mb: 2, minWidth: 220 }}
            >
              {formats.map((option) => (
                <MenuItem key={option.key} value={option.key}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <Stack spacing={1.25}>
              {batches.map((batch) => (
                <Box
                  key={batch.id}
                  sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, p: 1.5 }}
                >
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
                  >
                    <Box>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {batch.bank_name}
                        </Typography>
                        <StatusChip status={batch.status} />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {batch.payslip_count} payslip{batch.payslip_count === 1 ? "" : "s"} ·{" "}
                        {CURRENCY_PREFIX}
                        {money(batch.total_amount)}
                        {batch.bank_reference ? ` · ref ${batch.bank_reference}` : ""}
                      </Typography>
                      {batch.failure_reason ? (
                        <Typography variant="caption" sx={{ display: "block", color: "var(--hrms-status-danger-fg)" }}>
                          {batch.failure_reason}
                        </Typography>
                      ) : null}
                    </Box>

                    <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, flexWrap: "wrap" }}>
                      {/* A plain link: the endpoint returns the file and does
                          not change the batch's state. */}
                      <Button
                        size="small"
                        component="a"
                        href={batchDownloadUrl(batch.id, format)}
                        target="_blank"
                        rel="noopener"
                      >
                        Download
                      </Button>
                      {batch.status === "draft" ? (
                        <>
                          <Button size="small" onClick={() => setEmailing(batch)}>
                            Email bank
                          </Button>
                          <Button
                            size="small"
                            disabled={markSent.isPending}
                            onClick={() => markSent.mutate(batch.id)}
                          >
                            Mark sent
                          </Button>
                        </>
                      ) : null}
                      {batch.status === "sent" ? (
                        <Button size="small" variant="contained" onClick={() => setAcknowledging(batch)}>
                          Acknowledge
                        </Button>
                      ) : null}
                    </Stack>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </>
        )}

        {acknowledging ? (
          <AcknowledgeDialog batch={acknowledging} runId={runId} onClose={() => setAcknowledging(null)} />
        ) : null}
        {emailing ? (
          <EmailDialog batch={emailing} runId={runId} format={format} onClose={() => setEmailing(null)} />
        ) : null}
      </CardContent>
    </Card>
  );
}
