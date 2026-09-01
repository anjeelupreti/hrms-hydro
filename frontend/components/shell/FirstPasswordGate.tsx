"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useChangePassword } from "@/hooks/useAccount";
import { useMe } from "@/hooks/useMe";

/**
 * Stops a system-generated password from becoming somebody's real one.
 *
 * **Why this exists.** Provisioning an employee and confirming a password reset
 * both mail a generated password in plain text. Until now the only thing asking
 * for it to be replaced was a polite sentence in that email, so the password we
 * chose could stay the account's password indefinitely.
 *
 * **Why a blocking dialog rather than a redirect.** The roadmap's rule is
 * "redirect where a destination exists", and that rule is about *permission* —
 * somebody who belongs elsewhere. This is different: they belong exactly where
 * they are and owe one action first. A redirect would need its own route, a
 * guard exempting that route from itself, and somewhere to send them back to —
 * three moving parts and a redirect loop waiting to happen. A dialog is one
 * component and cannot loop.
 *
 * **This is not a security control**, and neither would a redirect be. The API
 * still answers this user normally; the risk being managed is a mailed password
 * living forever, not somebody reaching a page they should not. Treating it as
 * a wall would mean refusing requests server-side, which locks people out of
 * the very screen that fixes it.
 */
export default function FirstPasswordGate() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const changePassword = useChangePassword();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!me?.must_change_password) return null;

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length > 0 && !mismatch && !changePassword.isPending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await changePassword.mutateAsync({ old_password: current, new_password: next });
      // Refetch rather than patching the cache: the flag is cleared by the
      // server, and trusting our own guess about that is how a dialog ends up
      // reappearing on the next navigation.
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change your password.");
    }
  }

  return (
    // No `onClose` at all, deliberately. `open` is derived from the server's
    // flag and nothing local can unset it, so backdrop clicks and Escape have
    // nowhere to go — the one way out is choosing a password. Fewer moving
    // parts than handling each dismissal reason and refusing it.
    <Dialog open maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Choose your password</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The password you signed in with was generated for you and sent by email,
          so it is not private. Pick your own to continue.
        </Typography>

        <form onSubmit={submit}>
          <Stack spacing={2}>
            <TextField
              label="Current password"
              type="password"
              size="small"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              autoFocus
              fullWidth
            />
            <TextField
              label="New password"
              type="password"
              size="small"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              fullWidth
            />
            <TextField
              label="Confirm new password"
              type="password"
              size="small"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              error={mismatch}
              helperText={mismatch ? "These do not match." : " "}
              fullWidth
            />

            {error && <Alert severity="error">{error}</Alert>}

            <Button type="submit" variant="contained" disabled={!canSubmit} fullWidth>
              {changePassword.isPending ? "Saving…" : "Set password"}
            </Button>
          </Stack>
        </form>
      </DialogContent>
    </Dialog>
  );
}
