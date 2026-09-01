"use client";

/**
 * How one person differs from the company's retirement scheme.
 *
 * **Most people have nothing here, and that is the design.** Absence of a row
 * means "follow the company" — requiring one per employee would turn switching
 * a scheme on into a data-entry project whose half-done state silently
 * under-deducts. A row exists only where somebody is genuinely an exception:
 * outside the fund, on a grandfathered rate, or saving into CIT.
 *
 * So this panel leads with *nothing*, and the actions read as adding an
 * exception rather than completing a form.
 */

import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/Delete";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { useCompanyProfile } from "@/hooks/useOrganization";
import {
  useDeleteSchemeEnrolment,
  useSaveSchemeEnrolment,
  useSchemeEnrolments,
} from "@/hooks/usePayroll";
import type { SchemeEnrolment } from "@/types/payroll";

/** CIT is the voluntary one, so it is the only one taking an amount. */
const isCit = (scheme: string) => scheme === "cit";

export default function SchemeEnrolmentPanel({ employeeId }: { employeeId: number }) {
  const { data: profile } = useCompanyProfile();
  const { data, isLoading } = useSchemeEnrolments(employeeId);
  const save = useSaveSchemeEnrolment();
  const remove = useDeleteSchemeEnrolment();

  const [adding, setAdding] = useState(false);
  const [scheme, setScheme] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState("");

  const rows = data?.results ?? [];
  const companyScheme = profile?.retirement_scheme ?? "";
  const offersCit = profile?.offers_cit ?? false;

  // Only schemes this company actually runs. Offering CIT to a company that
  // does not is a row that would be created and then ignored.
  const choices = [
    ...(companyScheme ? [{ value: companyScheme, label: companyScheme.toUpperCase() }] : []),
    ...(offersCit ? [{ value: "cit", label: "CIT" }] : []),
  ].filter((c) => !rows.some((r) => r.scheme === c.value));

  async function create() {
    setError("");
    try {
      await save.mutateAsync({
        employee: employeeId,
        scheme,
        ...(isCit(scheme) ? { monthly_amount: amount } : {}),
        ...(!isCit(scheme) && rate ? { employee_rate: rate } : {}),
      });
      setAdding(false);
      setScheme("");
      setAmount("");
      setRate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  async function toggle(row: SchemeEnrolment) {
    setError("");
    try {
      await save.mutateAsync({ id: row.id, is_active: !row.is_active });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  if (!companyScheme && !offersCit) {
    return (
      <Alert severity="info">
        This company has not chosen a retirement fund yet, so there is nothing to
        set per person. It is picked in company settings.
      </Alert>
    );
  }

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Fund exceptions
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Only needed where this person differs from the company.
          </Typography>
        </Box>
        {choices.length > 0 ? (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            Add
          </Button>
        ) : null}
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      {!isLoading && rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Following the company scheme
          {companyScheme ? ` (${companyScheme.toUpperCase()})` : ""}. Nothing to do
          unless they are an exception.
        </Typography>
      ) : null}

      <Stack spacing={1}>
        {rows.map((row) => (
          <Stack
            key={row.id}
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              py: 1,
              borderTop: "1px solid",
              borderColor: "divider",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {row.scheme_label}
                </Typography>
                {!row.is_active ? (
                  <Chip size="small" label="Opted out" />
                ) : null}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {isCit(row.scheme)
                  ? `${row.monthly_amount ?? "—"} per month`
                  : row.employee_rate
                    ? `${row.employee_rate}% of basic — instead of the statutory rate`
                    : "Statutory rate"}
              </Typography>
            </Box>

            {/* Opting out is a state change, never a delete: "outside the
                scheme" and "follows the company" are different answers, and
                only one of them stops contributions. */}
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={row.is_active}
                  onChange={() => toggle(row)}
                  disabled={save.isPending}
                />
              }
              label={<Typography variant="caption">In</Typography>}
            />

            <Tooltip title="Remove the exception — they follow the company again">
              <span>
                <IconButton size="small" onClick={() => remove.mutateAsync(row.id)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        ))}
      </Stack>

      <Dialog open={adding} onClose={() => setAdding(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add an exception</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              size="small"
              label="Scheme"
              value={scheme}
              onChange={(e) => setScheme(e.target.value)}
            >
              {choices.map((c) => (
                <MenuItem key={c.value} value={c.value}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>

            {isCit(scheme) ? (
              <TextField
                size="small"
                type="number"
                label="Amount per month"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                helperText="CIT is a chosen amount, not a percentage."
              />
            ) : scheme ? (
              <TextField
                size="small"
                type="number"
                label="Employee rate (optional)"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                helperText="Leave empty for the statutory rate. Set only for a grandfathered arrangement — the employer side still follows the statute."
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!scheme || (isCit(scheme) && !amount) || save.isPending}
            onClick={create}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
