"use client";

import CampaignIcon from "@mui/icons-material/Campaign";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import AudienceTable from "@/components/announcements/AudienceTable";
import { DepartmentPicker } from "@/components/common/pickers";
import { useCreateAnnouncement } from "@/hooks/useCollaboration";

/**
 * Writing a notice.
 *
 * 🔴 **This was `maxWidth="xs"`** — MUI's narrowest dialog, about 440px — with
 * the title, the body, the audience and the options stacked in one column, and
 * the only way to reach the list of people was a button that opened a *second*
 * dialog on top of this one. The result was that the department dropdown looked
 * like the whole of the audience choice, because for most people it was.
 *
 * Now it is two columns on a wide dialog: what you are saying on the left, who
 * hears it on the right, with the people table in the panel rather than behind
 * a door. The two halves are genuinely separate decisions and reviewing one
 * should not mean scrolling past the other.
 *
 * **The audience is a union, and the summary says what it resolves to.** A
 * department and a list of names can both be set — that is how "the whole of
 * accounts, plus the two engineers on the shutdown" is expressed — and neither
 * set means the whole company. Three states that look similar in a form and are
 * very different when the send button is pressed, so they are spelled out.
 */
export default function ComposeAnnouncement({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateAnnouncement();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [department, setDepartment] = useState<number | null>(null);
  const [recipients, setRecipients] = useState<number[]>([]);
  const [requireAck, setRequireAck] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setBody("");
    setDepartment(null);
    setRecipients([]);
    setRequireAck(false);
    setPinned(false);
    setError(null);
  }

  async function post() {
    setError(null);
    try {
      await create.mutateAsync({
        title,
        body,
        department,
        recipients,
        require_acknowledgement: requireAck,
        pinned,
      });
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const companyWide = department === null && recipients.length === 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { height: { md: "88vh" } } } }}
    >
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <CampaignIcon color="action" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
              New announcement
            </Typography>
            <Typography variant="body2" color="text.secondary">
              What you are saying, and who hears it.
            </Typography>
          </Box>
          {/* The one fact somebody checks before pressing Post. */}
          <Chip
            color={companyWide ? "warning" : "primary"}
            label={
              companyWide
                ? "Everybody"
                : recipients.length > 0 && department !== null
                  ? `A department + ${recipients.length}`
                  : recipients.length > 0
                    ? `${recipients.length} ${recipients.length === 1 ? "person" : "people"}`
                    : "One department"
            }
          />
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        <Grid container spacing={3} sx={{ height: "100%" }}>
          {/* ── What you are saying ─────────────────────────────────── */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary">
                The notice
              </Typography>
              <TextField
                label="Title"
                fullWidth
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <TextField
                label="Body"
                fullWidth
                multiline
                minRows={12}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                helperText="Plain text. Line breaks are kept."
              />

              <Divider />

              <Typography variant="overline" color="text.secondary">
                How it behaves
              </Typography>
              {/* Off by default: asking a hundred people to click a button on
                  every notice is how the button stops meaning anything. */}
              <FormControlLabel
                control={
                  <Switch checked={requireAck} onChange={(e) => setRequireAck(e.target.checked)} />
                }
                label="Ask people to confirm they have read it"
              />
              <FormControlLabel
                control={<Switch checked={pinned} onChange={(e) => setPinned(e.target.checked)} />}
                label="Pin to the top of the board"
              />
            </Stack>
          </Grid>

          {/* ── Who hears it ────────────────────────────────────────── */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary">
                Who it goes to
              </Typography>

              <DepartmentPicker
                label="A whole department"
                value={department}
                onChange={setDepartment}
                helperText="Optional. Everybody in it gets the notice."
              />

              {/* The table, in the panel — not behind a button. */}
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                  …and / or pick people
                </Typography>
                <AudienceTable value={recipients} onChange={setRecipients} maxHeight={300} />
              </Box>

              {/* Three states that look alike in a form and are very different
                  when Post is pressed. */}
              <Alert severity={companyWide ? "warning" : "info"} sx={{ py: 0.5 }}>
                {companyWide
                  ? "With neither set this goes to the whole company — which only somebody who manages the workplace can send."
                  : department !== null && recipients.length > 0
                    ? "Everybody in the department, plus the people picked above."
                    : department !== null
                      ? "Everybody in the department above."
                      : `Only the ${recipients.length} ${recipients.length === 1 ? "person" : "people"} picked above.`}
              </Alert>
            </Stack>
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions>
        <Button
          onClick={() => {
            reset();
            onClose();
          }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={post}
          disabled={create.isPending || !title.trim() || !body.trim()}
        >
          {create.isPending ? "Posting…" : "Post"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
