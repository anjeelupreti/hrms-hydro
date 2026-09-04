"use client";

import BadgeIcon from "@mui/icons-material/Badge";
import CakeIcon from "@mui/icons-material/Cake";
import EmailIcon from "@mui/icons-material/Email";
import EventIcon from "@mui/icons-material/Event";
import PersonIcon from "@mui/icons-material/Person";
import PhoneIcon from "@mui/icons-material/Phone";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import InputAdornment from "@mui/material/InputAdornment";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";


import {
  useCreateEmployee,
  useEmployeeDetail,
  useEmployeeLogs,
  useUpdateEmployee,
} from "@/hooks/useEmployees";
import { BLOOD_GROUPS } from "@/types/employees";
import type {
  EmployeeDetail,
  EmployeeFormValues,
  EmployeeLogEntry,
  MaritalStatus,
} from "@/types/employees";
import DateField from "@/components/common/DateField";
import ImageUpload from "@/components/common/ImageUpload";
import {
  CompanyPicker,
  DepartmentPicker,
  DesignationPicker,
  EmployeePicker,
} from "@/components/common/pickers";
import SecondaryCompanyField from "@/components/companies/SecondaryCompanyField";
import { useCorporatePosts, useCorporateRoles } from "@/hooks/useEmployeeRecords";

const FIELD_LABELS: Record<string, string> = {
  employment_status: "Status",
  department: "Department",
  designation: "Designation",
  manager: "Manager",
  supervisor_ids: "Supervisors",
};

/**
 * The statuses somebody may be *set* to by hand.
 *
 * **`suspended` is deliberately absent.** It is derived from a `Suspension`
 * record — the interval, the reason and the account lock all move together —
 * so offering it here would let a dropdown put somebody on the roster as
 * suspended with no record saying since when, and still able to sign in.
 * Suspending is done from the Conduct tab.
 *
 * The reverse matters more: editing a suspended person's phone number must not
 * quietly clear their suspension. See how the field is rendered below.
 */
const EMPLOYMENT_STATUSES: { value: EmployeeFormValues["employment_status"]; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On Leave" },
  { value: "resigned", label: "Resigned" },
  { value: "terminated", label: "Terminated" },
];

//: Salary / current / savings, matching `Employee.BankAccountType`. A salary
//: account is a distinct product in Nepal, not a label, which is why the bank
//: refuses an instruction that names the wrong one.
const BANK_ACCOUNT_TYPES: { value: EmployeeFormValues["bank_account_type"]; label: string }[] = [
  { value: "salary", label: "Salary" },
  { value: "current", label: "Current" },
  { value: "savings", label: "Savings" },
];

//: Matches `Employee.MaritalStatus`. Not a demographic nicety — the married
//: tax band in Nepal is wider than the individual one, so payroll reads this.
const MARITAL_STATUSES: { value: MaritalStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
];

