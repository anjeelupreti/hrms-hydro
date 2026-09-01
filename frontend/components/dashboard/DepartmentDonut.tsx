"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { PieChart } from "@mui/x-charts/PieChart";

import SectionCard from "@/components/common/SectionCard";

import { foldSeries, seriesColor } from "@/lib/theme/chartSeries";
import type { DepartmentDistributionEntry } from "@/types/dashboard";

/**
 * Headcount by department.
 *
 * Hues come from the validated series ramp as CSS variables, assigned in fixed
 * order, with the tail folded into "Other". Three rules sit behind that, and
 * breaking any of them is invisible in light mode:
 *
 *  - **CSS variables, not `theme.palette.*` read in JS.** Under `cssVariables`
 *    a JS read resolves against the *default* scheme, so wedges keep their
 *    light-mode colours on a dark page. The ramp is emitted per scheme.
 *  - **No status colours.** `error.main` as a categorical slot says a
 *    department is critical. Red is reserved for state.
 *  - **No cycling.** `palette[i % palette.length]` paints the 7th department
 *    identically to the 1st, which is worse than running out.
 */
export default function DepartmentDonut({ data }: { data: DepartmentDistributionEntry[] }) {
  const slices = foldSeries(
    data,
    (d) => d.count,
    (d) => d.department
  );
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <SectionCard title="Headcount by department">

        {total === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No employees to show.
          </Typography>
        ) : (
          // Wraps rather than forcing a row: the donut is a fixed 190px, so in
          // a narrow grid column a row layout left the legend ~100px and its
          // department names truncated to "Engin…" / "Marke…". Wrapping puts
          // the legend under the donut instead, with the full card width.
          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 2 }}
          >
            {/* The hole is not decoration — it is where the total goes, so the
                headline figure is read before any wedge is compared. */}
            <Box sx={{ position: "relative", flexShrink: 0, mx: "auto" }}>
              <PieChart
                height={190}
                width={190}
                hideLegend
                series={[
                  {
                    data: slices.map((s, i) => ({
                      id: s.label,
                      value: s.value,
                      label: s.label,
                      // Muted grey for "Other": it is a remainder, not an identity.
                      color: s.isOther ? "var(--mui-palette-text-disabled)" : seriesColor(i),
                    })),
                    innerRadius: 62,
                    // A surface-coloured gap between wedges, per the mark spec.
                    paddingAngle: 2,
                    cornerRadius: 4,
                    highlightScope: { fade: "global", highlight: "item" },
                  },
                ]}
              />
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  pointerEvents: "none",
                }}
              >
                <Box sx={{ textAlign: "center" }}>
                  <Typography className="hrms-display-num" sx={{ fontSize: "1.6rem", fontWeight: 800, lineHeight: 1 }}>
                    {total}
                  </Typography>
                  <Typography variant="overline" color="text.secondary">
                    people
                  </Typography>
                </Box>
              </Box>
            </Box>

            {/* Legend doubles as the data table — identity is never colour
                alone, and the share is stated rather than estimated. */}
            <Stack spacing={1} sx={{ flex: "1 1 190px", minWidth: 0 }}>
              {slices.map((s, i) => (
                <Stack
                  key={s.label}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", justifyContent: "space-between" }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
                    <Box
                      aria-hidden
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        flexShrink: 0,
                        bgcolor: s.isOther ? "text.disabled" : seriesColor(i),
                      }}
                    />
                    {/* Not `noWrap`: a truncated department name is not an
                        identity, and this legend is also the data table. */}
                    <Typography variant="body2">{s.label}</Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexShrink: 0 }}>
                    <Typography variant="body2" className="hrms-num" sx={{ fontWeight: 600 }}>
                      {s.value}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" className="hrms-num">
                      {Math.round((s.value / total) * 100)}%
                    </Typography>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Stack>
        )}
    </SectionCard>
  );
}
