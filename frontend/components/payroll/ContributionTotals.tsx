"use client";

/**
 * How much has gone into the funds so far this year.
 *
 * **The question that had no answer.** Nothing recorded cumulative
 * contributions, and summing payslip line items could never answer it either:
 * a line item points at a component the company named, so renaming "Provident
 * Fund" lost the history. These totals are keyed on the *scheme*.
 *
 * **Both sides are shown, and labelled as different things.** The employee's
 * own contribution is what they need at filing time; the employer's is a
 * company liability that never left their pay. Adding them into one figure
 * would overstate what somebody contributed, which is exactly the number
 * people check.
 */

import SavingsIcon from "@mui/icons-material/Savings";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Amount from "@/components/common/Amount";
import EmptyState from "@/components/common/EmptyState";
import { useContributionTotals } from "@/hooks/usePayroll";

export default function ContributionTotals({
  employeeId,
  fiscalYear,
  /** "you" on the portal, "they" on somebody else's record. */
  pronoun = "you",
}: {
  employeeId?: number | null;
  fiscalYear?: number;
  pronoun?: "you" | "they";
}) {
  const { data, isLoading } = useContributionTotals(employeeId, fiscalYear);

  if (isLoading) return <CircularProgress size={22} />;

  const schemes = data?.schemes ?? [];

  if (schemes.length === 0) {
    return (
      <EmptyState
        compact
        title="Nothing contributed yet"
        description={
          pronoun === "you"
            ? "Once your company sets up a retirement fund, what you and they pay in appears here."
            : "Nothing has been paid into a fund for this person yet."
        }
      />
    );
  }

  return (
    <Box>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 1 }}>
        <SavingsIcon fontSize="small" color="disabled" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Paid into funds this year
        </Typography>
      </Stack>

      <Stack spacing={0}>
        {schemes.map((row) => (
          <Stack
            key={row.scheme}
            direction="row"
            spacing={2}
            sx={{
              py: 1.25,
              alignItems: "baseline",
              borderTop: "1px solid",
              borderColor: "divider",
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
              {row.label}
            </Typography>

            <Box sx={{ textAlign: "right", minWidth: 110 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {pronoun === "you" ? "You paid" : "They paid"}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                <Amount personal value={row.employee_total} />
              </Typography>
            </Box>

            {/* Kept visually separate rather than summed — it never came out of
                their pay, and merging the two overstates what they contributed. */}
            <Box sx={{ textAlign: "right", minWidth: 110 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                Employer paid
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <Amount personal value={row.employer_total} />
              </Typography>
            </Box>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
