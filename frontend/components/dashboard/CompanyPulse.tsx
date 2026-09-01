"use client";

import BadgeIcon from "@mui/icons-material/Badge";
import HomeWorkIcon from "@mui/icons-material/HomeWork";
import Grid from "@mui/material/Grid";

import StatCard from "@/components/dashboard/StatCard";
import { useWfhSummary } from "@/hooks/useWfh";

/**
 * The two work-from-home counts, as secondary tiles on the dashboard.
 *
 * WFH is visible to everyone, so this needs no permission of its own — the
 * summary endpoint is scoped server-side and answers for any signed-in account.
 *
 * **Grid items, not a grid.** It renders bare `<Grid>` items rather than owning
 * a `<Grid container>`, so the caller seats them beside something else. A
 * container of its own would make two numbers a full-width row.
 *
 * Deliberately does not carry hiring counts. `HiringFunnel` sits above this,
 * titled "Where candidates are", with the open-role count in its corner and
 * every candidate drawn by stage — tiles repeating those figures are not
 * emphasis but noise, and a reader who spots the repetition starts checking
 * whether the numbers agree instead of reading either.
 */
export default function CompanyPulse() {
  const { data } = useWfhSummary();
  if (!data) return null;
  return (
    <>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          label="Remote Today"
          value={data.remote_count}
          icon={<HomeWorkIcon />}
          color="secondary"
          hint={`${data.remote_percent}% of active staff`}
          href="/wfh"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          label="WFH Awaiting Approval"
          value={data.pending_count}
          icon={<BadgeIcon />}
          color="warning"
          href="/wfh"
        />
      </Grid>
    </>
  );
}
