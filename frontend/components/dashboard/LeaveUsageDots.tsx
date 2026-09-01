"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import SectionCard from "@/components/common/SectionCard";

import EmptyState from "@/components/common/EmptyState";
import type { LeaveUsageRow } from "@/types/dashboard";

/**
 * Leave taken against leave allowed, one line per department.
 *
 * The track is the entitlement, the dot is what has been used. A team near its
 * limit sits near the end of its line, so "is anyone running out" is read by
 * eye instead of by dividing two numbers.
 *
 * A bare total cannot answer that: "900 days taken" means one thing for a team
 * of forty and another for a team of six.
 *
 * Each track is its own 100%, not a shared scale. Allowances differ wildly —
 * Engineering has 2,084 days against Human Resources' 322 — and one scale
 * squashes the small teams to a stub. The figures beside each line carry the
 * absolute size.
 *
 * Entitlement includes carried-forward days: somebody holding five days from
 * last year really does have five more to take, and measuring against this
 * year's allocation alone would report them over a limit they are under.
 */

/** Past this, a department is worth a second look rather than an alarm. */
const HIGH_USAGE = 75;

export default function LeaveUsageDots({ data }: { data: LeaveUsageRow[] }) {
  // A card in a fixed grid slot renders an empty state rather than `null`. An
  // absent card leaves a hole in the row, which reads as a broken layout rather
  // than as "there is nothing to show".
  if (!data || data.length === 0) {
    return (
      <SectionCard title="Leave used against entitlement">
        <EmptyState
          compact
          title="No leave taken yet"
          description="Once people start booking time off, each department appears here with how far through its allowance it is."
        />
      </SectionCard>
    );
  }

  // A department with no entitlement has no position on this scale — there is
  // nothing to be a fraction of. That is an ordinary state: a new workspace has
  // departments before it has leave types assigned to them. Those rows are held
  // out and counted in the subtitle instead. Dividing anyway yields `NaN`, which
  // sorts unpredictably and positions the dot at `calc(NaN% - 7px)`, which the
  // browser drops — leaving a track with no dot on it.
  const withAllowance = data.filter((row) => row.allowed > 0);
  const unallocated = data.length - withAllowance.length;

  if (withAllowance.length === 0) {
    return (
      <SectionCard title="Leave used against entitlement">
        <EmptyState
          compact
          title="No leave entitlement set yet"
          description="Assign leave types to departments and this shows how far through its allowance each one is."
        />
      </SectionCard>
    );
  }

  const rows = [...withAllowance].sort((a, b) => b.used / b.allowed - a.used / a.allowed);
  const busiest = rows[0];
  const busiestPct = Math.round((busiest.used / busiest.allowed) * 100);

  return (
    <SectionCard
      title="Leave used against entitlement"
      subtitle={`${busiest.department} is furthest through at ${busiestPct}% · this fiscal year${
        unallocated > 0
          ? ` · ${unallocated} department${unallocated === 1 ? "" : "s"} with no entitlement set`
          : ""
      }`}
    >

        <Stack spacing={1.75}>
          {rows.map((row) => {
            const pct = Math.min(100, (row.used / row.allowed) * 100);
            const heavy = pct >= HIGH_USAGE;
            return (
              <Box
                key={row.department}
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "88px 1fr 56px", sm: "128px 1fr 64px" },
                  alignItems: "center",
                  gap: 1.5,
                }}
              >
                <Typography variant="caption" color="text.secondary" noWrap title={row.department}>
                  {row.department}
                </Typography>

                <Box sx={{ position: "relative", height: 14 }}>
                  <Box
                    sx={{
                      position: "absolute",
                      inset: "4px 0",
                      borderRadius: "3px",
                      bgcolor: "action.hover",
                    }}
                  />
                  <Tooltip
                    title={`${row.used} of ${row.allowed} days used${
                      heavy ? " — worth a look" : ""
                    }`}
                  >
                    <Box
                      sx={{
                        position: "absolute",
                        left: `calc(${pct}% - 7px)`,
                        top: 0,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        bgcolor: heavy ? "var(--hrms-status-warning-solid)" : "primary.main",
                        border: "2px solid",
                        borderColor: "background.paper",
                        transition: "transform .15s",
                        "&:hover": { transform: "scale(1.25)" },
                      }}
                    />
                  </Tooltip>
                </Box>

                <Typography
                  variant="caption"
                  sx={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: heavy ? 700 : 500,
                    color: heavy ? "var(--hrms-status-warning-fg)" : "text.secondary",
                  }}
                >
                  {Math.round(pct)}%
                </Typography>
              </Box>
            );
          })}
        </Stack>
    </SectionCard>
  );
}
