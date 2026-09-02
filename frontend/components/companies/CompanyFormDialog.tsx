"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import DateField from "@/components/common/DateField";
import { CompanyPicker } from "@/components/common/pickers";
import { useCreateCompany, useUpdateCompany } from "@/hooks/useCompanies";
import {
  COMPANY_KINDS,
  PROJECT_STAGES,
  type Company,
  type CompanyFormValues,
} from "@/types/companies";

/**
 * Create or edit one of the group's operating companies.
 *
 * **Three sections, because they are answered by three different people.** The
 * identity comes from whoever is setting the system up; the registration
 * numbers come from the company secretary; the project facts come from the
 * engineering side. Interleaving them makes a form that nobody can complete in
 * one sitting without leaving gaps in the middle.
 *
 * The project section is shown regardless of `kind` rather than only for an
 * SPV: a subsidiary can hold a licence too, and a form that hides fields based
 * on another field is one where somebody's data quietly has nowhere to go.
 */

const EMPTY: CompanyFormValues = {
  name: "",
  code: "",
  legal_name: "",
  kind: "spv",
  parent: null,
  registration_number: "",
  pan_vat_number: "",
  licence_number: "",
  established_on: "",
  project_stage: "na",
  installed_capacity_mw: "",
  river: "",
  address: "",
  district: "",
  province: "",
  phone: "",
  email: "",
  website: "",
  is_active: true,
  is_primary: false,
};

function fromCompany(company: Company): CompanyFormValues {
  return {
    name: company.name,
    code: company.code,
    legal_name: company.legal_name,
    kind: company.kind,
    parent: company.parent,
    registration_number: company.registration_number,
    pan_vat_number: company.pan_vat_number,
    licence_number: company.licence_number,
    established_on: company.established_on ?? "",
    project_stage: company.project_stage,
    installed_capacity_mw: company.installed_capacity_mw ?? "",
    river: company.river,
    address: company.address,
    district: company.district,
    province: company.province,
    phone: company.phone,
    email: company.email,
    website: company.website,
    is_active: company.is_active,
    is_primary: company.is_primary,
  };
}

export default function CompanyFormDialog({
  open,
  onClose,
  company,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` creates. A company to edit is passed whole — the list already has
   *  it, so refetching one row to open a form would be a request for nothing. */
  company: Company | null;
}) {
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const [values, setValues] = useState<CompanyFormValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  // Keyed on the dialog opening rather than on every render: editing a field
  // and having a background refetch reset it is the failure this avoids.
  useEffect(() => {
    if (!open) return;
    setValues(company ? fromCompany(company) : EMPTY);
    setError(null);
  }, [open, company]);

  function set<K extends keyof CompanyFormValues>(key: K, value: CompanyFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  const saving = create.isPending || update.isPending;

  async function save() {
    setError(null);
    try {
      if (company) {
        await update.mutateAsync({ id: company.id, values });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{company ? `Edit ${company.name}` : "Add a company"}</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField
              label="Name"
              fullWidth
              required
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              autoFocus
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Code"
              fullWidth
              required
              value={values.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              helperText="Short form used on payroll exports."
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Registered name"
              fullWidth
              value={values.legal_name}
              onChange={(e) => set("legal_name", e.target.value)}
              helperText="Only if it differs from the name people actually use."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Kind"
              fullWidth
              value={values.kind}
              onChange={(e) => set("kind", e.target.value as CompanyFormValues["kind"])}
            >
              {COMPANY_KINDS.map((k) => (
                <MenuItem key={k.value} value={k.value}>
                  {k.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {/* The company itself is excluded: a company cannot be its own
                parent, and the server refuses longer loops too. */}
            <CompanyPicker
              label="Parent company"
              value={values.parent}
              onChange={(id) => set("parent", id)}
              excludeIds={company ? [company.id] : undefined}
              helperText="Leave empty for the top of the group."
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Registration
        </Typography>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Registration number"
              fullWidth
              value={values.registration_number}
              onChange={(e) => set("registration_number", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="PAN / VAT"
              fullWidth
              value={values.pan_vat_number}
              onChange={(e) => set("pan_vat_number", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <DateField
              label="Established"
              value={values.established_on}
              onChange={(value) => set("established_on", value)}
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          The project
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Leave these empty for an entity that does not hold a licence.
        </Typography>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              select
              label="Stage"
              fullWidth
              value={values.project_stage}
              onChange={(e) =>
                set("project_stage", e.target.value as CompanyFormValues["project_stage"])
              }
            >
              {PROJECT_STAGES.map((stage) => (
                <MenuItem key={stage.value} value={stage.value}>
                  {stage.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Installed capacity (MW)"
              fullWidth
              value={values.installed_capacity_mw}
              onChange={(e) => set("installed_capacity_mw", e.target.value)}
              // Decimal, not integer: 4.5 and 25.5 MW plants are ordinary, and
              // rounding one to 5 misstates a licence.
              inputMode="decimal"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Licence number"
              fullWidth
              value={values.licence_number}
              onChange={(e) => set("licence_number", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="River"
              fullWidth
              value={values.river}
              onChange={(e) => set("river", e.target.value)}
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Where and how to reach it
        </Typography>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Address"
              fullWidth
              multiline
              minRows={2}
              value={values.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="District"
              fullWidth
              value={values.district}
              onChange={(e) => set("district", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Province"
              fullWidth
              value={values.province}
              onChange={(e) => set("province", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Phone"
              fullWidth
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Email"
              type="email"
              fullWidth
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Website"
              fullWidth
              value={values.website}
              onChange={(e) => set("website", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            {/* Deactivating is what happens to a company that has been wound
                up. It keeps the employment history and takes the company out of
                every picker, which deleting cannot do while anybody is on its
                payroll. */}
            <FormControlLabel
              control={
                <Switch
                  checked={values.is_active}
                  onChange={(e) => set("is_active", e.target.checked)}
                />
              }
              label="Active"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              An inactive company keeps its records and stops appearing in pickers.
            </Typography>
          </Grid>

          <Grid size={{ xs: 12 }}>
            {/* Exactly one company carries this, and the server enforces it
                twice — a message on the form, and a database constraint behind
                it, because a check-then-write in Python cannot stop two saves
                racing each other. */}
            <FormControlLabel
              control={
                <Switch
                  checked={values.is_primary}
                  onChange={(e) => set("is_primary", e.target.checked)}
                />
              }
              label="Payroll runs through this company"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              One entity files the group&apos;s payroll — one bank file, one PAN.
              Staff still belong to whichever company employs them. Turning this
              on where another company already has it is refused, and names the
              one to clear first.
            </Typography>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={saving || !values.name.trim() || !values.code.trim()}
        >
          {company ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
