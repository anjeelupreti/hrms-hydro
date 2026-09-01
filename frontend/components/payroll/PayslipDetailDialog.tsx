"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import LockIcon from "@mui/icons-material/Lock";
import { money } from "@/lib/format/money";
import Amount from "@/components/common/Amount";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SaveIcon from "@mui/icons-material/Save";
import Alert from "@mui/material/Alert";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState, type ReactNode } from "react";

import {
  useEditPayslipLineItems,
  useFinalizePayslip,
  useRecomputePayslip,
} from "@/hooks/usePayroll";
import type { Payslip } from "@/types/payroll";

type EditableLine = {
  component_code: string;
  component_name: string;
  component_type: "earning" | "deduction";
  amount: string;
};


function toEditable(payslip: Payslip): EditableLine[] {
  return payslip.line_items.map((li) => ({
    component_code: li.component_code,
    component_name: li.component_name,
    component_type: li.component_type,
    amount: li.amount,
  }));
}

export default function PayslipDetailDialog({
  payslip,
  canManage,
  onClose,
}: {
  payslip: Payslip;
  canManage: boolean;
  onClose: () => void;
}) {
  const isDraft = payslip.status === "draft";
  const editable = canManage && isDraft;

  const [lines, setLines] = useState<EditableLine[]>(() => toEditable(payslip));
  const [error, setError] = useState<string | null>(null);

  const editLines = useEditPayslipLineItems();
  const recompute = useRecomputePayslip();
  const finalize = useFinalizePayslip();
  const busy = editLines.isPending || recompute.isPending || finalize.isPending;

  const gross = lines
    .filter((l) => l.component_type === "earning")
    .reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const deductions = lines
    .filter((l) => l.component_type === "deduction")
    .reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const net = gross - deductions;

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }
  function addLine() {
    setLines((prev) => [
      ...prev,
      { component_code: "", component_name: "", component_type: "earning", amount: "0" },
    ]);
  }

  async function runMutation(fn: () => Promise<Payslip>, resetLinesFrom?: boolean) {
    setError(null);
    try {
      const updated = await fn();
      if (resetLinesFrom) setLines(toEditable(updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const handleSave = () =>
    runMutation(() =>
      editLines.mutateAsync({
        id: payslip.id,
        line_items: lines.map((l) => ({
          component_code: l.component_code,
          component_name: l.component_name,
          component_type: l.component_type,
          amount: l.amount === "" ? "0" : l.amount,
        })),
      })
    );
  const handleReset = () => runMutation(() => recompute.mutateAsync(payslip.id), true);
  const handleFinalize = async () => {
    // Persist any pending edits first, then lock — so the finalized
    // figures are exactly what HR sees on screen.
    await handleSave();
    await runMutation(async () => {
      const r = await finalize.mutateAsync(payslip.id);
      onClose();
      return r;
    });
  };

  const statusColor = { draft: "default", finalized: "info", paid: "success" } as const;

  return (
    // `md`, not `sm`. The line items, the attendance band and the totals were
    // competing for 600px, which wrapped two-word component names onto three
    // lines and pushed the figures against the edge.
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" noWrap>
              {payslip.employee_name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {payslip.employee_code} · {payslip.period_label}
              {payslip.period_days
                ? ` · ${payslip.payable_days}/${payslip.period_days} days`
                : ""}
            </Typography>
          </Box>
          <Chip size="small" label={payslip.status} color={statusColor[payslip.status]} />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {editable ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            These figures are auto-computed from the salary structure. Adjust or add one-off lines,
            then <strong>Finalize</strong> to make the payslip ready — it can only be made ready
            once and cannot be edited afterwards.
          </Alert>
        ) : (
          !isDraft && (
            <Alert severity="success" icon={<LockIcon fontSize="inherit" />} sx={{ mb: 2 }}>
              This payslip is finalized and locked — its figures can no longer be changed.
            </Alert>
          )
        )}

        {/* ── The month, as a reflection ───────────────────────────────
            None of this prices anything. Pay moves on absence, unpaid leave
            and half days; hours are here so somebody can see their own month
            beside the money it produced. Snapshotted when the payslip was
            computed, so a regularisation approved next week cannot silently
            change the figures shown against a payslip already paid. */}
        <Stack
          direction="row"
          spacing={0}
          sx={{
            mb: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            overflow: "hidden",
            flexWrap: "wrap",
          }}
        >
          {[
            { label: "Days attended", value: String(payslip.days_attended ?? 0) },
            { label: "Hours worked", value: `${payslip.hours_worked ?? 0}` },
            {
              label: "Average per day",
              value: `${payslip.average_hours ?? "0.00"} h`,
              hint: "Across days attended, not across the month",
            },
            {
              label: "Days paid",
              value: `${payslip.payable_days}/${payslip.period_days}`,
              hint: "What the money was prorated over",
            },
          ].map((cell, i) => (
            <Box
              key={cell.label}
              sx={{
                flex: "1 1 140px",
                px: 2,
                py: 1.5,
                borderLeft: i === 0 ? "none" : "1px solid",
                borderColor: "divider",
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {cell.label}
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
                {cell.value}
              </Typography>
              {cell.hint ? (
                <Typography variant="caption" color="text.disabled">
                  {cell.hint}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Stack>

        {/* The absence sum, written out.
            The band above says how many days were paid; it never said what a
            day was worth or how the deduction was reached, so a smaller number
            than last month had no explanation on the page. This is the
            arithmetic the engine actually did, in the order it did it, using
            the basis snapshotted onto this payslip rather than whatever the
            setting says today. Shown only when something was deducted — a
            worked line of "0 × 1,612.90 = 0" is noise on every other payslip. */}
        {Number(payslip.unpaid_days ?? 0) > 0 ? (
          <Box
            sx={{
              mb: 2,
              p: 2,
              borderRadius: 2,
              border: "1px solid",
              borderColor: "warning.main",
              bgcolor: (t) => alpha(t.palette.warning.main, 0.06),
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              Absence deduction
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              {payslip.pay_basis === "working_days"
                ? `Valued on working days — one day is a ${payslip.basis_days}th of the month's reducible pay.`
                : `Valued on the calendar month — one day is a ${payslip.basis_days}th of the month's reducible pay.`}
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "baseline", flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}
              useFlexGap
            >
              <Typography variant="body2" color="text.secondary">
                <Amount personal value={payslip.day_value ?? "0"} /> per day
              </Typography>
              <Typography variant="body2" color="text.secondary">×</Typography>
              <Typography variant="body2" color="text.secondary">
                {payslip.unpaid_days} day{Number(payslip.unpaid_days) === 1 ? "" : "s"} not paid
              </Typography>
              <Typography variant="body2" color="text.secondary">=</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                <Amount personal value={payslip.absence_deduction ?? "0"} />
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>
              Taken off the components marked as reducible by absence. Anything calculated as a
              percentage of those shrinks with them, and shows in its own row below. Weekends and
              public holidays are never charged.
            </Typography>
          </Box>
        ) : null}

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Component</TableCell>
              <TableCell width={120}>Type</TableCell>
              <TableCell align="right" width={130}>
                Amount
              </TableCell>
              {editable && <TableCell width={44} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line, index) => (
              <TableRow key={index}>
                <TableCell>
                  {editable ? (
                    <TextField
                      variant="standard"
                      fullWidth
                      placeholder="Line name"
                      value={line.component_name}
                      onChange={(e) => updateLine(index, { component_name: e.target.value })}
                    />
                  ) : (
                    line.component_name
                  )}
                </TableCell>
                <TableCell>
                  {editable ? (
                    <TextField
                      select
                      variant="standard"
                      fullWidth
                      value={line.component_type}
                      onChange={(e) =>
                        updateLine(index, {
                          component_type: e.target.value as EditableLine["component_type"],
                        })
                      }
                    >
                      <MenuItem value="earning">Earning</MenuItem>
                      <MenuItem value="deduction">Deduction</MenuItem>
                    </TextField>
                  ) : (
                    <Chip
                      size="small"
                      variant="outlined"
                      color={line.component_type === "earning" ? "success" : "warning"}
                      label={line.component_type}
                    />
                  )}
                </TableCell>
                <TableCell align="right">
                  {editable ? (
                    <TextField
                      variant="standard"
                      type="number"
                      value={line.amount}
                      onChange={(e) => updateLine(index, { amount: e.target.value })}
                      slotProps={{ htmlInput: { style: { textAlign: "right" } } }}
                    />
                  ) : (
                    <Amount personal value={money(Number(line.amount))} />
                  )}
                </TableCell>
                {editable && (
                  <TableCell>
                    <IconButton size="small" onClick={() => removeLine(index)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {editable && (
          <Button size="small" startIcon={<AddIcon />} onClick={addLine} sx={{ mt: 1 }}>
            Add adjustment line
          </Button>
        )}

        <Divider sx={{ my: 2 }} />

        <Stack spacing={0.5} sx={{ maxWidth: 280, ml: "auto" }}>
          <Row label="Gross earnings" value={<Amount personal value={money(gross)} />} />
          <Row label="Total deductions" value={<Amount personal value={money(deductions)} prefix="- " />} />
          <Row label="Net pay" value={<Amount personal value={money(net)} />} bold />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button
          startIcon={<DownloadIcon />}
          component="a"
          href={`/api/proxy/payroll/payslips/${payslip.id}/download`}
          target="_blank"
        >
          PDF
        </Button>
        <Box sx={{ flex: 1 }} />
        {editable && (
          <>
            <Button startIcon={<RestartAltIcon />} onClick={handleReset} disabled={busy}>
              Reset to computed
            </Button>
            <Button startIcon={<SaveIcon />} onClick={handleSave} disabled={busy}>
              Save
            </Button>
            <Button
              variant="contained"
              startIcon={<LockIcon />}
              onClick={handleFinalize}
              disabled={busy}
            >
              Finalize
            </Button>
          </>
        )}
        {!editable && <Button onClick={onClose}>Close</Button>}
      </DialogActions>
    </Dialog>
  );
}

function Row({ label, value, bold }: { label: string; value: ReactNode; bold?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between" }}>
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: bold ? 700 : 400 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 500 }}>
        {value}
      </Typography>
    </Stack>
  );
}
