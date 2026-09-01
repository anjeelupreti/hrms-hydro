"use client";

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import PaymentsIcon from "@mui/icons-material/Payments";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Amount from "@/components/common/Amount";
import DeltaBadge from "@/components/common/DeltaBadge";
import MiniBars from "@/components/common/MiniBars";
import { CURRENCY_PREFIX, money } from "@/lib/format/money";
import Link from "next/link";

import type { PayrollSummary } from "@/types/dashboard";

const STATUS_COLOR: Record<string, "default" | "info" | "success" | "error"> = {
  draft: "default",
  processing: "info",
  completed: "success",
  failed: "error",
};

export default function PayrollSummaryCard({ data }: { data: PayrollSummary }) {
  if (!data) return null;
  const latest = data.latest;
  const history = data.history ?? [];

  // Only when there is a previous run to compare against, and only when it was
  // not zero — a percentage change from nothing is not a percentage.
  const previous = history.length > 1 ? history[history.length - 2].net_total : null;
  const change =
    previous && previous > 0 && latest
      ? ((latest.net_total - previous) / previous) * 100
      : null;

  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <PaymentsIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Payroll
            </Typography>
          </Stack>
          {data.draft_count > 0 && <Chip size="small" color="warning" label={`${data.draft_count} draft`} />}
        </Stack>

        {latest ? (
          <>
            <Typography variant="caption" color="text.secondary">
              Latest run
            </Typography>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mt: 0.5 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {latest.period_label}
              </Typography>
              <Chip size="small" label={latest.status} color={STATUS_COLOR[latest.status] ?? "default"} />
            </Stack>
            <Box sx={{ mt: 1.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
                <Typography className="hrms-display-num" variant="h5" sx={{ fontWeight: 800 }}>
                  <Amount value={money(latest.net_total)} prefix={CURRENCY_PREFIX} />
                </Typography>
                {/* Against the run before it, not against nothing. A payroll
                    that jumped 18% is the only thing on this card worth acting
                    on, and it was invisible while the card showed one figure. */}
                {change !== null ? (
                  <DeltaBadge value={change} comparedTo="last run" />
                ) : null}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                net across {latest.payslip_count} payslip{latest.payslip_count === 1 ? "" : "s"}
              </Typography>

              {/* **Bars, not a line.** Each run is a discrete event in its own
                  period; a line between them would draw values for weeks when
                  no payroll existed. `MiniBars` was built for exactly this and
                  had never been used anywhere. */}
              {history.length > 1 ? (
                <Box sx={{ mt: 1.75 }}>
                  <MiniBars
                    data={history.map((run) => run.net_total)}
                    height={34}
                    barWidth={10}
                    gap={5}
                    label={`Net payroll over the last ${history.length} runs`}
                  />
                  <Stack
                    direction="row"
                    sx={{ justifyContent: "space-between", mt: 0.5 }}
                  >
                    <Typography variant="caption" color="text.disabled">
                      {history[0].period_label}
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      {history[history.length - 1].period_label}
                    </Typography>
                  </Stack>
                </Box>
              ) : null}
            </Box>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ my: 2 }}>
            No payroll runs yet.
          </Typography>
        )}

        <Button component={Link} href="/payroll" size="small" endIcon={<ArrowForwardIcon />} sx={{ mt: 1.5 }}>
          Open payroll
        </Button>
      </CardContent>
    </Card>
  );
}
