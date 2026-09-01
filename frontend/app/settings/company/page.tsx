"use client";

import BusinessIcon from "@mui/icons-material/Business";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import ImageUpload from "@/components/common/ImageUpload";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useCompanyProfile, useUpdateCompanyProfile } from "@/hooks/useOrganization";
import { useCan } from "@/hooks/useMe";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export default function CompanySettingsPage() {
  const { data: profile } = useCompanyProfile();

  if (!profile) return null;
  return <CompanyForm key={profile.id} profile={profile} />;
}

function CompanyForm({ profile }: { profile: NonNullable<ReturnType<typeof useCompanyProfile>["data"]> }) {
  const canManage = useCan("settings.manage");
  const updateProfile = useUpdateCompanyProfile();

  const [name, setName] = useState(profile.name);
  const [address, setAddress] = useState(profile.address);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [calendar, setCalendar] = useState<"BS" | "AD">(profile.calendar);
  // "" means "use this calendar's own year" — the answer for every Nepali
  // company, and the reason the field is nullable rather than defaulted to a
  // month number nobody chose.
  const [fiscalStart, setFiscalStart] = useState<number | "">(
    profile.fiscal_year_start_month ?? ""
  );
  const [scheme, setScheme] = useState<"" | "ssf" | "pf">(profile.retirement_scheme);
  const [schemePaused, setSchemePaused] = useState(profile.retirement_paused);
  const [offersCit, setOffersCit] = useState(profile.offers_cit);
  const [providesGratuity, setProvidesGratuity] = useState(profile.provides_gratuity);
  const [workingDays, setWorkingDays] = useState<number[]>(profile.working_days);
  const [payrollProrate, setPayrollProrate] = useState(profile.payroll_prorate);
  const [payBasis, setPayBasis] = useState<"calendar" | "working_days">(profile.pay_basis);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function toggleDay(day: number) {
    setWorkingDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  async function handleSave() {
    setError(null);
    setSuccess(false);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("address", address);
    formData.set("timezone", timezone);
    formData.set("calendar", calendar);
    formData.set("fiscal_year_start_month", fiscalStart === "" ? "" : String(fiscalStart));
    formData.set("retirement_scheme", scheme);
    formData.set("retirement_paused", String(schemePaused));
    formData.set("offers_cit", String(offersCit));
    formData.set("provides_gratuity", String(providesGratuity));
    formData.set("working_days", JSON.stringify(workingDays));
    formData.set("payroll_prorate", String(payrollProrate));
    formData.set("pay_basis", payBasis);
    if (logoFile) formData.set("logo", logoFile);
    try {
      await updateProfile.mutateAsync(formData);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <PageContainer>
      {/* Two columns, because a settings form does not have to be one narrow
          stack: ten fields — logo, name, address, timezone, fiscal calendar,
          year start, retirement fund and its rates — make a column taller than
          the viewport, with the save button below the fold.

          From `sm` up, and the fields that belong together sit on
          one row: a timezone beside a fiscal calendar is one decision about how
          this company keeps time, and stacking them implies they are unrelated
          steps. Anything that is genuinely full-bleed — the logo, the address,
          the retirement block — still spans both. */}
      <Box sx={{ maxWidth: 1040, mx: "auto" }}>
        <PageHeader title="Company Profile" subtitle="Org-wide settings" icon={<BusinessIcon />} />

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Saved.
          </Alert>
        )}

        <Card>
          <CardContent>
            <Box
              sx={{
                display: "grid",
                gap: 2.5,
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                alignItems: "start",
                // The logo and the address are their own rows; a 72px avatar
                // beside a text field leaves a hole, and an address is longer
                // than half a row deserves.
                "& > .full": { gridColumn: { sm: "1 / -1" } },
              }}
            >
              <Box className="full">
              <ImageUpload
                value={profile.logo}
                fallback={name.slice(0, 2).toUpperCase()}
                shape="square"
                size={72}
                label="Change logo"
                onChange={setLogoFile}
              />
              </Box>

              <TextField
                label="Company name"
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canManage}
              />
        <TextField
          className="full"
          label="Address"
          fullWidth
          multiline
          minRows={2}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={!canManage}
        />
        <TextField
          label="Timezone"
          fullWidth
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          disabled={!canManage}
        />

        {/* Not a display preference. This decides what "this year" means for a
            leave entitlement, which fiscal year a payslip belongs to, and which
            statutory rates apply — so it says so, rather than sitting next to
            timezone looking like a formatting choice. */}
        <TextField
          select
          label="Fiscal calendar"
          fullWidth
          value={calendar}
          onChange={(e) => setCalendar(e.target.value as "BS" | "AD")}
          disabled={!canManage}
          helperText="Sets the fiscal year used by payroll, statutory rates and leave entitlements."
        >
          {/* The abbreviation leads, because BS and AD are what people
              read and write; the full name follows for whoever needs it. */}
          <MenuItem value="BS">BS — Bikram Sambat, Shrawan to Ashad</MenuItem>
          <MenuItem value="AD">AD — Gregorian, January to December</MenuItem>
        </TextField>

        {/* **A financial year is a country's rule, not a calendar's.** India
            and the UK run April–March on this same Gregorian calendar, and the
            US federal year opens in October — so the calendar supplies a
            default and the company may override it. Left empty by every Nepali
            company, which is why the empty option leads and names what it
            means rather than reading as "not set". */}
        <TextField
          select
          label="Financial year starts in"
          fullWidth
          value={fiscalStart}
          onChange={(e) => setFiscalStart(e.target.value === "" ? "" : Number(e.target.value))}
          disabled={!canManage}
          helperText={
            fiscalStart === ""
              ? `Using this calendar's own year — currently ${profile.fiscal_year_label ?? "—"}.`
              : "Set this only if your country's financial year differs from the calendar's."
          }
        >
          <MenuItem value="">
            {calendar === "BS" ? "Shrawan — Nepal's own year" : "January — the calendar year"}
          </MenuItem>
          {(profile.calendar_months ?? []).map((month) => (
            <MenuItem key={month.value} value={month.value}>
              {month.label}
            </MenuItem>
          ))}
        </TextField>

        {calendar !== profile.calendar && (
          <Alert className="full" severity="warning">
            Changing this changes which fiscal year existing leave balances and
            payslips are read against. Balances are stored per year, so figures
            already recorded stay under the year they were saved with.
          </Alert>
        )}

        {fiscalStart !== (profile.fiscal_year_start_month ?? "") && (
          <Alert className="full" severity="warning">
            Moving the start of the financial year changes which year every date
            falls in — leave balances, tax slabs and statutory rates are all
            keyed on it. It is refused once payroll has run, so set it during
            setup rather than later.
          </Alert>
        )}

        {/* ── Retirement & savings ──────────────────────────────────────
            Nothing here is preselected. Which fund a company is on is the
            owner's decision, and a default would start taking money out of
            people's pay on a basis nobody chose. */}
        <Box className="full">
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Retirement &amp; savings
          </Typography>
          <Typography variant="caption" color="text.secondary">
            What is deducted for the fund, and what the company contributes on top.
          </Typography>

          <Stack spacing={2} sx={{ mt: 1.5 }}>
            <TextField
              select
              label="Retirement fund"
              fullWidth
              value={scheme}
              onChange={(e) => setScheme(e.target.value as "" | "ssf" | "pf")}
              disabled={!canManage}
              helperText={
                scheme === ""
                  ? "Nothing is deducted for a fund until you choose one."
                  : "Rates come from Statutory rates, and can be corrected there."
              }
            >
              {/* One list, not two switches: SSF and PF deduct from the same
                  basic, so "both" is a state that must not be selectable. */}
              <MenuItem value="">None</MenuItem>
              <MenuItem value="ssf">Social Security Fund (SSF)</MenuItem>
              <MenuItem value="pf">Provident Fund (PF)</MenuItem>
            </TextField>

            {scheme !== "" && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={schemePaused}
                    onChange={(e) => setSchemePaused(e.target.checked)}
                    disabled={!canManage}
                  />
                }
                label="Pause contributions for now"
              />
            )}

            {scheme !== "" && schemePaused && (
              <Alert severity="info">
                Still a {scheme.toUpperCase()} company — nothing is deducted while
                this is on, and everything contributed so far is kept. Turn it off
                to start again on the same fund.
              </Alert>
            )}

            <FormControlLabel
              control={
                <Checkbox
                  checked={offersCit}
                  onChange={(e) => setOffersCit(e.target.checked)}
                  disabled={!canManage}
                />
              }
              label="Offer CIT (Citizen Investment Trust)"
            />
            {offersCit && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5, ml: 4 }}>
                Voluntary, and per person — each employee sets their own monthly
                amount on their record.
              </Typography>
            )}

            {/* Hidden on SSF rather than shown-and-ignored: SSF already covers
                gratuity, so offering the choice would imply it does something. */}
            {scheme !== "ssf" && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={providesGratuity}
                    onChange={(e) => setProvidesGratuity(e.target.checked)}
                    disabled={!canManage}
                  />
                }
                label="Employer-funded gratuity"
              />
            )}
            {scheme === "ssf" && providesGratuity && (
              <Alert severity="info">
                Gratuity is not charged separately on SSF — the fund already
                covers it.
              </Alert>
            )}

            {scheme !== profile.retirement_scheme && scheme !== "" && (
              <Alert severity="warning">
                This starts deducting from everyone&apos;s pay on the next payroll
                run. If a salary component already deducts the same thing, saving
                will be refused rather than charging it twice.
              </Alert>
            )}
          </Stack>
        </Box>

        <Box className="full">
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Working days
          </Typography>
          <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap" }}>
            {WEEKDAYS.map((day) => (
              <FormControlLabel
                key={day.value}
                control={
                  <Checkbox
                    checked={workingDays.includes(day.value)}
                    onChange={() => toggleDay(day.value)}
                    disabled={!canManage}
                  />
                }
                label={day.label}
              />
            ))}
          </Stack>
        </Box>

        <Divider />

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Payroll
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={payrollProrate}
                onChange={(e) => setPayrollProrate(e.target.checked)}
                disabled={!canManage}
              />
            }
            label="Prorate pay by days in the month"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            When on, a salary structure that starts mid-month is paid only for the days it was
            active (e.g. effective on the 31st of a 31-day month pays 1/31). When off, any active
            structure pays the full month.
          </Typography>

          {/* Separate from proration above, and genuinely a different question.
              Proration asks how much of the month somebody was employed for;
              this asks what one day is worth once you start deducting. */}
          <Typography variant="subtitle2" sx={{ mt: 3, mb: 0.5 }}>
            How a day of absence is valued
          </Typography>
          <RadioGroup
            value={payBasis}
            onChange={(e) => setPayBasis(e.target.value as "calendar" | "working_days")}
          >
            <FormControlLabel
              value="calendar"
              disabled={!canManage}
              control={<Radio />}
              label="Calendar month — salary ÷ days in the month"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 4, mb: 1 }}>
              The salary covers the whole month, weekends included. One unpaid day in a
              31-day month costs 1/31.
            </Typography>
            <FormControlLabel
              value="working_days"
              disabled={!canManage}
              control={<Radio />}
              label="Working days — salary ÷ days this company works"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 4 }}>
              The salary buys the working days above. The same unpaid day in a month with 21
              working days costs 1/21 — around 50% more. Weekends and holidays are never
              charged on either setting.
            </Typography>
          </RadioGroup>
          <Alert severity="info" sx={{ mt: 2 }}>
            This changes future payslips only. Anything already finalised keeps the basis it was
            computed under.
          </Alert>
        </Box>

              {canManage && (
                <Button
                  className="full"
                  // Spans the row so it always sits under both columns, but
                  // does not *stretch* across it — a full-bleed Save reads as a
                  // banner, and a grid item fills its cell unless told not to.
                  variant="contained"
                  onClick={handleSave}
                  disabled={updateProfile.isPending}
                  sx={{ justifySelf: "start", alignSelf: "flex-start" }}
                >
                  Save
                </Button>
              )}
            </Box>
          </CardContent>
        </Card>
      </Box>
    </PageContainer>
  );
}
