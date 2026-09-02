"use client";

import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";

import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import PasswordField from "@/components/common/PasswordField";
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
  /**
   * Whether React is listening yet.
   *
   * **An effect, deliberately, and not `useSyncExternalStore`.** That hook is
   * the usual answer to "did the server render this", and it does not work
   * here: it re-renders when the *store* notifies, and a store whose subscribe
   * is a no-op never notifies — so the component keeps the server snapshot
   * forever and the button stays disabled. Measured, not assumed: driving the
   * real page, it was still disabled six seconds after network idle with no
   * page errors.
   *
   * An effect does not run on the server and does run once the client takes
   * over, which is exactly the question being asked.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

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

      {/* `method="post"` on a form whose submit is handled in JavaScript looks
          redundant, and is the one line that matters here.

          `handleSubmit` calls `preventDefault`, but it can only do that once
          React has hydrated. Type a password and press Enter before then — on a
          cold cache, a slow phone, a site connection — and the browser performs
          its own default submission: a **GET to the current URL with every
          named field appended**. The password lands in the address bar, in
          browser history, in the `Referer` of the next request, and in the
          access log of anything between here and the server. Confirmed by
          driving the real page: the URL came back as
          `/login?username=owner&password=TestPass123%21`.

          Two things close it, and both are here because either alone leaves a
          gap. `method="post"` means a pre-hydration submit puts the fields in a
          request body rather than the URL, so the worst case stops being a
          logged credential. `hydrated` then disables the button until React is
          actually listening, so the pre-hydration submit does not happen at
          all. */}
      <Stack component="form" method="post" onSubmit={handleSubmit} spacing={2}>
        {/* `name` and `autoComplete` are what let a password manager fill this
            form. Without them the browser has no idea which box is which, so
            saved credentials never offer themselves and everybody types. */}
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          fullWidth
        />
        <PasswordField
          name="password"
          autoComplete="current-password"
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
        <Button
          type="submit"
          variant="contained"
          disabled={submitting || !hydrated}
          fullWidth
          size="large"
        >
          {submitting ? "Signing in..." : otpRequired ? "Verify & sign in" : "Sign in"}
        </Button>
      </Stack>

    </Stack>
  );
}
