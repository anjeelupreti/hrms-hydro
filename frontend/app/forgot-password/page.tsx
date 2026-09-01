"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MailOutlineIcon from "@mui/icons-material/Email";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { useState } from "react";

import AuthLayout from "@/components/auth/AuthLayout";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    <AuthLayout>
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Avatar sx={{ bgcolor: "primary.main" }}>
            <MailOutlineIcon />
          </Avatar>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Forgot your password?
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Enter your email and we&apos;ll send a link to confirm the reset — a new
            password will be generated and emailed to you.
          </Typography>
        </Stack>

        {submitted ? (
          <Alert severity="success">
            If an account exists for that email, a confirmation link is on its way.
          </Alert>
        ) : (
          <Stack component="form" onSubmit={handleSubmit} spacing={2}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              fullWidth
            />
            <Button type="submit" variant="contained" size="large" disabled={submitting} fullWidth>
              {submitting ? "Sending..." : "Send reset link"}
            </Button>
          </Stack>
        )}

        <Link component={NextLink} href="/login" variant="body2">
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <ArrowBackIcon fontSize="inherit" />
            <span>Back to sign in</span>
          </Stack>
        </Link>
      </Stack>
    </AuthLayout>
  );
}
