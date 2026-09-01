"use client";

import GoogleIcon from "@mui/icons-material/Google";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MicrosoftIcon from "@mui/icons-material/Window";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";

import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import AuthLayout from "@/components/auth/AuthLayout";

export default function LoginPage() {
  return (
    <AuthLayout>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpRequired, setOtpRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, otp: otp || undefined }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.otp_required) {
        // Second factor needed — reveal the code field (keep it on errors too).
        setOtpRequired(true);
        setError(otp ? (data.detail ?? "Invalid code.") : null);
      } else {
        setError(data.detail ?? "Login failed.");
      }
      setSubmitting(false);
      return;
    }

    router.push(searchParams.get("next") ?? "/");
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Avatar sx={{ bgcolor: "primary.main" }}>
          <LockOutlinedIcon />
        </Avatar>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Sign in
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Welcome back — enter your credentials to continue.
        </Typography>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack component="form" onSubmit={handleSubmit} spacing={2}>
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          fullWidth
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          disabled={otpRequired}
        />
        {otpRequired && (
          <TextField
            label="Authenticator code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            autoFocus
            fullWidth
            placeholder="6-digit code or backup code"
            helperText="Enter the code from your authenticator app, or a backup code."
          />
        )}
        <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
          <Link component={NextLink} href="/forgot-password" variant="body2">
            Forgot password?
          </Link>
        </Stack>
        <Button type="submit" variant="contained" disabled={submitting} fullWidth size="large">
          {submitting ? "Signing in..." : otpRequired ? "Verify & sign in" : "Sign in"}
        </Button>
      </Stack>

      <Divider>
        <Typography variant="caption" color="text.secondary">
          OR CONTINUE WITH
        </Typography>
      </Divider>

      <Stack direction="row" spacing={2}>
        <Tooltip title="Single sign-on is coming soon">
          <span style={{ flex: 1 }}>
            <Button variant="outlined" fullWidth startIcon={<GoogleIcon />} disabled>
              Google
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Single sign-on is coming soon">
          <span style={{ flex: 1 }}>
            <Button variant="outlined" fullWidth startIcon={<MicrosoftIcon />} disabled>
              Microsoft
            </Button>
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
