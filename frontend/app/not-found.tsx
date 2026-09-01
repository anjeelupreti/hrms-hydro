"use client";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import EmptyState from "@/components/common/EmptyState";
import PageContainer from "@/components/shell/PageContainer";

/**
 * 404.
 *
 * Renders inside the root layout, so the sidebar and top bar come with it and
 * you can navigate away rather than reaching for the back button. That is the
 * whole reason not to use the experimental `global-not-found`, which
 * deliberately bypasses layout rendering — we have one root layout and want it.
 *
 * A Client Component, and it has to be: `component={Link}` passes a *function*
 * to MUI's Button, and functions cannot cross the server→client boundary. As a
 * Server Component this threw "Functions cannot be passed directly to Client
 * Components" on every 404. The trade is losing `export const metadata`, which
 * a 404 does not need.
 */
export default function NotFound() {
  return (
    <PageContainer>
      <Stack sx={{ minHeight: "60vh", justifyContent: "center" }}>
        <EmptyState
          variant="noResults"
          title="That page doesn't exist"
          description={
            <>
              The link may be out of date, or the record may have been deleted. If you followed a
              link from inside the app, that is worth reporting — it means something is pointing
              somewhere it shouldn&apos;t.
            </>
          }
          action={
            <Stack direction="row" spacing={1.5}>
              <Button variant="contained" component={Link} href="/dashboard">
                Go to dashboard
              </Button>
              <Button variant="outlined" component={Link} href="/helpdesk">
                Report it
              </Button>
            </Stack>
          }
        />
        <Typography variant="caption" color="text.disabled" sx={{ textAlign: "center", mt: 2 }}>
          Press <strong>Ctrl K</strong> to search for what you were looking for.
        </Typography>
      </Stack>
    </PageContainer>
  );
}
