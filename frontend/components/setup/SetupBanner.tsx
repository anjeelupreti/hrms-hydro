"use client";

/**
 * "You are not set up yet", where somebody will actually see it.
 *
 * **The setup page only helps the company who knows to go there.** A new workspace
 * lands on the dashboard, and the failure this exists to prevent is a company
 * discovering at the end of the month that payroll could never have run — so
 * the prompt has to come to them.
 *
 * **It disappears completely once the essentials are done.** A banner that
 * lingers to nag about a logo is a banner people learn to look past, and then
 * it is not there when it matters. Recommended steps are the setup page's job,
 * not this one's.
 */

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { useCan } from "@/hooks/useMe";
import { useSetupReadiness } from "@/hooks/useSetup";

export default function SetupBanner() {
  const { data } = useSetupReadiness();
  const canManage = useCan("settings.manage");

  // Nothing while loading, nothing when ready, and nothing for somebody who
  // could not act on it — three separate reasons, all of them "render null".
  if (!data || data.is_ready || !canManage) return null;

  const next = data.blocking[0];

  return (
    <Alert
      severity="warning"
      sx={{ mb: 3 }}
      action={
        <Button
          component={Link}
          href="/setup"
          size="small"
          endIcon={<ArrowForwardIcon />}
          sx={{ whiteSpace: "nowrap" }}
        >
          Finish setup
        </Button>
      }
    >
      <AlertTitle sx={{ fontWeight: 700 }}>
        {data.must_done} of {data.must_total} essential steps done
      </AlertTitle>
      <Stack spacing={1}>
        <Typography variant="body2">
          {/* Named, not counted. "4 steps remaining" tells somebody how much is
              left; the next step's title tells them what to do now. */}
          Payroll cannot be run correctly until these are finished — next up is{" "}
          <strong>{next?.title.toLowerCase()}</strong>.
        </Typography>
        <LinearProgress
          variant="determinate"
          value={data.percent}
          color="warning"
          sx={{ height: 6, borderRadius: 3, maxWidth: 320 }}
        />
      </Stack>
    </Alert>
  );
}
