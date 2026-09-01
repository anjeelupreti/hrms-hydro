"use client";

/**
 * What this system still has to configure.
 *
 * **The screen a new deployment most needs and we did not have.** Before this, a
 * company signed up, landed in an empty workspace, and found out what was
 * missing when something failed — which for payroll means finding out after the
 * money is wrong.
 *
 * **The percentage counts must-haves only**, and that is a deliberate choice
 * rather than an oversight. A company that has done everything standing between
 * them and paying people correctly *is* ready; telling them they are at 71%
 * because there is no logo turns the one number that matters into decoration
 * nobody reads. Recommended and advanced progress is shown, just not folded in.
 *
 * **Must-haves have no Skip button, and the server refuses one anyway.** A tier
 * whose entries can be waved through is a recommendation wearing a badge.
 */

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useCan } from "@/hooks/useMe";
import { useSetupReadiness, useSkipSetupCheck } from "@/hooks/useSetup";
import { TIER_LABEL, type SetupCheck, type SetupTier } from "@/types/setup";

function CheckRow({
  check,
  canManage,
  onSkip,
  onUndo,
}: {
  check: SetupCheck;
  canManage: boolean;
  onSkip: (check: SetupCheck) => void;
  onUndo: (check: SetupCheck) => void;
}) {
  const settled = check.done || check.skipped;

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "flex-start",
        py: 1.5,
        borderTop: "1px solid",
        borderColor: "divider",
      }}
    >
      <Box sx={{ pt: 0.25, color: check.done ? "success.main" : "text.disabled" }}>
        {check.done ? (
          <CheckCircleIcon fontSize="small" />
        ) : check.skipped ? (
          <Tooltip title={check.skip_reason ?? ""}>
            <RemoveCircleIcon fontSize="small" />
          </Tooltip>
        ) : (
          <RadioButtonUncheckedIcon fontSize="small" />
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: settled ? "text.secondary" : "text.primary",
              textDecoration: check.skipped ? "line-through" : "none",
            }}
          >
            {check.title}
          </Typography>
          <Chip size="small" variant="outlined" label={check.domain} sx={{ height: 18, fontSize: 10 }} />
          {check.skipped ? (
            <Chip size="small" color="default" label="Skipped" sx={{ height: 18, fontSize: 10 }} />
          ) : null}
        </Stack>

        {/* The consequence, not the requirement — somebody reading this is
            deciding whether to care, and "working days not configured" does not
            help them decide. */}
        {!check.done ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            {check.skipped ? `Skipped — ${check.skip_reason}` : check.why}
          </Typography>
        ) : null}
      </Box>

      <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
        {!check.done ? (
          <Button size="small" component={Link} href={check.href}>
            {check.skipped ? "Do it" : "Set up"}
          </Button>
        ) : null}
        {canManage && !check.done && check.skippable && !check.skipped ? (
          <Button size="small" color="inherit" onClick={() => onSkip(check)}>
            Skip
          </Button>
        ) : null}
        {canManage && check.skipped ? (
          <Button size="small" color="inherit" onClick={() => onUndo(check)}>
            Undo
          </Button>
        ) : null}
      </Stack>
    </Stack>
  );
}

export default function SetupPage() {
  const { data, isLoading, error } = useSetupReadiness();
  const canManage = useCan("settings.manage");
  const skip = useSkipSetupCheck();

  const [skipping, setSkipping] = useState<SetupCheck | null>(null);
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState("");

  async function confirmSkip() {
    if (!skipping || !reason.trim()) return;
    setSaveError("");
    try {
      await skip.mutateAsync({ key: skipping.key, reason: reason.trim() });
      setSkipping(null);
      setReason("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  async function undo(check: SetupCheck) {
    setSaveError("");
    try {
      await skip.mutateAsync({ key: check.key, skip: false });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  if (isLoading) {
    return (
      <PageContainer>
        <CircularProgress />
      </PageContainer>
    );
  }
  if (error || !data) {
    return (
      <PageContainer>
        <Alert severity="error">Setup status could not be loaded.</Alert>
      </PageContainer>
    );
  }

  const tiers: SetupTier[] = ["must", "recommended", "advanced"];

  return (
    <PageContainer>
      <PageHeader
        title="Set up your"
        subtitle="What still needs configuring before your first payroll"
        icon={<RocketLaunchIcon />}
      />

      {saveError ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError("")}>
          {saveError}
        </Alert>
      ) : null}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 1.5 }}>
            <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1 }}>
              {data.percent}%
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {data.is_ready ? "Ready to run payroll" : "Not ready yet"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {data.must_done} of {data.must_total} essentials done
                {data.optional_total > 0
                  ? ` · ${data.optional_settled} of ${data.optional_total} of the rest`
                  : ""}
              </Typography>
            </Box>
          </Stack>

          <LinearProgress
            variant="determinate"
            value={data.percent}
            color={data.is_ready ? "success" : "primary"}
            sx={{ height: 8, borderRadius: 4 }}
          />

          {/* Names what is actually in the way, rather than leaving somebody to
              scan three lists for it. */}
          {!data.is_ready ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              <strong>
                {data.blocking.length} essential {data.blocking.length === 1 ? "step" : "steps"} left.
              </strong>{" "}
              Until {data.blocking.length === 1 ? "it is" : "they are"} done, payroll cannot be run
              correctly — start with {data.blocking[0]?.title.toLowerCase()}.
            </Alert>
          ) : (
            <Alert severity="success" sx={{ mt: 2 }}>
              Everything essential is configured. The rest can be done whenever it suits you.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Stack spacing={3}>
        {tiers.map((tier) => {
          const rows = data.tiers[tier] ?? [];
          // An advanced tier with nothing in it is not information — it is a
          // heading for a module this company does not use.
          if (rows.length === 0) return null;
          const done = rows.filter((c) => c.done || c.skipped).length;

          return (
            <Box key={tier}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.5 }}
              >
                <Typography variant="overline" color="text.secondary">
                  {TIER_LABEL[tier]}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {done} of {rows.length}
                </Typography>
              </Stack>
              <Card variant="outlined">
                <CardContent sx={{ pt: 0.5, "&:last-child": { pb: 1 } }}>
                  {rows.map((check) => (
                    <CheckRow
                      key={check.key}
                      check={check}
                      canManage={canManage}
                      onSkip={(c) => {
                        setSkipping(c);
                        setReason("");
                      }}
                      onUndo={undo}
                    />
                  ))}
                </CardContent>
              </Card>
            </Box>
          );
        })}
      </Stack>

      <Dialog open={Boolean(skipping)} onClose={() => setSkipping(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Skip “{skipping?.title}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {skipping?.why}
          </Typography>
          {/* Required, because a skip with no reason is indistinguishable from
              an oversight three months later — to somebody who was not there. */}
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Why are you skipping this?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            helperText="Whoever reviews this later will not have been in the room."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSkipping(null)}>Cancel</Button>
          <Button variant="contained" disabled={!reason.trim() || skip.isPending} onClick={confirmSkip}>
            Skip for now
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
