"use client";

import EmailIcon from "@mui/icons-material/Email";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotificationsIcon from "@mui/icons-material/Notifications";
import PhoneIphoneIcon from "@mui/icons-material/PhoneIphone";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useNotifications";
import { usePushSubscription } from "@/hooks/usePushSubscription";

export default function NotificationSettingsPage() {
  const { data: prefs } = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const push = usePushSubscription();

  async function handlePushToggle(enabled: boolean) {
    try {
      if (enabled) await push.subscribe();
      else await push.unsubscribe();
    } catch {
      /* push.error holds a message */
    }
  }

  return (
    <PageContainer>
      <Box sx={{ maxWidth: 720, mx: "auto" }}>
        <PageHeader
          title="Notifications"
          subtitle="Choose how you want to be reached"
          icon={<NotificationsIcon />}
        />
        {push.error && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {push.error}
          </Alert>
        )}
        <Card>
          <Row
            icon={<EmailIcon />}
            title="Email notifications"
            description="Leave decisions, payroll, reminders and more, sent to your inbox."
            checked={prefs?.email_enabled ?? false}
            onChange={(v) => update.mutate({ email_enabled: v })}
          />
          <Divider />
          <Row
            icon={<NotificationsActiveIcon />}
            title="In-app notifications"
            description="The bell in the top bar and your notifications feed."
            checked={prefs?.in_app_enabled ?? false}
            onChange={(v) => update.mutate({ in_app_enabled: v })}
          />
          <Divider />
          <Row
            icon={<PhoneIphoneIcon />}
            title="Device push notifications"
            description="Browser/desktop push — asks for permission the first time you enable it."
            checked={prefs?.push_enabled ?? false}
            disabled={push.busy}
            onChange={handlePushToggle}
          />
        </Card>
      </Box>
    </PageContainer>
  );
}

function Row({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center", p: 2.5 }}>
      <Box
        sx={{
          width: 42,
          height: 42,
          borderRadius: 2.5,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "transparent", color: "primary.main", border: "1.5px solid", borderColor: "primary.main",
        }}
      >
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      </Box>
      <Switch checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </Stack>
  );
}
