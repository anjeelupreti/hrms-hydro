"use client";

import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircle";
import LockResetIcon from "@mui/icons-material/LockReset";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import AuthLayout from "@/components/auth/AuthLayout";

export default function ResetPasswordConfirmPage() {
  return (
    <AuthLayout>
      <Suspense>
        <ConfirmForm />
      </Suspense>
    </AuthLayout>
  );
}

function ConfirmForm() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid");
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setStatus("submitting");
    setError(null);
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, token }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.detail ?? "This reset link is invalid or has expired.");
      setStatus("error");
      return;
    }
    setStatus("done");
  }

  if (!uid || !token) {
    return <Alert severity="error">This reset link is missing required information.</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Avatar sx={{ bgcolor: "primary.main" }}>
          <LockResetIcon />
        </Avatar>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Confirm password reset
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Confirming will generate a new password and email it to you.
        </Typography>
      </Stack>

      {status === "done" ? (
        <Alert severity="success" icon={<CheckCircleOutlineIcon fontSize="inherit" />}>
          Done — check your email for your new password.
        </Alert>
      ) : (
        <>
          {status === "error" && <Alert severity="error">{error}</Alert>}
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={handleConfirm}
            disabled={status === "submitting"}
          >
            {status === "submitting" ? "Confirming..." : "Confirm and email me a new password"}
          </Button>
        </>
      )}

      <Link component={NextLink} href="/login" variant="body2">
        Back to sign in
      </Link>
    </Stack>
  );
}
