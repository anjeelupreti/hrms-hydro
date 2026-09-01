"use client";

/**
 * When the company warns people, and what it says.
 *
 * **What is editable here is deliberately narrow.** Which table a reminder
 * queries and who it reaches is decided in the registry, server-side — that is
 * a database query, and a screen that let somebody write one would be a screen
 * that could read the payroll table. What this offers is the half that is
 * genuinely the customer's: whether it runs, how far ahead, and the wording.
 *
 * **Lead times are chips, not a number field.** One warning is rarely enough
 * and rarely the right distance: a probation wants a month out, when there is
 * still time to arrange a conversation, and again a week out, when there is
 * not. A single number would force two rules for one intention, and two rules
 * drift the first time somebody edits one.
 *
 * The placeholder list is served with each rule rather than hardcoded here, so
 * this screen cannot end up describing a kind wrongly — there is nothing to
 * keep in step.
 */

import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import NotificationsIcon from "@mui/icons-material/Notifications";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  useReminderPreview,
  useReminderRules,
  useUpdateReminderRule,
  type ReminderRule,
} from "@/hooks/useNotifications";
import { useCan } from "@/hooks/useMe";

/** "30 days before" reads; "30" alone does not say before what. */
const leadLabel = (days: number) =>
  days === 0 ? "On the day" : days === 1 ? "1 day before" : `${days} days before`;

function RuleCard({
  rule,
  canManage,
  onError,
}: {
  rule: ReminderRule;
  canManage: boolean;
  onError: (message: string) => void;
}) {
  const update = useUpdateReminderRule();
  const [subject, setSubject] = useState(rule.subject);
  const [body, setBody] = useState(rule.body);
  const [newLead, setNewLead] = useState("");

  async function save(values: Partial<ReminderRule>) {
    try {
      await update.mutateAsync({ id: rule.id, values });
    } catch (err) {
      onError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  function addLead() {
    const days = Number(newLead);
    if (!Number.isInteger(days) || days < 0) return;
    if (rule.lead_days.includes(days)) {
      setNewLead("");
      return;
    }
    // Descending, so the earliest warning reads first — which is the order they
    // actually arrive in.
    save({ lead_days: [...rule.lead_days, days].sort((a, b) => b - a) });
    setNewLead("");
  }

  function removeLead(days: number) {
    const remaining = rule.lead_days.filter((d) => d !== days);
    if (remaining.length === 0) {
      // The server refuses this too. Said here so the answer is immediate and
      // explains itself: a rule that is on and fires never is one somebody
      // believes is working.
      onError("Keep at least one lead time, or switch the reminder off instead.");
      return;
    }
    save({ lead_days: remaining });
  }

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {rule.label}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {rule.description}
            </Typography>
          </Box>
          <Tooltip title={rule.is_enabled ? "Switch off" : "Switch on"}>
            <Switch
              checked={rule.is_enabled}
              disabled={!canManage || update.isPending}
              onChange={(e) => save({ is_enabled: e.target.checked })}
            />
          </Tooltip>
        </Stack>

        {/* Everything below is inert while the rule is off. Editing the wording
            of something that will not be sent is a way to believe you have
            changed something. */}
        <Box sx={{ opacity: rule.is_enabled ? 1 : 0.45, pointerEvents: rule.is_enabled ? "auto" : "none" }}>
          <Divider sx={{ my: 2 }} />

          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Send this many days ahead
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }} useFlexGap>
            {rule.lead_days.map((days) => (
              <Chip
                key={days}
                label={leadLabel(days)}
                variant="outlined"
                color="primary"
                onDelete={canManage ? () => removeLead(days) : undefined}
                deleteIcon={<CloseIcon />}
              />
            ))}
            {canManage ? (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <TextField
                  size="small"
                  type="number"
                  placeholder="days"
                  value={newLead}
                  onChange={(e) => setNewLead(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLead();
                    }
                  }}
                  sx={{ width: 92 }}
                />
                <Button size="small" startIcon={<AddIcon />} onClick={addLead} disabled={!newLead}>
                  Add
                </Button>
              </Stack>
            ) : null}
          </Stack>

          <Stack spacing={2} sx={{ mt: 2.5 }}>
            <TextField
              label="Subject"
              size="small"
              fullWidth
              value={subject}
              disabled={!canManage}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => subject !== rule.subject && save({ subject })}
            />
            <TextField
              label="Message"
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={body}
              disabled={!canManage}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => body !== rule.body && save({ body })}
            />
          </Stack>

          {/* Served with the rule, not hardcoded — this screen cannot describe a
              kind wrongly because there is nothing here to keep in step. */}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            You can use:{" "}
            {rule.variables.map((name) => (
              <Box
                key={name}
                component="code"
                sx={{
                  mr: 0.75,
                  px: 0.5,
                  borderRadius: 0.5,
                  bgcolor: "action.hover",
                  fontSize: 12,
                }}
              >
                {`{${name}}`}
              </Box>
            ))}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function RemindersSettingsPage() {
  const canManage = useCan("settings.manage");
  const { data, isLoading } = useReminderRules();
  const [previewOpen, setPreviewOpen] = useState(false);
  const { data: previews, isFetching } = useReminderPreview(previewOpen);
  const [error, setError] = useState("");

  const rules = data?.results ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Reminders"
        subtitle="What the company warns people about, and how far ahead"
        icon={<NotificationsIcon />}
        actions={
          <Button startIcon={<VisibilityIcon />} onClick={() => setPreviewOpen(true)}>
            Preview today
          </Button>
        }
      />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      {!canManage ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          These are the reminders the company sends. Changing them needs settings
          permission.
        </Alert>
      ) : null}

      {isLoading ? <CircularProgress /> : null}

      {!isLoading && rules.length === 0 ? (
        <EmptyState
          title="No reminders set up"
          description="Run `manage.py seed_reminder_rules` to add the available reminders to this system."
        />
      ) : null}

      {rules.map((rule) => (
        <RuleCard key={rule.id} rule={rule} canManage={canManage} onError={setError} />
      ))}

      <Dialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>What would go out today</DialogTitle>
        <DialogContent dividers>
          {isFetching ? <CircularProgress size={22} /> : null}
          {!isFetching && (previews ?? []).length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              Nothing is due today. That is the usual answer — a reminder fires only
              when something is exactly its lead time away.
            </Typography>
          ) : null}
          <Stack spacing={2} divider={<Divider flexItem />}>
            {(previews ?? []).map((preview, index) => (
              <Box key={`${preview.kind}-${index}`}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
                  <Chip size="small" variant="outlined" label={leadLabel(preview.lead_days)} />
                  <Typography variant="caption" color="text.secondary" noWrap>
                    to {preview.to}
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {preview.subject}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {preview.body}
                </Typography>
              </Box>
            ))}
          </Stack>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
