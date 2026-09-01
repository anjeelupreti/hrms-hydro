"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import { useCreateDeal, useUpdateDeal } from "@/hooks/useCrm";
import type { Deal, DealStage } from "@/types/crm";
import { ClientPicker, EmployeePicker } from "@/components/common/pickers";

const STAGES: { value: DealStage; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export default function DealFormDialog({
  open,
  onClose,
  deal,
  defaultClientId,
}: {
  open: boolean;
  onClose: () => void;
  deal?: Deal | null;
  defaultClientId?: number;
}) {
  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal();

  const [clientId, setClientId] = useState<number | "">(deal?.client ?? defaultClientId ?? "");
  const [title, setTitle] = useState(deal?.title ?? "");
  const [value, setValue] = useState(deal?.value ?? "0");
  const [stage, setStage] = useState<DealStage>(deal?.stage ?? "lead");
  const [owner, setOwner] = useState<number | "">(deal?.owner ?? "");
  const [closeDate, setCloseDate] = useState(deal?.expected_close_date ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!clientId) {
      setError("Select a client.");
      return;
    }
    const values = {
      client: clientId,
      title,
      stage,
      value,
      expected_close_date: closeDate || null,
      owner: owner === "" ? null : owner,
    };
    try {
      if (deal) await updateDeal.mutateAsync({ id: deal.id, values });
      else await createDeal.mutateAsync(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{deal ? "Edit deal" : "New deal"}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <ClientPicker value={clientId || null} onChange={(id) => setClientId(id ?? 0)} required />
          <TextField label="Title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextField label="Value" type="number" fullWidth value={value} onChange={(e) => setValue(e.target.value)} />
          <TextField select label="Stage" fullWidth value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
            {STAGES.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <EmployeePicker
            label="Owner"
            value={owner === "" ? null : owner}
            onChange={(id) => setOwner(id ?? "")}
            helperText="Leave empty for unassigned."
          />
          <DateField
            label="Expected close date"
            value={closeDate ?? ""}
            onChange={setCloseDate}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={createDeal.isPending || updateDeal.isPending}>
          {deal ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
