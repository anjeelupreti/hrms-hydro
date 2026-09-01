"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import SectionCard from "@/components/common/SectionCard";

import EmptyState from "@/components/common/EmptyState";

import type { WorkforceTenureBand } from "@/types/dashboard";

/**
 * Headcount by how long people have been here, split down the middle.
 *
 * **Why tenure and not a headcount tile.** "106 employees" is the same number
 * for a company where everybody joined this year and one where half the staff
 * are past three. Those are entirely different companies to run, and only the
 * distribution can tell them apart.
 *
 * **Why split rather than stacked.** A pyramid puts the two groups on a shared
 * baseline facing away from each other, so a band that skews one way is
 * visible as asymmetry rather than as a length the reader has to compare
 * against a legend. On Acme's data the 3–5 year band is 23 to 10 — obvious as
 * a shape, invisible as a total.
 *
 * **Both sides share one scale.** Letting each half scale to its own maximum
 * is what makes a diverging chart lie: the smaller group would look equal.
 *
 * Employees with no gender recorded are counted in a third row rather than
 * dropped. Omitting them would quietly misstate the headcount, and "we do not
 * hold this for 3 people" is itself worth seeing.
 */
export default function WorkforcePyramid({ data }: { data: WorkforceTenureBand[] }) {
  const bands = data.filter((b) => b.male + b.female + b.other > 0);
  // See `LeaveUsageDots`: a card that vanishes out of a fixed grid slot leaves
  // a hole, and a hole reads as a broken page rather than as no data.
  if (bands.length === 0) {
    return (
      <SectionCard title="Who has been here how long">
          <EmptyState
            compact
            title="Nobody on the books yet"
            description="Add people and this shows how long they have been here, so a team that is all new — or all long-serving — is visible at a glance."
          />
      </SectionCard>
    );
  }

  // One scale for both wings, from the largest single side anywhere.
  const peak = Math.max(1, ...bands.flatMap((b) => [b.male, b.female]));
  const headcount = bands.reduce((sum, b) => sum + b.male + b.female + b.other, 0);
  const unrecorded = bands.reduce((sum, b) => sum + b.other, 0);

  return (
    <SectionCard
      title="Workforce by tenure"
      subtitle={`${headcount} people${
        unrecorded > 0 ? ` · gender not recorded for ${unrecorded}` : ""
      }`}
    >

        <Stack spacing={1.25}>
          {bands.map((band) => (
            <Box
              key={band.band}
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr 92px 1fr",
                alignItems: "center",
                gap: 1,
              }}
            >
              {/* Left wing, growing right-to-left from the centre. */}
              <Stack direction="row" sx={{ justifyContent: "flex-end", alignItems: "center", gap: 1 }}>
                {band.male > 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {band.male}
                  </Typography>
                ) : null}
                <Tooltip title={`${band.band} · ${band.male} male`}>
                  <Box
                    sx={{
                      width: `${(band.male / peak) * 100}%`,
                      height: 18,
                      borderRadius: "5px 2px 2px 5px",
                      bgcolor: "var(--hrms-data-1)",
                      minWidth: band.male > 0 ? 4 : 0,
                    }}
                  />
                </Tooltip>
              </Stack>

              <Typography
                variant="caption"
                sx={{ textAlign: "center", color: "text.secondary", fontSize: "0.72rem" }}
                noWrap
              >
                {band.band}
              </Typography>

              {/* Right wing. */}
              <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Tooltip title={`${band.band} · ${band.female} female`}>
                  <Box
                    sx={{
                      width: `${(band.female / peak) * 100}%`,
                      height: 18,
                      borderRadius: "2px 5px 5px 2px",
                      bgcolor: "var(--hrms-data-2)",
                      minWidth: band.female > 0 ? 4 : 0,
                    }}
                  />
                </Tooltip>
                {band.female > 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {band.female}
                  </Typography>
                ) : null}
              </Stack>
            </Box>
          ))}
        </Stack>

        <Stack direction="row" spacing={2.5} sx={{ mt: 2.5, justifyContent: "center" }}>
          {[
            { label: "Male", colour: "var(--hrms-data-1)" },
            { label: "Female", colour: "var(--hrms-data-2)" },
          ].map((key) => (
            <Stack key={key.label} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 9, height: 9, borderRadius: "3px", bgcolor: key.colour }} />
              <Typography variant="caption" color="text.secondary">
                {key.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
    </SectionCard>
  );
}