const GENDERS: { value: EmployeeFormValues["gender"]; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

function buildInitialValues(employee: EmployeeDetail | null): EmployeeFormValues {
  if (!employee) {
    return {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      date_of_birth: "",
      gender: "",
      date_joined: "",
      probation_end_date: "",
      employment_status: "active",
      department: null,
      designation: null,
      manager: null,
      supervisor_ids: [],
      primary_company: null,
      secondary_companies: [],
      corporate_post: null,
      corporate_role: null,
      blood_group: "",
      permanent_address: "",
      temporary_address: "",
      office_phone: "",
      office_email: "",
      personal_phone: "",
      personal_email: "",
      bank_name: "",
      bank_branch: "",
      bank_account_name: "",
      bank_account_number: "",
      bank_account_type: "",
      legal_first_name: "",
      legal_middle_name: "",
      legal_last_name: "",
      marital_status: "",
      citizenship_number: "",
      passport_number: "",
      passport_expiry: "",
      pan_number: "",
      ssf_number: "",
      pf_number: "",
      cit_number: "",
    };
  }
  return {
    first_name: employee.first_name,
    last_name: employee.last_name,
    email: employee.email,
    phone: employee.phone,
    date_of_birth: employee.date_of_birth ?? "",
    gender: employee.gender,
    date_joined: employee.date_joined,
    probation_end_date: employee.probation_end_date ?? "",
    employment_status: employee.employment_status,
    department: employee.department,
    designation: employee.designation,
    manager: employee.manager,
    // Ordered, so the seed has to preserve the order the server sent.
    supervisor_ids: (employee.supervisors ?? []).map((s) => s.id),
    primary_company: employee.primary_company ?? null,
    secondary_companies: employee.secondary_companies ?? [],
    corporate_post: employee.corporate_post ?? null,
    corporate_role: employee.corporate_role ?? null,
    blood_group: employee.blood_group ?? "",
    permanent_address: employee.permanent_address ?? "",
    temporary_address: employee.temporary_address ?? "",
    office_phone: employee.office_phone ?? "",
    office_email: employee.office_email ?? "",
    personal_phone: employee.personal_phone ?? "",
    personal_email: employee.personal_email ?? "",
    // Absent rather than empty when the caller may not see them: the serializer
    // strips the whole sensitive group in `to_representation`, so `?? ""` here
    // would turn "you cannot see this" into "this is blank" and a save would
    // wipe the record. The section is hidden in that case — see `maySeeBank`.
    bank_name: employee.bank_name ?? "",
    bank_branch: employee.bank_branch ?? "",
    bank_account_name: employee.bank_account_name ?? "",
    // Deliberately not prefilled. The server masks this even for HR — it
    // serves `****6789` — so seeding the input from the record and saving
    // would write the mask back *as* the account number and destroy the real
    // one. Blank means "leave it alone"; the masked value is shown as helper
    // text so somebody can still see which account is on file.
    bank_account_number: "",
    bank_account_type: employee.bank_account_type ?? "",
    // Same "absent means you may not see it" rule as the bank block above —
    // the section is hidden in that case, so `?? ""` never reaches a save.
    //
    // The two scans are deliberately absent here. They are `File | undefined`
    // on the form and the record holds a URL: seeding them from the record
    // would post a URL string into an `ImageField` on every unrelated save.
    legal_first_name: employee.legal_first_name ?? "",
    legal_middle_name: employee.legal_middle_name ?? "",
    legal_last_name: employee.legal_last_name ?? "",
    marital_status: (employee.marital_status as MaritalStatus | undefined) ?? "",
    citizenship_number: employee.citizenship_number ?? "",
    passport_number: employee.passport_number ?? "",
    passport_expiry: employee.passport_expiry ?? "",
    pan_number: employee.pan_number ?? "",
    ssf_number: employee.ssf_number ?? "",
    pf_number: employee.pf_number ?? "",
    cit_number: employee.cit_number ?? "",
  };
}

type Props = {
  open: boolean;
  onClose: () => void;
  employeeId?: number | null;
};

export default function EmployeeFormDialog({
  open,
  onClose,
  employeeId = null,
}: Props) {
  const isEditing = employeeId !== null;
  const { data: employee, isLoading: loadingDetail } = useEmployeeDetail(
    open ? employeeId : null
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEditing ? "Edit Employee" : "Add Employee"}</DialogTitle>
      {isEditing && loadingDetail ? (
        <DialogContent sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <EmployeeForm
          key={employeeId ?? "new"}
          employeeId={employeeId}
          employee={employee ?? null}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function EmployeeForm({
  employeeId,
  employee,
  onClose,
}: {
  employeeId: number | null;
  employee: EmployeeDetail | null;
  onClose: () => void;
}) {
  const isEditing = employeeId !== null;
  const [values, setValues] = useState<EmployeeFormValues>(() => buildInitialValues(employee));
  // The two lookups behind post and role. Small enough to load whole rather
  // than search — a company has a dozen posts, not a thousand.
  // Derived from the record rather than from the form's own value, which an
  // operator could have already changed.
  const isSuspended = employee?.employment_status === "suspended";
  const { data: posts } = useCorporatePosts();
  const { data: roles } = useCorporateRoles();
  // Presence, not permission: the serializer removes the sensitive group
  // entirely for callers who may not read it, so the field simply is not there.
  // On a new employee there is no record to strip, so the section is offered.
  const maySeeBank = employee === null || "bank_account_number" in employee;
  // The identity group travels in the same stripped set as the bank one, so
  // these two agree today. Each probes for its own field anyway: if the gating
  // ever splits — an HR assistant who may see a bank account but not a
  // citizenship certificate is a reasonable thing for a customer to want — the
  // sections separate without either one being wrong in the meantime.
  const maySeeIdentity = employee === null || "citizenship_number" in employee;
  const [error, setError] = useState<string | null>(null);
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const { data: logs } = useEmployeeLogs(employeeId);
  const submitting = createEmployee.isPending || updateEmployee.isPending;

  function set<K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setError(null);
    try {
      if (isEditing && employeeId !== null) {
        // An empty account number means "unchanged", not "erase it" — the
        // field starts blank because the served value is masked.
        const payload = { ...values };
        if (!payload.bank_account_number) delete payload.bank_account_number;
        await updateEmployee.mutateAsync({ id: employeeId, values: payload });
      } else {
        await createEmployee.mutateAsync(values);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Grid container spacing={2} sx={{ mt: 1 }}>
          {/* The photo sits above the name because it is the thing people
              recognise a record by — it appears on the directory row, the org
              chart, every approval and every chat message. It was the one
              field the record showed everywhere and this form could not set:
              HR could see a colleague had no picture and had no way to give
              them one. */}
          <Grid size={12}>
            <ImageUpload
              value={employee?.photo ?? null}
              fallback={`${values.first_name.trim().charAt(0)}${values.last_name.trim().charAt(0)}`.toUpperCase()}
              label={employee?.photo ? "Replace photo" : "Add a photo"}
              onChange={(file) => set("photo", file)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="First name"
              fullWidth
              value={values.first_name}
              onChange={(e) => set("first_name", e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Last name"
              fullWidth
              value={values.last_name}
              onChange={(e) => set("last_name", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Email"
              type="email"
              fullWidth
              disabled={isEditing}
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              helperText={isEditing ? "Email can't be changed here." : undefined}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <EmailIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Phone"
              fullWidth
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <PhoneIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <DateField
              label="Date of birth"
              value={values.date_of_birth}
              onChange={(v) => set("date_of_birth", v)}
              startIcon={<CakeIcon fontSize="small" />}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Gender"
              fullWidth
              value={values.gender}
              onChange={(e) => set("gender", e.target.value as EmployeeFormValues["gender"])}
            >
              {GENDERS.map((g) => (
                <MenuItem key={g.value} value={g.value}>
                  {g.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <DateField
              label="Date joined"
              required
              value={values.date_joined}
              onChange={(v) => set("date_joined", v)}
              startIcon={<EventIcon fontSize="small" />}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {/* Blank means not on probation, which is why it is not required.
                The profile header reads this to show "on probation until …",
                and the onboarding checklist dates its tasks from it. */}
            <DateField
              label="Probation ends"
              value={values.probation_end_date}
              onChange={(v) => set("probation_end_date", v)}
              startIcon={<EventIcon fontSize="small" />}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Employment status"
              fullWidth
              value={values.employment_status}
              onChange={(e) =>
                set("employment_status", e.target.value as EmployeeFormValues["employment_status"])
              }
              disabled={isSuspended}
              helperText={
                isSuspended
                  ? "Suspended. Lift the suspension on the Conduct tab to change this."
                  : undefined
              }
            >
              {/* A suspended employee's status has no matching option above,
                  so the select would render blank and the first save would
                  silently move them to whatever the operator picked — undoing
                  a suspension by editing a phone number. The option is added
                  and the field disabled instead: it says what is true and
                  refuses to change it. */}
              {isSuspended ? (
                <MenuItem value="suspended">Suspended</MenuItem>
              ) : null}
              {EMPLOYMENT_STATUSES.map((s) => (
                <MenuItem key={s.value} value={s.value}>
                  {s.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <DepartmentPicker
              value={values.department ?? null}
              onChange={(id) => set("department", id)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {/* Scoped to the chosen department when there is one, so the
                list narrows as the form is filled in rather than offering
                every title in the company. */}
            <DesignationPicker
              value={values.designation ?? null}
              onChange={(id) => set("designation", id)}
              departmentId={values.department ?? undefined}
            />
          </Grid>

          {/* ── Who they report to ─────────────────────────────────────
              This field *is* the organisation chart. `/employees/org-chart`
              draws nothing but `manager` walked upwards, and every "your
              team" list, approval fallback and manager notification reads
              the same column — so a company where nobody has set it has an
              empty chart and no obvious reason why.

              It was already in the form's state and in the payload sent to
              the server; what was missing was any control to set it, which
              made the one field the hierarchy depends on the one field
              nobody could edit. */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <EmployeePicker
              label="Reports to"
              value={values.manager ?? null}
              onChange={(id) => set("manager", id)}
              placeholder="Nobody — top of the chart"
              size="small"
              // Somebody cannot be their own manager, and the server would
              // refuse the cycle anyway; keeping them out of the list means
              // the refusal never has to happen.
              excludeIds={employee ? [employee.id] : undefined}
            />
          </Grid>

          {/* ── Who approves for them ──────────────────────────────────
              **Distinct from "Reports to", and both are needed.** The manager
              draws the org chart; these are the people a leave request goes
              to, and in most offices they are not the same person — a site
              engineer reports to the project manager while their leave is seen
              by the site in-charge.

              **The order is the rule, not a preference.** Leave stops at the
              *last* of them: supervisor 1 is the maker and is notified,
              supervisor 2 is the checker and decides. See
              `leave.services.effective_chain`. */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <EmployeePicker
              label="Supervisors"
              multiple
              value={values.supervisor_ids ?? []}
              onChange={(ids) => set("supervisor_ids", (ids as number[]) ?? [])}
              size="small"
              placeholder="Nobody — leave falls back to their manager"
              helperText="In order. The last one approves; the rest are told."
              excludeIds={employee ? [employee.id] : undefined}
            />
          </Grid>

          {/* ── The chair and the work ─────────────────────────────────
              The post is what somebody is appointed to and what their grade
              follows; the role is what they are responsible for. They move
              independently — two Deputy Managers hold different roles, and
              somebody promoted out of Senior Engineer usually keeps running
              the same site — which is why they are two fields. */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Corporate post"
              fullWidth
              value={values.corporate_post ?? ""}
              onChange={(e) =>
                set("corporate_post", e.target.value === "" ? null : Number(e.target.value))
              }
              helperText="The establishment position — grade and seniority follow this."
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {(posts?.results ?? []).map((post) => (
                <MenuItem key={post.id} value={post.id}>
                  {post.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Corporate role"
              fullWidth
              value={values.corporate_role ?? ""}
              onChange={(e) =>
                set("corporate_role", e.target.value === "" ? null : Number(e.target.value))
              }
              helperText="What they are actually responsible for."
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {(roles?.results ?? []).map((role) => (
                <MenuItem key={role.id} value={role.id}>
                  {role.name}
                  {role.company_name ? ` · ${role.company_name}` : ""}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          {/* ── Which company, of the group's several ──────────────────
              One is employment and the other is not. `primary_company` is who
              pays them — it appears on their payslip and there is exactly one.
              The secondaries are where else they work: a chief engineer at the
              parent seconded to two project SPVs, a shared finance team serving
              the whole group. No payroll attaches to those. */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <CompanyPicker
              label="Primary company"
              required
              value={values.primary_company}
              onChange={(id) => {
                set("primary_company", id);
                // Dropping it from the secondaries rather than letting the API
                // refuse the save: the person has just said this is where they
                // are employed, and holding the contradiction so it can be
                // rejected on submit helps nobody.
                if (id != null && values.secondary_companies.includes(id)) {
                  set(
                    "secondary_companies",
                    values.secondary_companies.filter((c) => c !== id)
                  );
                }
              }}
              helperText="Who employs them. This is the company on their payslip."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <SecondaryCompanyField
              primaryCompanyId={values.primary_company}
              value={values.secondary_companies}
              onChange={(ids) => set("secondary_companies", ids)}
            />
          </Grid>
        </Grid>

        {/* ── How to reach them, and where they live ──────────────────────
            Four channels, because two of them belong to the company. An office
            number and an office mailbox are issued and revoked; a personal
            number and a private address survive the employment and are the only
            way to reach a leaver about their final settlement. Collapsing them
            means offboarding either strands the record or publishes a private
            mobile in the staff directory. */}
        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Contact and address
        </Typography>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Office cell"
              fullWidth
              value={values.office_phone}
              onChange={(e) => set("office_phone", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Office email"
              type="email"
              fullWidth
              value={values.office_email}
              onChange={(e) => set("office_email", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Personal cell"
              fullWidth
              value={values.personal_phone}
              onChange={(e) => set("personal_phone", e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Personal email"
              type="email"
              fullWidth
              value={values.personal_email}
              onChange={(e) => set("personal_email", e.target.value)}
              helperText="How a leaver is reached about their final settlement."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Permanent address"
              fullWidth
              value={values.permanent_address}
              onChange={(e) => set("permanent_address", e.target.value)}
              helperText="As on the citizenship certificate."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Temporary address"
              fullWidth
              value={values.temporary_address}
              onChange={(e) => set("temporary_address", e.target.value)}
              helperText="Current residence, if it differs."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            {/* Asked for by the safety side. A powerhouse is an hour from a
                hospital, and the group on file is the difference between a
                transfusion starting on arrival and starting after a
                cross-match. */}
            <TextField
              select
              label="Blood group"
              fullWidth
              value={values.blood_group}
              onChange={(e) => set("blood_group", e.target.value as EmployeeFormValues["blood_group"])}
              helperText="On file for site emergencies."
            >
              <MenuItem value="">
                <em>Not recorded</em>
              </MenuItem>
              {BLOOD_GROUPS.map((group) => (
                <MenuItem key={group} value={group}>
                  {group}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>

        {/* `build_payment_batches` needs a bank, an account number *and* an
            account type — "banks reject on this" — so all three are entered
            here. Without a form for them the only route in is the employee
            raising three change requests against their own profile.

            Shown only when the caller may see them. The serializer strips the
            whole sensitive group for everyone else, so the fields would render
            blank and a save would erase real bank details — the same test the
            employment record panel uses, for the same reason. */}
        {maySeeBank ? (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Bank details
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
              Salary is paid from these. Without all three of bank, account
              number and account type, this person is left out of the payment
              instruction and has to be paid by hand.
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Bank"
                  fullWidth
                  value={values.bank_name ?? ""}
                  onChange={(e) => set("bank_name", e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Branch"
                  fullWidth
                  value={values.bank_branch ?? ""}
                  onChange={(e) => set("bank_branch", e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Account number"
                  fullWidth
                  value={values.bank_account_number ?? ""}
                  onChange={(e) => set("bank_account_number", e.target.value)}
                  placeholder={employee?.bank_account_number || undefined}
                  helperText={
                    employee?.bank_account_number
                      ? `Currently ${employee.bank_account_number} — leave blank to keep it.`
                      : undefined
                  }
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  label="Account type"
                  fullWidth
                  value={values.bank_account_type ?? ""}
                  onChange={(e) =>
                    set("bank_account_type", e.target.value as EmployeeFormValues["bank_account_type"])
                  }
                  helperText="A bank rejects an instruction naming the wrong one."
                >
                  {BANK_ACCOUNT_TYPES.map((t) => (
                    <MenuItem key={t.value} value={t.value}>
                      {t.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Account name"
                  fullWidth
                  value={values.bank_account_name ?? ""}
                  onChange={(e) => set("bank_account_name", e.target.value)}
                  helperText="Only if it differs from their legal name."
                />
              </Grid>
            </Grid>
          </>
        ) : null}

        {/* Where the citizenship scans and the statutory numbers are entered.
            The employment record renders the scans as links and the person's
            own profile renders "on file / not on file"; this is the only
            control in the product that writes them, so without it every record
            reads *not on file* because every record genuinely is.

            Why HR rather than the employee: `change_requests.py` compares an
            old value to a new one and an approver reads both, which a file is
            not. A scan uploaded by its own subject is also self-attested — the
            second pair of eyes is the point of the whole module. An
            employee-supplied scan awaiting verification is a real feature and
            a bigger one; it is in the queue, not smuggled in here. */}
        {maySeeIdentity ? (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Identity &amp; statutory
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
              The name and numbers that have to match the statutory filings, and
              the certificate they were read off. PAN and SSF reach payroll
              directly; a payslip issued against the wrong number is a
              correction to file, not a field to edit.
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Legal first name"
                  fullWidth
                  value={values.legal_first_name ?? ""}
                  onChange={(e) => set("legal_first_name", e.target.value)}
                  helperText="Only if it differs from the name above."
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Legal middle name"
                  fullWidth
                  value={values.legal_middle_name ?? ""}
                  onChange={(e) => set("legal_middle_name", e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Legal last name"
                  fullWidth
                  value={values.legal_last_name ?? ""}
                  onChange={(e) => set("legal_last_name", e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Citizenship number"
                  fullWidth
                  value={values.citizenship_number ?? ""}
                  onChange={(e) => set("citizenship_number", e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  label="Marital status"
                  fullWidth
                  value={values.marital_status ?? ""}
                  onChange={(e) => set("marital_status", e.target.value as MaritalStatus)}
                  helperText="The married tax band is wider than the individual one."
                >
                  {MARITAL_STATUSES.map((status) => (
                    <MenuItem key={status.value} value={status.value}>
                      {status.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>

              {/* Two sides, two controls. A single "scan" field would take one
                  file and the certificate has the number on the front and the
                  issuing details on the back — which is why the model has two
                  columns and both screens render two links. */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <ScanUpload
                  label="Citizenship — front"
                  current={employee?.citizenship_front ?? null}
                  onChange={(file) => set("citizenship_front", file)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <ScanUpload
                  label="Citizenship — back"
                  current={employee?.citizenship_back ?? null}
                  onChange={(file) => set("citizenship_back", file)}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Passport number"
                  fullWidth
                  value={values.passport_number ?? ""}
                  onChange={(e) => set("passport_number", e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <DateField
                  label="Passport expiry"
                  value={values.passport_expiry ?? ""}
                  onChange={(v) => set("passport_expiry", v)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <TextField
                  label="PAN"
                  fullWidth
                  value={values.pan_number ?? ""}
                  onChange={(e) => set("pan_number", e.target.value)}
                  helperText="Payroll files against this."
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <TextField
                  label="SSF / SSID"
                  fullWidth
                  value={values.ssf_number ?? ""}
                  onChange={(e) => set("ssf_number", e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <TextField
                  label="Provident fund"
                  fullWidth
                  value={values.pf_number ?? ""}
                  onChange={(e) => set("pf_number", e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <TextField
                  label="CIT"
                  fullWidth
                  value={values.cit_number ?? ""}
                  onChange={(e) => set("cit_number", e.target.value)}
                />
              </Grid>
            </Grid>
          </>
        ) : null}

        {isEditing && logs && logs.length > 0 && <EmployeeHistory logs={logs} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Saving..." : isEditing ? "Save changes" : "Create employee"}
        </Button>
      </DialogActions>
    </>
  );
}

/**
 * One side of an identity document: what is on file, and how to replace it.
 *
 * Not `ImageUpload`. That one is built for an avatar — a circle, initials as
 * the fallback, and a preview that is the point of the control. A certificate
 * is landscape, it is read rather than recognised, and the useful question
 * about it is "is the right one attached", which a 96px crop cannot answer. So
 * the thumbnail is small and supporting, and the link to the full image is the
 * primary affordance.
 *
 * `accept` is images only because the column is an `ImageField`: a PDF would
 * be picked happily here and refused by Pillow on save, which is a worse place
 * to find out. Widening it means widening the model first.
 */
function ScanUpload({
  label,
  current,
  onChange,
}: {
  label: string;
  /** The scan already on the record, or null. */
  current: string | null;
  onChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Revoking on unmount only would leak one object URL per re-pick, which is
  // exactly what somebody does when they attach the wrong side first.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function pick(file: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
    setChosen(file);
    onChange(file);
  }

  const shown = preview ?? current;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        p: 1.25,
        borderRadius: 1.5,
        border: "1px solid",
        borderColor: chosen ? "primary.main" : "divider",
        minHeight: 72,
      }}
    >
      <Box
        sx={{
          width: 64,
          height: 44,
          flexShrink: 0,
          borderRadius: 1,
          border: "1px dashed",
          borderColor: shown ? "transparent" : "divider",
          bgcolor: "action.hover",
          backgroundImage: shown ? `url(${shown})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          display: "grid",
          placeItems: "center",
          color: "text.disabled",
        }}
      >
        {shown ? null : <BadgeIcon fontSize="small" />}
      </Box>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
          {chosen ? (
            chosen.name
          ) : current ? (
            <Link href={current} target="_blank" rel="noopener">
              View the one on file
            </Link>
          ) : (
            "Nothing on file"
          )}
        </Typography>
      </Box>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      <Button
        size="small"
        onClick={() => inputRef.current?.click()}
        sx={{ flexShrink: 0 }}
      >
        {current || chosen ? "Replace" : "Upload"}
      </Button>
    </Box>
  );
}

function EmployeeHistory({ logs }: { logs: EmployeeLogEntry[] }) {
  return (
    <>
      <Divider sx={{ my: 3 }} />
      <Typography variant="subtitle2" gutterBottom>
        History
      </Typography>
      <List dense disablePadding>
        {logs.map((log) => (
          <ListItem key={log.id} disableGutters>
            <ListItemText
              primary={`${FIELD_LABELS[log.field] ?? log.field}: ${log.from_value || "—"} → ${log.to_value || "—"}`}
              secondary={`${new Date(log.created_at).toLocaleString()}${log.actor_name ? ` · by ${log.actor_name}` : ""}`}
            />
          </ListItem>
        ))}
      </List>
    </>
  );
}
