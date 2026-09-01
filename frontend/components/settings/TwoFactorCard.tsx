"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ShieldIcon from "@mui/icons-material/Shield";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import StateChip from "@/components/common/StateChip";

import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import {
  useTwoFactorDisable,
  useTwoFactorEnable,
  useTwoFactorSetup,
  useTwoFactorStatus,
  type TwoFactorSetup,
} from "@/hooks/useTwoFactor";

/**
 * Opt-in TOTP enrolment. Works for any signed-in company user against
 * /accounts/2fa/*. This is the
 * company-side settings card.
 */
export default function TwoFactorCard() {
  const { data: status, isLoading } = useTwoFactorStatus();
  const setup = useTwoFactorSetup();
  const enable = useTwoFactorEnable();
  const disable = useTwoFactorDisable();

  const [enrolling, setEnrolling] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disarming, setDisarming] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function startSetup() {
    setErr(null);
    try {
      setEnrolling(await setup.mutateAsync());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start setup.");
    }
  }

  async function confirmEnable() {
    setErr(null);
    try {
      const res = await enable.mutateAsync(code);
      setBackupCodes(res.backup_codes);
      setEnrolling(null);
      setCode("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That code didn't match.");
    }
  }

  async function confirmDisable() {
    setErr(null);
    try {
      await disable.mutateAsync(disableCode);
      setDisarming(false);
      setDisableCode("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Enter a valid code.");
    }
  }

  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
          <ShieldIcon color={status?.enabled ? "success" : "action"} fontSize="small" />
          <Typography variant="overline" color="text.secondary">
            Two-factor authentication
          </Typography>
          {status?.enabled && <StateChip label="On" tone="normal" sx={{ ml: 1 }} />}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Add a one-time code from an authenticator app (Google Authenticator, Authy, 1Password…) on
          top of your password.
        </Typography>

        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

        {/* One-time backup codes, shown right after enabling */}
        {backupCodes && (
          <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
              Two-factor is on. Save these backup codes somewhere safe — each works once if you lose
              your device. They won&apos;t be shown again.
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 0.5, fontFamily: "monospace" }}>
              {backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </Box>
            <Button size="small" sx={{ mt: 1 }} onClick={() => setBackupCodes(null)}>
              Done
            </Button>
          </Alert>
        )}

        {isLoading ? (
          <Typography variant="body2" color="text.secondary">Loading…</Typography>
        ) : status?.enabled ? (
          !disarming ? (
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Typography variant="body2" color="text.secondary">
                {status.backup_codes_remaining} backup code(s) remaining.
              </Typography>
              <Button color="error" variant="outlined" size="small" onClick={() => setDisarming(true)}>
                Disable
              </Button>
            </Stack>
          ) : (
            <Stack spacing={1.5} sx={{ maxWidth: 360 }}>
              <Typography variant="body2">Enter a current code to turn two-factor off.</Typography>
              <TextField
                size="small"
                label="Authenticator or backup code"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
              />
              <Stack direction="row" spacing={1}>
                <Button color="error" variant="contained" onClick={confirmDisable} disabled={disable.isPending || !disableCode}>
                  Disable 2FA
                </Button>
                <Button onClick={() => { setDisarming(false); setDisableCode(""); }}>Cancel</Button>
              </Stack>
            </Stack>
          )
        ) : enrolling ? (
          <Stack spacing={2} sx={{ maxWidth: 420 }}>
            <Typography variant="body2">
              1. Scan this QR code with your authenticator app (or enter the key manually).
            </Typography>
            <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrolling.qr} alt="2FA QR code" width={160} height={160} style={{ borderRadius: 8 }} />
              <Box>
                <Typography variant="caption" color="text.secondary">Manual key</Typography>
                <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                  {enrolling.secret}
                </Typography>
              </Box>
            </Box>
            <Typography variant="body2">2. Enter the 6-digit code it shows to confirm.</Typography>
            <TextField
              size="small"
              label="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              sx={{ maxWidth: 200 }}
            />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={confirmEnable} disabled={enable.isPending || code.length < 6}>
                Verify & enable
              </Button>
              <Button onClick={() => { setEnrolling(null); setCode(""); }}>Cancel</Button>
            </Stack>
          </Stack>
        ) : (
          <Button variant="contained" startIcon={<ShieldIcon />} onClick={startSetup} disabled={setup.isPending}>
            {setup.isPending ? "Preparing…" : "Enable two-factor"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
