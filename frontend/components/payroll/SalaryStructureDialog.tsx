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
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateText from "@/components/common/DateText";
import DateField from "@/components/common/DateField";
import { useCreateSalaryStructure, useSalaryComponents, useSalaryStructures } from "@/hooks/usePayroll";
import { useSalaryTemplates } from "@/hooks/useSalaryTemplates";

type Props = {
  open: boolean;
  onClose: () => void;
  employeeId: number | null;
  employeeName: string;
};

type Row = { component: number | ""; amount: string };

export default function SalaryStructureDialog({ open, onClose, employeeId, employeeName }: Props) {
  const { data: components } = useSalaryComponents();
  const { data: structures } = useSalaryStructures(employeeId);
  const { data: templates } = useSalaryTemplates();
  const createStructure = useCreateSalaryStructure();

  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([{ component: "", amount: "" }]);
  const [templateId, setTemplateId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  /**
   * Fill the rows from a template, rather than applying it.
   *
   * The bulk action on Payroll → Salary structures stamps a template onto
   * everybody who has none, which is the setting-up case. This is the other
   * one: a single person, usually just hired, on the standard structure for
   * their grade but at a basic that was negotiated. So the template lands in
   * the form as a starting point and is editable before it is saved — copying
   * it exactly is what happens if nothing is changed.
   *
   * Lines that compute themselves come across with no amount: a percentage or
   * a slab has nothing to type, and pre-filling a number would invent one.
   */
  function fillFromTemplate(id: number) {
    setTemplateId(id);
    const template = templates?.find((t) => t.id === id);
    if (!template) return;
    setRows(
      template.lines.length > 0
        ? template.lines.map((line) => ({ component: line.component, amount: line.amount ?? "" }))
        : [{ component: "", amount: "" }],
    );
  }

  function addRow() {
    setRows([...rows, { component: "", amount: "" }]);
  }

  function updateRow(index: number, patch: Partial<Row>) {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setRows(rows.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!employeeId) return;
    setError(null);
    const assignments = rows
      .filter((row) => row.component !== "")
      .map((row) => ({ component: row.component as number, amount: row.amount || null }));
    if (assignments.length === 0) {
      setError("Add at least one component.");
      return;
    }
    try {
      await createStructure.mutateAsync({ employee: employeeId, effective_from: effectiveFrom, notes, assignments });
      setRows([{ component: "", amount: "" }]);
      setEffectiveFrom("");
      setNotes("");
      setTemplateId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Salary Structure — {employeeName}</DialogTitle>
      <DialogContent>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          History
        </Typography>
        {structures && structures.results.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No salary structure assigned yet.
          </Typography>
        )}
        <Stack spacing={1} sx={{ mb: 3 }}>
          {structures?.results.map((structure) => (
            <Box key={structure.id} sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Effective <DateText value={structure.effective_from} />
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 0.5, flexWrap: "wrap" }}>
                {structure.assignments.map((a) => (
                  <Typography key={a.id} variant="caption" color="text.secondary">
                    {a.component_name}
                    {a.amount ? `: ${a.amount}` : ""}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>

        <Divider sx={{ mb: 2 }} />
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          New version
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          A change here creates a new effective-dated version — past payroll runs keep using whatever was active
          at the time.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2}>
          {templates && templates.length > 0 && (
            <>
              <TextField
                select
                label="Start from a template"
                value={templateId}
                onChange={(e) => fillFromTemplate(Number(e.target.value))}
                fullWidth
                helperText="Fills the components below. Adjust them before saving — nothing is applied yet."
              >
                {templates.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name}
                    {t.is_default ? " (default)" : ""}
                  </MenuItem>
                ))}
              </TextField>
              {templateId !== "" && (
                <Alert severity="info">
                  Copied from the template. Components that compute themselves — a percentage of
                  basic, or a tax slab — are left blank on purpose and will still be calculated
                  every run.
                </Alert>
              )}
            </>
          )}

          <DateField
            label="Effective from"
            value={effectiveFrom}
            onChange={setEffectiveFrom}
            fullWidth={false}
          />
          <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth />

          {rows.map((row, index) => (
            <Stack direction="row" spacing={1} key={index} sx={{ alignItems: "center" }}>
              <TextField
                select
                label="Component"
                fullWidth
                value={row.component}
                onChange={(e) => updateRow(index, { component: Number(e.target.value) })}
              >
                {components?.results.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Amount / Rate"
                sx={{ minWidth: 140 }}
                value={row.amount}
                onChange={(e) => updateRow(index, { amount: e.target.value })}
              />
              <IconButton onClick={() => removeRow(index)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Button startIcon={<AddIcon />} onClick={addRow} sx={{ alignSelf: "flex-start" }}>
            Add component
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={handleSave} disabled={createStructure.isPending}>
          Save new version
        </Button>
      </DialogActions>
    </Dialog>
  );
}
