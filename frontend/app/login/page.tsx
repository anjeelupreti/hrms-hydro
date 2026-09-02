"use client";

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutlineOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import Link from "@mui/material/Link";

import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import PasswordField from "@/components/common/PasswordField";
import AuthLayout from "@/components/auth/AuthLayout";
import { DEPLOYMENT, PRODUCT_NAME } from "@/lib/product";

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
      {/* The heading carries the company mark rather than a padlock.
          A lock icon on a login form tells the reader something they already
          know — they can see the password box. The mark tells them whose
          system they are about to enter, which is the question somebody
          arriving on a bookmarked URL actually has. */}
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
          <Box
            sx={(theme) => ({
              width: 38,
              height: 38,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              color: "primary.contrastText",
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: "-0.02em",
              background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
            })}
          >
            {DEPLOYMENT.code.slice(0, 2)}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.2 }}>
              {DEPLOYMENT.short}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.disabled", lineHeight: 1.2 }}>
              {PRODUCT_NAME}
            </Typography>
          </Box>
        </Stack>

        <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: "-0.02em", pt: 0.5 }}>
          Sign in
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {otpRequired
            ? "One more step — enter the code from your authenticator."
            : "Use the account your HR team set up for you."}
        </Typography>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ borderRadius: 2 }}>
          {error}
        </Alert>
      )}

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
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <PersonOutlineIcon fontSize="small" color="disabled" />
                </InputAdornment>
              ),
            },
          }}
        />
        <PasswordField
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          disabled={otpRequired}
          startIcon={<LockOutlinedIcon fontSize="small" color="disabled" />}
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
          endIcon={submitting ? null : <ArrowForwardIcon />}
          sx={{
            py: 1.35,
            borderRadius: 2,
            fontWeight: 700,
            fontSize: "1rem",
            textTransform: "none",
            boxShadow: "none",
            "&:hover": { boxShadow: "none" },
          }}
        >
          {submitting ? "Signing in…" : otpRequired ? "Verify and sign in" : "Sign in"}
        </Button>

        {/* Where to go when the password is not the problem. A login screen
            that offers only "forgot password?" strands the two people it
            actually strands: somebody who has never been given an account, and
            somebody whose account has been suspended. */}
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", pt: 0.5 }}>
          Accounts are created by your HR team. If you cannot get in, speak to
          them rather than trying again.
        </Typography>
      </Stack>

    </Stack>
  );
}
