"use client";

import BusinessIcon from "@mui/icons-material/Business";
import LockIcon from "@mui/icons-material/Lock";
import NotificationsIcon from "@mui/icons-material/Notifications";
import PaletteIcon from "@mui/icons-material/Palette";
import ColourPicker from "@/components/common/ColourPicker";
import { DENSITY_OPTIONS, SIDEBAR_MODES, useThemeStore } from "@/lib/store/theme";
import PersonIcon from "@mui/icons-material/Person";
import SettingsIcon from "@mui/icons-material/Settings";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useColorScheme } from "@mui/material/styles";
import Link from "next/link";
import { useState } from "react";

import OrganizationTab from "@/components/settings/OrganizationTab";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useChangePassword } from "@/hooks/useAccount";
import { roleLabel, useCan, useMe } from "@/hooks/useMe";
import TwoFactorCard from "@/components/settings/TwoFactorCard";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useNotifications";
import { useMyProfile } from "@/hooks/useProfile";
import { usePushSubscription } from "@/hooks/usePushSubscription";

export default function SettingsPage() {
  const [tab, setTab] = useState(0);
  const isHR = useCan("settings.manage");

  return (
    <PageContainer>
      <Box sx={{ maxWidth: 820, mx: "auto" }}>
        <PageHeader title="Settings" subtitle="Manage your account and preferences" icon={<SettingsIcon />} />
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
          <Tab icon={<PersonIcon fontSize="small" />} iconPosition="start" label="Account" />
          <Tab icon={<PaletteIcon fontSize="small" />} iconPosition="start" label="Appearance" />
          <Tab icon={<LockIcon fontSize="small" />} iconPosition="start" label="Security" />
          <Tab icon={<NotificationsIcon fontSize="small" />} iconPosition="start" label="Notifications" />
          {isHR && <Tab icon={<BusinessIcon fontSize="small" />} iconPosition="start" label="Organization" />}
        </Tabs>
        {tab === 0 && <AccountTab />}
        {tab === 1 && <AppearanceTab />}
        {tab === 2 && <SecurityTab />}
        {tab === 3 && <NotificationsTab />}
        {tab === 4 && isHR && <OrganizationTab />}
      </Box>
    </PageContainer>
  );
}

function AppearanceTab() {
  const { mode, setMode } = useColorScheme();
  const sidebarMode = useThemeStore((s) => s.sidebarMode);
  const showAppearanceTab = useThemeStore((s) => s.showAppearanceTab);
  const setShowAppearanceTab = useThemeStore((s) => s.setShowAppearanceTab);
  const setSidebarMode = useThemeStore((s) => s.setSidebarMode);
  const density = useThemeStore((s) => s.density);
  const setDensity = useThemeStore((s) => s.setDensity);

  return (
    <Card>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Theme
        </Typography>
        <Box sx={{ mt: 1, mb: 3 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode ?? "system"}
            onChange={(_, v) => v && setMode(v)}
          >
            <ToggleButton value="light">Light</ToggleButton>
            <ToggleButton value="dark">Dark</ToggleButton>
            <ToggleButton value="system">System</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            &ldquo;System&rdquo; follows your device&apos;s light/dark preference.
          </Typography>
        </Box>

        <Divider sx={{ mb: 2.5 }} />

        {/* Accent colour picker */}
        <ColourPicker />

        <Divider sx={{ my: 2.5 }} />

        <Typography variant="overline" color="text.secondary">
          Sidebar
        </Typography>
        <Box sx={{ mt: 1, mb: 3 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={sidebarMode}
            onChange={(_, v) => v && setSidebarMode(v)}
          >
            {SIDEBAR_MODES.map((m) => (
              <ToggleButton key={m.value} value={m.value}>
                {m.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            {SIDEBAR_MODES.find((m) => m.value === sidebarMode)?.hint}
          </Typography>
        </Box>

        {/* The way back. A dismiss with no restore is a trap — somebody hides
            the edge tab, later wants it, and has no idea it was ever a setting.
            Placed here because this is where they will look. */}
        <Typography variant="overline" color="text.secondary">
          Appearance shortcut
        </Typography>
        <Box sx={{ mt: 1, mb: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={showAppearanceTab}
                onChange={(e) => setShowAppearanceTab(e.target.checked)}
              />
            }
            label="Show the appearance tab on the right edge"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            The floating tab that opens these settings from any page. Right-click it to
            hide it; everything it offers is also on this screen.
          </Typography>
        </Box>

        <Typography variant="overline" color="text.secondary">
          Density
        </Typography>
        <Box sx={{ mt: 1 }}>
          <ToggleButtonGroup exclusive size="small" value={density} onChange={(_, v) => v && setDensity(v)}>
            {DENSITY_OPTIONS.map((o) => (
              <ToggleButton key={o.value} value={o.value}>
                {o.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Row height across tables and lists. Compact fits roughly 40% more rows on screen.
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function AccountTab() {
  const { data: me } = useMe();
  const { data: profile } = useMyProfile(Boolean(me?.employee_id));
  const name = profile?.full_name || me?.username || "";

  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 3 }}>
          <Avatar src={profile?.photo ?? undefined} sx={{ width: 64, height: 64, fontSize: 22, bgcolor: "transparent", color: "primary.main", border: "1.5px solid", borderColor: "primary.main" }}>
            {initials(name)}
          </Avatar>
          <Box>
            <Typography variant="h6">{name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {me?.email}
            </Typography>
            <Chip size="small" sx={{ mt: 0.5 }} label={roleLabel(me?.role)} color={me?.role === "employee" ? "default" : "primary"} />
          </Box>
        </Stack>
        <Divider sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Your name, photo, bio, skills and personal details are managed on your profile.
        </Typography>
        <Button component={Link} href="/profile" variant="contained" startIcon={<PersonIcon />}>
          Edit full profile
        </Button>
      </CardContent>
    </Card>
  );
}

function SecurityTab() {
  const changePassword = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSuccess(false);
    if (next !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    try {
      await changePassword.mutateAsync({ old_password: current, new_password: next });
      setSuccess(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
    <Card>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Change password
        </Typography>
        {error && (
          <Alert severity="error" sx={{ my: 2 }}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ my: 2 }}>
            Password updated.
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 2, maxWidth: 420 }}>
          <TextField label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <TextField label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          <TextField label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={changePassword.isPending || !current || !next}
            sx={{ alignSelf: "flex-start" }}
          >
            Update password
          </Button>
        </Stack>
      </CardContent>
      </Card>
      <TwoFactorCard />
    </>
  );
}

function NotificationsTab() {
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
    <Card>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Notification channels
        </Typography>
        {push.error && (
          <Alert severity="warning" sx={{ my: 2 }}>
            {push.error}
          </Alert>
        )}
        <Stack spacing={1} sx={{ mt: 1 }}>
          <FormControlLabel
            control={<Switch checked={prefs?.email_enabled ?? false} onChange={(e) => update.mutate({ email_enabled: e.target.checked })} />}
            label="Email notifications"
          />
          <FormControlLabel
            control={<Switch checked={prefs?.in_app_enabled ?? false} onChange={(e) => update.mutate({ in_app_enabled: e.target.checked })} />}
            label="In-app notifications"
          />
          <FormControlLabel
            control={<Switch checked={prefs?.push_enabled ?? false} disabled={push.busy} onChange={(e) => handlePushToggle(e.target.checked)} />}
            label="Device push notifications"
          />
          <Typography variant="caption" color="text.secondary">
            Push asks your browser for permission the first time you turn it on.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
