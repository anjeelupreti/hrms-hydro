"use client";

import DeleteOutlineIcon from "@mui/icons-material/Delete";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import { EmployeePicker } from "@/components/common/pickers";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  useAttendanceMethods,
  useAttendancePolicy,
  useDeleteAttendanceMethod,
  useSaveAttendanceMethod,
  useUpdateAttendancePolicy,
} from "@/hooks/useAttendancePolicy";
import { useCan } from "@/hooks/useMe";

/** Tri-state, because "no opinion" and "no" are different answers.
 *  A plain switch cannot hold both, which is why the model stores nullable
 *  booleans and this stores a string. */
const OVERRIDE_CHOICES = [
  { value: "inherit", label: "Follow the company rule" },
  { value: "allow", label: "Allowed" },
  { value: "deny", label: "Not allowed" },
];

function toChoice(value: boolean | null): string {
  if (value === null || value === undefined) return "inherit";
  return value ? "allow" : "deny";
}

function fromChoice(choice: string): boolean | null {
  if (choice === "inherit") return null;
  return choice === "allow";
}

export default function AttendanceSettingsPage() {
  const canManage = useCan("attendance.manage");
  const { data: policy } = useAttendancePolicy();
  const { data: methods } = useAttendanceMethods();
  const updatePolicy = useUpdateAttendancePolicy();
  const saveMethod = useSaveAttendanceMethod();
  const deleteMethod = useDeleteAttendanceMethod();

  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [web, setWeb] = useState("inherit");
  const [biometric, setBiometric] = useState("inherit");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!policy) return null;

  const nothingPermitted = !policy.allow_web && !policy.allow_biometric;

  async function addOverride() {
    if (employeeId === null) return;
    setError(null);
    try {
      await saveMethod.mutateAsync({
        employee: employeeId,
        allow_web: fromChoice(web),
        allow_biometric: fromChoice(biometric),
        note,
      });
      setEmployeeId(null);
      setWeb("inherit");
      setBiometric("inherit");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that exception.");
    }
  }

  return (
    <PageContainer>
      <Box sx={{ maxWidth: 760, mx: "auto" }}>
        <PageHeader
          title="How people clock in"
          subtitle="Which methods this company accepts, and who is an exception"
          icon={<FingerprintIcon />}
          module="ATTENDANCE"
        />

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Company default
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Turning a method off refuses it at the API, not just in the interface —
              a device that keeps pushing is refused too, and its events are held
              with a reason rather than dropped.
            </Typography>

            <Stack spacing={1}>
              <FormControlLabel
                control={
                  <Switch
                    checked={policy.allow_web}
                    disabled={!canManage || updatePolicy.isPending}
                    onChange={(e) => updatePolicy.mutate({ allow_web: e.target.checked })}
                  />
                }
                label="Employees may clock in from the system"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={policy.allow_biometric}
                    disabled={!canManage || updatePolicy.isPending}
                    onChange={(e) => updatePolicy.mutate({ allow_biometric: e.target.checked })}
                  />
                }
                label="Registered devices may post attendance"
              />
            </Stack>

            {/* ── Lateness ────────────────────────────────────────────────
                Its own block rather than a third switch beside the sources:
                those decide *how* somebody clocks in, this decides what it
                costs them, and the two are not the same kind of decision. */}
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Late arrivals
              </Typography>
              <Typography variant="caption" color="text.secondary">
                A shift&apos;s grace period decides who counts as late. This
                decides whether that costs anything.
              </Typography>

              <FormControlLabel
                sx={{ display: "block", mt: 1 }}
                control={
                  <Switch
                    checked={policy.lateness_deduction_enabled}
                    disabled={!canManage || updatePolicy.isPending}
                    onChange={(e) =>
                      updatePolicy.mutate({ lateness_deduction_enabled: e.target.checked })
                    }
                  />
                }
                label="Deduct pay for repeated lateness"
              />

              {policy.lateness_deduction_enabled && (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1 }}>
                  <Typography variant="body2">Every</Typography>
                  <TextField
                    size="small"
                    type="number"
                    value={policy.late_days_per_deduction}
                    disabled={!canManage || updatePolicy.isPending}
                    onChange={(e) =>
                      updatePolicy.mutate({
                        late_days_per_deduction: Number(e.target.value) || 1,
                      })
                    }
                    sx={{ width: 90 }}
                    slotProps={{ htmlInput: { min: 1 } }}
                  />
                  <Typography variant="body2">late days cost one day&apos;s pay.</Typography>
                </Stack>
              )}

              {policy.lateness_deduction_enabled && (
                <Alert severity="info" sx={{ mt: 1.5 }}>
                  Counted in whole days and rounded down — {policy.late_days_per_deduction - 1}{" "}
                  late {policy.late_days_per_deduction - 1 === 1 ? "day costs" : "days cost"}{" "}
                  nothing. Charging by the minute makes every late arrival an
                  argument about traffic.
                </Alert>
              )}
            </Box>

            {/* Not an error state. It is a legitimate configuration — some
                companies record attendance entirely by hand — and the reassurance
                matters more than the warning, because the obvious fear on seeing
                both switches off is that nobody can be marked present. */}
            {nothingPermitted && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Nobody can clock themselves in. HR can still record attendance by
                hand, and the absence sweep still runs — a policy can never lock a
                company out of its own attendance, because payroll reads it.
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Exceptions
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              For people the company rule does not fit — a field team with no reader
              on site, or a factory floor that should use one and nothing else.
            </Typography>

            {(methods ?? []).length === 0 ? (
              <EmptyState
                title="No exceptions"
                description="Everybody follows the company default above."
              />
            ) : (
              <Stack spacing={1} sx={{ mb: 2 }}>
                {(methods ?? []).map((method) => (
                  <Stack
                    key={method.id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", flexWrap: "wrap" }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 160 }}>
                      {method.employee_name}
                    </Typography>
                    <Chip
                      size="small"
                      label={`Web: ${OVERRIDE_CHOICES.find((c) => c.value === toChoice(method.allow_web))?.label}`}
                    />
                    <Chip
                      size="small"
                      label={`Device: ${OVERRIDE_CHOICES.find((c) => c.value === toChoice(method.allow_biometric))?.label}`}
                    />
                    {method.note && (
                      <Typography variant="caption" color="text.secondary">
                        {method.note}
                      </Typography>
                    )}
                    {canManage && (
                      <Tooltip title="Remove this exception">
                        <IconButton
                          size="small"
                          onClick={() => deleteMethod.mutate(method.id)}
                          sx={{ ml: "auto" }}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                ))}
              </Stack>
            )}

            {canManage && (
              <>
                <Divider sx={{ my: 2 }} />
                <Stack spacing={2}>
                  {/* A picker, not an id box. R1: any list a human picks
                      from must be searchable, and nobody knows their
                      colleagues by primary key. */}
                  <EmployeePicker
                    value={employeeId}
                    onChange={(id) => setEmployeeId(id)}
                    required
                  />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <TextField
                      select
                      size="small"
                      label="Web check-in"
                      value={web}
                      onChange={(e) => setWeb(e.target.value)}
                      sx={{ minWidth: 200 }}
                    >
                      {OVERRIDE_CHOICES.map((choice) => (
                        <MenuItem key={choice.value} value={choice.value}>
                          {choice.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label="Device"
                      value={biometric}
                      onChange={(e) => setBiometric(e.target.value)}
                      sx={{ minWidth: 200 }}
                    >
                      {OVERRIDE_CHOICES.map((choice) => (
                        <MenuItem key={choice.value} value={choice.value}>
                          {choice.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                  <TextField
                    label="Why this person differs"
                    size="small"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    helperText="Read by whoever wonders about it in six months."
                  />
                  <Button
                    variant="contained"
                    onClick={addOverride}
                    disabled={employeeId === null || saveMethod.isPending}
                    sx={{ alignSelf: "flex-start" }}
                  >
                    Add exception
                  </Button>
                </Stack>
              </>
            )}
          </CardContent>
        </Card>
      </Box>
    </PageContainer>
  );
}
