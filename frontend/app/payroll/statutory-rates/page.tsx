"use client";

/**
 * The legislated figures — SSF, PF, gratuity, the relief limits, the ceilings.
 *
 * **This screen is what makes "every statutory figure is configuration" true.**
 * The table held eleven figures set annually by somebody else's budget speech,
 * and had no API and no page: they were constants with extra steps, and
 * changing one meant a database console.
 *
 * **The unchecked ones lead.** Every figure ships as a plausible default so the
 * product works on day one, and a plausible default is indistinguishable from a
 * confirmed one unless the screen says otherwise — which is the exact
 * confident-and-wrong failure the whole statutory design exists to avoid. So
 * unverified rows sort first and carry a warning, rather than sitting quietly
 * in alphabetical order looking authoritative.
 *
 * **Verifying is its own act, and needs a citation.** Marking a figure checked
 * in the same breath as changing it is somebody approving their own edit.
 */

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import GavelIcon from "@mui/icons-material/Gavel";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";

import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  useSeedStatutoryRates,
  useStatutoryRates,
  useUpdateStatutoryRate,
  useVerifyStatutoryRate,
} from "@/hooks/usePayroll";
import type { StatutoryRate } from "@/types/payroll";

const UNIT_SUFFIX: Record<string, string> = {
  percent: "%",
  amount: "Rs",
  multiplier: "×",
};

function RateRow({
  rate,
  onVerify,
  onError,
}: {
  rate: StatutoryRate;
  onVerify: (rate: StatutoryRate) => void;
  onError: (message: string) => void;
}) {
  const update = useUpdateStatutoryRate();
  const verify = useVerifyStatutoryRate();
  const [value, setValue] = useState(rate.value);

  async function save() {
    if (value === rate.value) return;
    onError("");
    try {
      await update.mutateAsync({ id: rate.id, value });
    } catch (err) {
      setValue(rate.value);
      onError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  async function withdraw() {
    onError("");
    try {
      await verify.mutateAsync({ id: rate.id });
    } catch (err) {
      onError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1.5}
      sx={{
        py: 1.5,
        alignItems: { sm: "flex-start" },
        borderTop: "1px solid",
        borderColor: "divider",
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {rate.label || rate.code}
          </Typography>
          {rate.is_verified ? (
            <Tooltip
              title={`${rate.source}${rate.verified_by_name ? ` — ${rate.verified_by_name}` : ""}`}
            >
              <Chip
                size="small"
                color="success"
                icon={<CheckCircleIcon />}
                label="Checked"
              />
            </Tooltip>
          ) : (
            <Chip
              size="small"
              color="warning"
              icon={<WarningAmberIcon />}
              label="Not checked"
            />
          )}
        </Stack>

        {/* What the number *means*. Several of these are easy to enter against
            the wrong base — a percentage of basic, not of gross — and the note
            is where that is said. */}
        {rate.note ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            {rate.note}
          </Typography>
        ) : null}

        {rate.is_verified && rate.verified_at ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            {rate.source} · <DateText value={rate.verified_at} />
          </Typography>
        ) : null}
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
        <TextField
          size="small"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          disabled={update.isPending}
          sx={{ width: 130 }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">{UNIT_SUFFIX[rate.unit] ?? ""}</InputAdornment>
              ),
            },
          }}
        />
        {rate.is_verified ? (
          <Button size="small" color="inherit" onClick={withdraw}>
            Withdraw
          </Button>
        ) : (
          <Button size="small" onClick={() => onVerify(rate)}>
            Mark checked
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

export default function StatutoryRatesPage() {
  const { data, isLoading } = useStatutoryRates();
  const verify = useVerifyStatutoryRate();
  const seed = useSeedStatutoryRates();

  const [verifying, setVerifying] = useState<StatutoryRate | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");

  // Memoised so the grouping below has a stable dependency — `?? []` builds a
  // fresh array every render, which would re-sort on each one.
  const rows = useMemo(() => data?.results ?? [], [data]);

  const { unchecked, checked, year } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.fiscal_year - a.fiscal_year);
    return {
      unchecked: sorted.filter((r) => !r.is_verified),
      checked: sorted.filter((r) => r.is_verified),
      year: sorted[0]?.fiscal_year_label ?? "",
    };
  }, [rows]);

  async function confirmVerify() {
    if (!verifying || !source.trim()) return;
    setError("");
    try {
      await verify.mutateAsync({ id: verifying.id, source: source.trim() });
      setVerifying(null);
      setSource("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  if (isLoading) {
    return (
      <PageContainer>
        <CircularProgress />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Statutory rates"
        subtitle={`The figures the law sets${year ? ` · ${year}` : ""}`}
        icon={<GavelIcon />}
      />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          surface
          title="No rates configured"
          description="Seed this year's figures to get started. They arrive as unchecked defaults — plausible starting points, not law — for somebody to confirm against the Finance Act."
          action={
            <Button
              variant="contained"
              disabled={seed.isPending}
              onClick={() => seed.mutateAsync(new Date().getFullYear())}
            >
              Seed this year
            </Button>
          }
        />
      ) : null}

      {/* Leads with the warning, because the whole risk here is a plausible
          default being mistaken for a confirmed figure. */}
      {unchecked.length > 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>
            {unchecked.length} figure{unchecked.length === 1 ? "" : "s"} not yet checked.
          </strong>{" "}
          These are shipped defaults so the product works on day one — they are not law.
          Confirm each against the current Finance Act before running real payroll.
        </Alert>
      ) : null}

      {unchecked.length > 0 ? (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ pt: 1 }}>
            <Typography variant="overline" color="text.secondary">
              Needs checking
            </Typography>
            {unchecked.map((rate) => (
              <RateRow key={rate.id} rate={rate} onVerify={setVerifying} onError={setError} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {checked.length > 0 ? (
        <Card>
          <CardContent sx={{ pt: 1 }}>
            <Typography variant="overline" color="text.secondary">
              Checked
            </Typography>
            {checked.map((rate) => (
              <RateRow key={rate.id} rate={rate} onVerify={setVerifying} onError={setError} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={Boolean(verifying)} onClose={() => setVerifying(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Confirm “{verifying?.label}”</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Recording where this figure came from is what makes the tick worth
            anything — six months from now, nobody will remember.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Where did this come from?"
            placeholder="Finance Act 2082, Schedule 1"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVerifying(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!source.trim() || verify.isPending}
            onClick={confirmVerify}
          >
            Mark checked
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
