"use client";

/**
 * "What will my tax be, and what would saving more do to it?"
 *
 * **The optimum is the point of this screen.** Contributions are deductible
 * only up to a cap, so past a certain figure another rupee into CIT reduces
 * take-home pay and saves no tax at all. Nothing else in the product tells
 * somebody that, and it is the one number that changes a decision — so it is
 * stated outright rather than left to be discovered by dragging.
 *
 * **It projects; it does not promise.** Every figure is this month repeated, so
 * a raise, a bonus or unpaid leave all make it wrong. The screen names the
 * month it was built from and says so plainly — a projection presented as a
 * settlement is worse than none, because people act on it.
 */

import CalculateIcon from "@mui/icons-material/Calculate";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { moneyRounded } from "@/lib/format/money";
import { useState } from "react";

import { useTaxPlanner } from "@/hooks/usePayroll";



function Figure({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <Box sx={{ flex: "1 1 150px" }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant={strong ? "h5" : "body1"} sx={{ fontWeight: strong ? 800 : 600 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

export default function TaxPlanner() {
  const [extra, setExtra] = useState(0);
  const { data, isLoading } = useTaxPlanner(extra);

  if (isLoading) return <CircularProgress size={22} />;

  if (!data?.available) {
    return (
      <Alert severity="info">
        Your tax projection appears here once your first payslip has been
        calculated — there is nothing honest to project from until then.
      </Alert>
    );
  }

  const optimum = Number(data.optimum_monthly_cit ?? 0);
  const saved = Number(data.annual_tax_saved);
  // Past the cap, more contribution is pure reduction in take-home pay. The
  // slider goes a little beyond so somebody can *see* the curve flatten rather
  // than being stopped at a wall they have to trust.
  const max = Math.max(Math.ceil((optimum * 1.5) / 500) * 500, 5000);

  return (
    <Box>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 1 }}>
        <CalculateIcon fontSize="small" color="disabled" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Tax planner
        </Typography>
      </Stack>

      {/* Named, not implied. Somebody has to be able to judge whether "this
          month repeated" is a fair picture of their year. */}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        Projected from {data.based_on.period_year}-
        {String(data.based_on.period_month).padStart(2, "0")}
        {data.based_on.is_draft ? " (still a draft)" : ""}, repeated across the
        year. A raise, a bonus or unpaid leave will change it.
      </Typography>

      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", mb: 2 }} useFlexGap>
        <Figure label="Taxable this year" value={moneyRounded(data.annual_taxable)} />
        <Figure
          label="Tax as things stand"
          value={moneyRounded(data.current.annual_tax)}
          hint={`${moneyRounded(data.current.monthly_tax)} a month`}
          strong
        />
        <Figure
          label="Already going to funds"
          value={moneyRounded(data.current.annual_contribution)}
          hint={`relief of ${moneyRounded(data.current.relief)}`}
        />
      </Stack>

      {data.offers_cit ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              If you put more into CIT each month
            </Typography>

            <Slider
              value={extra}
              onChange={(_e, v) => setExtra(v as number)}
              min={0}
              max={max}
              step={500}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => moneyRounded(v)}
              // The cap, marked on the track — the moment the line stops paying.
              marks={
                optimum > 0 && optimum <= max
                  ? [{ value: Math.round(optimum), label: "cap" }]
                  : undefined
              }
              sx={{ mt: 1 }}
            />

            <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", mt: 1 }} useFlexGap>
              <Figure label="Extra per month" value={moneyRounded(extra)} />
              <Figure
                label="Tax then"
                value={moneyRounded(data.proposed.annual_tax)}
                hint={`${moneyRounded(data.proposed.monthly_tax)} a month`}
              />
              <Figure
                label="Tax saved"
                value={moneyRounded(saved)}
                hint="over the year"
                strong={saved > 0}
              />
            </Stack>

            {/* The thing nothing else would tell them. */}
            {optimum > 0 ? (
              extra > optimum ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  Past the limit. Anything above{" "}
                  <strong>{moneyRounded(optimum)} a month</strong> saves no further tax
                  — it only reduces your take-home pay.
                </Alert>
              ) : (
                <Alert severity="info" sx={{ mt: 2 }}>
                  You can contribute up to <strong>{moneyRounded(optimum)} more a month</strong>{" "}
                  and still get relief on all of it. Beyond that, extra saves no tax.
                </Alert>
              )
            ) : (
              <Alert severity="info" sx={{ mt: 2 }}>
                Your contributions already reach the relief limit — putting in
                more would not reduce your tax any further.
              </Alert>
            )}
          </CardContent>
        </Card>
      ) : (
        <Alert severity="info">
          Your company does not offer CIT through payroll, so there is nothing to
          adjust here.
        </Alert>
      )}
    </Box>
  );
}
