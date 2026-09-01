"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";

import { useSendEmail } from "@/hooks/useMail";

export type ComposeInitial = { to: string; subject: string; body: string };

type Props = {
  open: boolean;
  initial: ComposeInitial;
  onClose: () => void;
  onSent: () => void;
};

// Outer/inner split (same pattern as the calendar/employee dialogs): the
// Dialog stays mounted for the close transition; the form remounts per
// `initial` identity so a reply pre-fills cleanly without useEffect+setState.
export default function ComposeDialog({ open, initial, onClose, onSent }: Props) {
  const formKey = `${initial.to}|${initial.subject}`;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <ComposeForm key={formKey} initial={initial} onClose={onClose} onSent={onSent} />
    </Dialog>
  );
}

function ComposeForm({ initial, onClose, onSent }: Omit<Props, "open">) {
  const sendEmail = useSendEmail();
  const [to, setTo] = useState(initial.to);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setError(null);
    try {
      await sendEmail.mutateAsync({ to, subject, body });
      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
      <DialogTitle>New message</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="To" fullWidth value={to} onChange={(e) => setTo(e.target.value)} placeholder="comma-separated" />
          <TextField label="Subject" fullWidth value={subject} onChange={(e) => setSubject(e.target.value)} />
          <TextField label="Message" fullWidth multiline minRows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSend} disabled={sendEmail.isPending || !to.trim()}>
          {sendEmail.isPending ? "Sending…" : "Send"}
        </Button>
      </DialogActions>
    </>
  );
}
