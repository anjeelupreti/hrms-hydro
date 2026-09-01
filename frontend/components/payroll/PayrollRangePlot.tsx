"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { moneyRounded } from "@/lib/format/money";

/**
 * What each run cost, drawn as the distance between gross and net.
 *
 * **Why a range plot.** A payroll run has three figures — gross, deductions
 * and net — and deductions is not a third measure but *the gap between the
 * other two*. A range plot draws that gap as a length, so the thing finance
 * asks about is on screen rather than a subtraction the reader performs.
 *
 * Counting payslips per run instead says how many people were paid and nothing
 * about the money, and barely moves month to month because it is headcount.
 *
 * Three bars per period would state the same numbers and hide the relationship;
 * a stacked bar would imply gross and net sum to something, which they do not.
 *
 * **One scale across every period**, anchored at zero. Scaling each row to its
 * own maximum is the standard way to make a range plot lie: a month that cost
 * half as much would draw the same width.
 *
 * Plain CSS. A row of proportional bars needs no axes and no rendering
 * pipeline, and this page already mounts a chart library once.
 */

export type PayrollPeriodRange = {
  id: number;
  label: string;
  gross: number;
  net: number;
};


export default function PayrollRangePlot({
  periods,
  onOpen,
}: {
  periods: PayrollPeriodRange[];
  onOpen?: (id: number) => void;
}) {
  const rows = periods.filter((p) => p.gross > 0);
  if (rows.length === 0) return null;

  const peak = Math.max(...rows.map((p) => p.gross));
  const totalDeducted = rows.reduce((sum, p) => sum + (p.gross - p.net), 0);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Gross to net, by period
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2.5 }}>
          The bar is what was withheld — {moneyRounded(totalDeducted)} across {rows.length} period
          {rows.length === 1 ? "" : "s"}
        </Typography>

        <Stack spacing={1.75}>
          {rows.map((period) => {
            const deducted = period.gross - period.net;
            // Positions as a share of the widest gross, so rows are comparable.
            const netLeft = 0;
            const netWidth = (period.net / peak) * 100;
            const grossWidth = (period.gross / peak) * 100;

            return (
              <Box
                key={period.id}
                onClick={onOpen ? () => onOpen(period.id) : undefined}
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "84px 1fr", sm: "104px 1fr" },
                  alignItems: "center",
                  gap: 1.5,
                  cursor: onOpen ? "pointer" : "default",
                  borderRadius: 1.5,
                  p: 0.5,
                  "&:hover": onOpen ? { bgcolor: "action.hover" } : undefined,
                }}
              >
                <Typography variant="caption" color="text.secondary" noWrap title={period.label}>
                  {period.label}
                </Typography>

                <Box sx={{ position: "relative", height: 22 }}>
                  {/* The track: zero to this period's gross. */}
                  <Box
                    sx={{
                      position: "absolute",
                      left: `${netLeft}%`,
                      width: `${grossWidth}%`,
                      top: "50%",
                      transform: "translateY(-50%)",
                      height: 10,
                      borderRadius: "5px",
                      bgcolor: "action.hover",
                    }}
                  />

                  {/* The withheld span — net to gross. This is the plot. */}
                  <Tooltip
                    title={`Deductions ${moneyRounded(deducted)} · gross ${moneyRounded(period.gross)} · net ${moneyRounded(period.net)}`}
                  >
                    <Box
                      sx={{
                        position: "absolute",
                        left: `${netWidth}%`,
                        width: `${Math.max(0, grossWidth - netWidth)}%`,
                        top: "50%",
                        transform: "translateY(-50%)",
                        height: 10,
                        borderRadius: "5px",
                        bgcolor: "var(--hrms-data-3)",
                      }}
                    />
                  </Tooltip>

                  {/* Endpoints. Net is the accent because it is the figure
                      that actually leaves the company. */}
                  <Tooltip title={`Net ${moneyRounded(period.net)}`}>
                    <Box
                      sx={{
                        position: "absolute",
                        left: `calc(${netWidth}% - 2px)`,
                        top: 0,
                        width: 4,
                        height: 22,
                        borderRadius: "2px",
                        bgcolor: "primary.main",
                      }}
                    />
                  </Tooltip>
                  <Tooltip title={`Gross ${moneyRounded(period.gross)}`}>
                    <Box
                      sx={{
                        position: "absolute",
                        left: `calc(${grossWidth}% - 2px)`,
                        top: 0,
                        width: 4,
                        height: 22,
                        borderRadius: "2px",
                        bgcolor: "text.disabled",
                      }}
                    />
                  </Tooltip>
                </Box>
              </Box>
            );
          })}
        </Stack>

        <Stack direction="row" spacing={2.5} sx={{ mt: 2.5, flexWrap: "wrap" }}>
          {[
            { label: "Net paid", colour: "primary.main" },
            { label: "Withheld", colour: "var(--hrms-data-3)" },
            { label: "Gross", colour: "text.disabled" },
          ].map((key) => (
            <Stack key={key.label} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 9, height: 9, borderRadius: "3px", bgcolor: key.colour }} />
              <Typography variant="caption" color="text.secondary">
                {key.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
