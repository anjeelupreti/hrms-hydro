"use client";

import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import Divider from "@mui/material/Divider";

import PasswordField from "@/components/common/PasswordField";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useCan, useMe } from "@/hooks/useMe";
import {
  useEmailSettings,
  useTestEmailConnection,
  useTestImapConnection,
  useUpdateEmailSettings,
} from "@/hooks/useOrganization";

export default function EmailSettingsPage() {
  const { data: me } = useMe();
  const canManage = useCan("settings.manage");
  const { data: settings } = useEmailSettings();

  if (me && !canManage) {
    return (
      <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 560, mx: "auto" }}>
        <Alert severity="warning">Only HR admins can view or change email settings.</Alert>
      </Box>
    );
  }
  if (!settings) return null;
  return <EmailSettingsForm key={settings.id} settings={settings} />;
}

function EmailSettingsForm({ settings }: { settings: NonNullable<ReturnType<typeof useEmailSettings>["data"]> }) {
  const updateSettings = useUpdateEmailSettings();
  const testConnection = useTestEmailConnection();
  const testImap = useTestImapConnection();

  const [host, setHost] = useState(settings.host);
  const [port, setPort] = useState(settings.port);
  const [username, setUsername] = useState(settings.username);
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState(settings.from_email);
  const [useTls, setUseTls] = useState(settings.use_tls);
  const [isActive, setIsActive] = useState(settings.is_active);
  const [imapHost, setImapHost] = useState(settings.imap_host);
  const [imapPort, setImapPort] = useState(settings.imap_port);
  const [imapUseSsl, setImapUseSsl] = useState(settings.imap_use_ssl);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleTest() {
    setError(null);
    try {
      const result = await testConnection.mutateAsync({ host, port, username, password, use_tls: useTls });
      setError(null);
      alert(result.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection test failed.");
    }
  }

  async function handleTestImap() {
    setError(null);
    try {
      const result = await testImap.mutateAsync({
        imap_host: imapHost,
        imap_port: imapPort,
        username,
        ...(password ? { password } : {}),
        imap_use_ssl: imapUseSsl,
      });
      alert(result.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "IMAP test failed.");
    }
  }

  async function handleSave() {
    setError(null);
    setSuccess(false);
    try {
      await updateSettings.mutateAsync({
        host,
        port,
        username,
        ...(password ? { password } : {}),
        from_email: fromEmail,
        use_tls: useTls,
        is_active: isActive,
        imap_host: imapHost,
        imap_port: imapPort,
        imap_use_ssl: imapUseSsl,
      });
      setPassword("");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <PageContainer>
      {/*
        Outgoing and incoming mail are two separate servers with the same shape
        — host, port, an encryption switch — so they sit side by side rather
        than stacked into a form you scroll to fill in. `host` and `port` share
        a row because `smtp.gmail.com:587` is one fact written in two boxes.
      */}
      <Box sx={{ maxWidth: 1040, mx: "auto" }}>
        <PageHeader
          title="Email settings"
          subtitle="Send and receive company mail through your own account"
          icon={<MarkEmailReadIcon />}
        />

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Saved.
          </Alert>
        )}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            gap: 3,
            alignItems: "start",
          }}
        >
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6" sx={{ mb: 0.5 }}>
                Outgoing (SMTP)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Password resets, invitations and every notification the product
                sends go out through this account.
              </Typography>
            </Box>

            <Stack direction="row" spacing={2}>
              <TextField
                label="SMTP host"
                fullWidth
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="smtp.gmail.com"
              />
              <TextField
                label="Port"
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                sx={{ width: 110, flexShrink: 0 }}
              />
            </Stack>
            <TextField
              label="Username"
              fullWidth
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <PasswordField
              fullWidth
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={settings.password_is_set ? "•••••••• (leave blank to keep current)" : ""}
              helperText={
                settings.password_is_set
                  ? "A password is already saved — leave blank to keep it."
                  : ""
              }
            />
            <TextField
              label="From address"
              fullWidth
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
            />
            <FormControlLabel
              control={<Switch checked={useTls} onChange={(e) => setUseTls(e.target.checked)} />}
              label="Use TLS"
            />
          </Stack>

          <Stack spacing={2}>
            <Box>
              <Typography variant="h6" sx={{ mb: 0.5 }}>
                Inbox (IMAP)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Fetch the company mailbox into the in-app inbox. Uses the same
                username and password as SMTP — only the server differs (e.g.
                imap.gmail.com:993).
              </Typography>
            </Box>

            <Stack direction="row" spacing={2}>
              <TextField
                label="IMAP host"
                fullWidth
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                placeholder="imap.gmail.com"
              />
              <TextField
                label="Port"
                type="number"
                value={imapPort}
                onChange={(e) => setImapPort(Number(e.target.value))}
                sx={{ width: 110, flexShrink: 0 }}
              />
            </Stack>
            <FormControlLabel
              control={
                <Switch checked={imapUseSsl} onChange={(e) => setImapUseSsl(e.target.checked)} />
              }
              label="Use SSL"
            />
          </Stack>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Below the divider, not inside the SMTP column. It is not an SMTP
            setting: it decides whether the *company's own* mail configuration
            is used at all, outgoing and incoming alike. Sitting under "Use TLS"
            made it read as a third property of the send server — and left the
            two columns visibly lopsided, which is how it was noticed. */}
        <FormControlLabel
          sx={{ display: "block", mb: 2 }}
          control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
          label="Use these settings instead of the server defaults"
        />

        {/* Test before Save, left to right, because that is the order these
            are meant to be used in: prove the credentials work, then keep
            them. Save stays contained so it is still the one obvious action. */}
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button variant="outlined" onClick={handleTest} disabled={testConnection.isPending}>
            Send test email
          </Button>
          <Button variant="outlined" onClick={handleTestImap} disabled={testImap.isPending}>
            Test IMAP
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={updateSettings.isPending}>
            Save
          </Button>
        </Stack>
      </Box>
    </PageContainer>
  );
}
