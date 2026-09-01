"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import { useSaveInvoice } from "@/hooks/useCrm";
import type { Invoice, InvoiceLineItem } from "@/types/crm";
import { ClientPicker } from "@/components/common/pickers";
import { todayIso } from "@/lib/format/period";

type EditLine = { description: string; quantity: string; unit_price: string };

function toEditLines(invoice?: Invoice | null): EditLine[] {
  if (!invoice || invoice.line_items.length === 0)
    return [{ description: "", quantity: "1", unit_price: "0" }];
  return invoice.line_items.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
  }));
}

export default function InvoiceFormDialog({
  invoice,
  onClose,
}: {
  invoice?: Invoice | null;
  onClose: () => void;
}) {
  const saveInvoice = useSaveInvoice();

  const [clientId, setClientId] = useState<number | "">(invoice?.client ?? "");
  const [issueDate, setIssueDate] = useState(invoice?.issue_date ?? todayIso());
  const [dueDate, setDueDate] = useState(invoice?.due_date ?? "");
  const [currency, setCurrency] = useState(invoice?.currency ?? "NPR");
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [lines, setLines] = useState<EditLine[]>(() => toEditLines(invoice));
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);

  function updateLine(i: number, patch: Partial<EditLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleSave() {
    setError(null);
    if (!clientId) {
      setError("Select a client.");
      return;
    }
    const line_items: InvoiceLineItem[] = lines
      .filter((l) => l.description.trim())
      .map((l) => ({ description: l.description, quantity: l.quantity || "0", unit_price: l.unit_price || "0" }));
    if (line_items.length === 0) {
      setError("Add at least one line item.");
      return;
    }
    try {
      await saveInvoice.mutateAsync({
        id: invoice?.id,
        values: {
          client: clientId,
          issue_date: issueDate,
          due_date: dueDate || null,
          currency,
          notes,
          line_items,
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{invoice ? `Edit ${invoice.number}` : "New invoice"}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2}>
          <ClientPicker value={clientId || null} onChange={(id) => setClientId(id ?? 0)} required />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <DateField label="Issue date" value={issueDate} onChange={setIssueDate} />
            <DateField label="Due date" value={dueDate} onChange={setDueDate} />
            <TextField label="Currency" sx={{ width: 110 }} value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </Stack>

          <Divider />
          <Typography variant="overline" color="text.secondary">
            Line items
          </Typography>
          {lines.map((line, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <TextField
                label="Description"
                size="small"
                sx={{ flex: 1 }}
                value={line.description}
                onChange={(e) => updateLine(i, { description: e.target.value })}
              />
              <TextField
                label="Qty"
                size="small"
                type="number"
                sx={{ width: 72 }}
                value={line.quantity}
                onChange={(e) => updateLine(i, { quantity: e.target.value })}
              />
              <TextField
                label="Unit price"
                size="small"
                type="number"
                sx={{ width: 110 }}
                value={line.unit_price}
                onChange={(e) => updateLine(i, { unit_price: e.target.value })}
              />
              <IconButton size="small" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1", unit_price: "0" }])}
            sx={{ alignSelf: "flex-start" }}
          >
            Add line
          </Button>

          <Box sx={{ textAlign: "right" }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Total: {currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Typography>
          </Box>

          <TextField label="Notes" fullWidth multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saveInvoice.isPending}>
          {invoice ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
