"use client";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import SendIcon from "@mui/icons-material/Send";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import ListControls from "@/components/common/ListControls";
import { CompanyPicker } from "@/components/common/pickers";
import EmailChips, { allValidEmails } from "@/components/correspondence/EmailChips";
import LetterAttachments from "@/components/correspondence/LetterAttachments";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  useNextOutgoingRef,
  useOutgoingLetters,
  useDeleteOutgoingLetter,
  useSaveOutgoingLetter,
  useSendOutgoingLetter,
  type OutgoingLetter,
} from "@/hooks/useCorrespondence";

/**
 * The outgoing register — the chalani book, which also does the posting.
 *
 * **Two registers, and this one sends.** What the office did in three acts —
 * write the letter, post it, write it in the book — becomes one act, and the
 * book is then searchable. The register entry is the durable thing and the
 * email is an attempt: a letter is never lost because a mail server was down,
 * and a failure shows its reason with the Send button still there.
 */

const STATUS: Record<
  OutgoingLetter["status"],
  { label: string; color: "default" | "success" | "error" | "info" }
> = {
  draft: { label: "Draft", color: "default" },
  sent: { label: "Sent", color: "success" },
  failed: { label: "Failed", color: "error" },
  // Not a failure. Plenty of letters go by hand, and the register should hold
  // them without anybody pretending an email was tried.
  not_emailed: { label: "By hand", color: "info" },
};

type FormValues = {
  ref: string;
  company: number | null;
  letter_date: string;
  subject: string;
  addressed_to: string;
  body: string;
  recipients: string[];
  cc: string[];
};

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY: FormValues = {
  ref: "",
  company: null,
  letter_date: today(),
  subject: "",
  addressed_to: "",
  body: "",
  recipients: [],
  cc: [],
};

export default function OutgoingLettersPage() {
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState<number | null>(null);
  const [status, setStatus] = useState<OutgoingLetter["status"] | "">("");
  // **An id, not the row.** Holding a snapshot means the dialog cannot show the
  // result of its own Send — it would still be reading the draft it opened on.
  const [openId, setOpenId] = useState<number | "new" | null>(null);

  const { data, isPending, isError, refetch } = useOutgoingLetters({
    search: search || undefined,
    company,
    status: status || undefined,
  });
  const letters = data?.results ?? [];
  const open = openId !== null;
  const editing = typeof openId === "number" ? letters.find((l) => l.id === openId) ?? null : null;

  return (
    <PageContainer>
      <PageHeader
        title="Outgoing letters"
        subtitle="The chalani register — recorded here, and posted from here"
        icon={<SendIcon />}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpenId("new")}>
            New letter
          </Button>
        }
      />

      <ListControls
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Reference, subject or addressee"
        filters={
          <CompanyPicker
            label="Company"
            value={company}
            onChange={setCompany}
            size="small"
            placeholder="All"
            // `EntityPicker` is fullWidth, so in the controls row it stretches
            // and pushes itself onto a line of its own. Capped to match the
            // search box beside it.
            sx={{ width: "100%", maxWidth: { sm: 260 } }}
          />
        }
        chips={
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
            <Chip
              size="small"
              label="All"
              color={status === "" ? "primary" : "default"}
              variant={status === "" ? "filled" : "outlined"}
              onClick={() => setStatus("")}
            />
            {(Object.keys(STATUS) as OutgoingLetter["status"][]).map((key) => (
              <Chip
                key={key}
                size="small"
                label={STATUS[key].label}
                color={status === key ? "primary" : "default"}
                variant={status === key ? "filled" : "outlined"}
                onClick={() => setStatus(key)}
              />
            ))}
          </Stack>
        }
      />

      {isPending ? (
        <Skeleton variant="rounded" height={280} />
      ) : isError ? (
        <Alert severity="error" action={<Button onClick={() => refetch()}>Try again</Button>}>
          The register could not be loaded.
        </Alert>
      ) : letters.length === 0 ? (
        <Alert severity="info">
          Nothing here yet. A letter recorded here is posted from here, so the register and the
          sending are one act rather than three.
        </Alert>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Ref</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>Addressed to</TableCell>
                <TableCell>Sent to</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {letters.map((letter) => (
                <TableRow key={letter.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {letter.ref}
                    </Typography>
                    {letter.company_name ? (
                      <Typography variant="caption" color="text.secondary">
                        {letter.company_name}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{letter.letter_date}</TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography variant="body2" noWrap title={letter.subject}>
                      {letter.subject}
                    </Typography>
                    <Stack direction="row" spacing={0.75} sx={{ mt: 0.25 }}>
                      {letter.attachments.length > 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          {letter.attachments.length} attached
                        </Typography>
                      ) : null}
                      {letter.reply_count > 0 ? (
                        <Typography variant="caption" color="success.main">
                          {letter.reply_count} {letter.reply_count === 1 ? "reply" : "replies"}
                        </Typography>
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography variant="body2" color="text.secondary" noWrap title={letter.addressed_to}>
                      {letter.addressed_to || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {letter.recipients.join(", ") || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={letter.error || (letter.sent_at ? `Sent ${letter.sent_at}` : "")}>
                      <Chip
                        size="small"
                        label={STATUS[letter.status].label}
                        color={STATUS[letter.status].color}
                        variant={letter.status === "draft" ? "outlined" : "filled"}
                      />
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Open">
                      <IconButton size="small" onClick={() => setOpenId(letter.id)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <OutgoingLetterDialog
        open={open}
        letter={editing}
        creating={openId === "new"}
        onCreated={setOpenId}
        onClose={() => setOpenId(null)}
      />
    </PageContainer>
  );
}

function OutgoingLetterDialog({
  open,
  letter,
  creating,
  onCreated,
  onClose,
}: {
  open: boolean;
  /** Re-derived from the list on every render, so Send's result lands here. */
  letter: OutgoingLetter | null;
  creating: boolean;
  onCreated: (id: number) => void;
  onClose: () => void;
}) {
  const save = useSaveOutgoingLetter();
  const send = useSendOutgoingLetter();
  const discard = useDeleteOutgoingLetter();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);

  // Only while creating: asking the server for a suggestion every time somebody
  // opens an existing letter would be a request whose answer is discarded.
  const suggestion = useNextOutgoingRef(values.company, open && creating);

  const key = letter?.id ?? 0;
  if (open && seeded !== key) {
    setSeeded(key);
    setValues(
      letter
        ? {
            ref: letter.ref,
            company: letter.company,
            letter_date: letter.letter_date,
            subject: letter.subject,
            addressed_to: letter.addressed_to,
            body: letter.body,
            recipients: letter.recipients,
            cc: letter.cc,
          }
        : EMPTY
    );
    setError(null);
  }
  if (!open && seeded !== null) setSeeded(null);

  function set<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  const sent = letter?.status === "sent";
  const addressesOk = allValidEmails(values.recipients) && allValidEmails(values.cc);
  const canSave = values.ref.trim().length > 0 && values.subject.trim().length > 0 && addressesOk;

  function persist(onDone?: (saved: OutgoingLetter) => void) {
    save.mutate(
      { id: letter?.id ?? null, values },
      {
        onSuccess: (saved) => {
          // The dialog stays open on a new letter, because a file needs a row
          // to belong to: this is the moment attachments and Send become real.
          if (!letter) onCreated(saved.id);
          onDone?.(saved);
        },
        onError: (e) => setError(e.message),
      }
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <span>{letter ? `Letter ${letter.ref}` : "New outgoing letter"}</span>
          {letter ? (
            <Chip
              size="small"
              label={STATUS[letter.status].label}
              color={STATUS[letter.status].color}
              variant={letter.status === "draft" ? "outlined" : "filled"}
            />
          ) : null}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        {/* The reason lives on the row and the button is still there — a
            registry that quietly loses letters is worse than a paper one. */}
        {letter?.status === "failed" && letter.error ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            It did not go: {letter.error}
          </Alert>
        ) : null}
        {letter?.status === "not_emailed" ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            Recorded with nobody to email — a letter that went by hand. Add an address and send it
            if that was not the intention.
          </Alert>
        ) : null}
        {sent ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            Sent{letter?.sent_at ? ` on ${new Date(letter.sent_at).toLocaleString()}` : ""}.
          </Alert>
        ) : null}

        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Reference"
              required
              fullWidth
              size="small"
              value={values.ref}
              onChange={(e) => set("ref", e.target.value)}
              helperText={
                creating && suggestion.data?.suggestion && !values.ref
                  ? `Next free number looks like ${suggestion.data.suggestion}`
                  : "The office's own numbering. Unique within the company."
              }
              slotProps={{
                input: {
                  endAdornment:
                    creating && suggestion.data?.suggestion && !values.ref ? (
                      <Button size="small" onClick={() => set("ref", suggestion.data!.suggestion)}>
                        Use
                      </Button>
                    ) : null,
                },
              }}
            />
            <TextField
              label="Date on the letter"
              type="date"
              fullWidth
              size="small"
              value={values.letter_date}
              onChange={(e) => set("letter_date", e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          <CompanyPicker
            label="Company"
            value={values.company}
            onChange={(id) => set("company", id)}
            size="small"
            helperText="Whose letterhead it goes out on. References are numbered per company."
          />

          <TextField
            label="Subject"
            required
            fullWidth
            size="small"
            value={values.subject}
            onChange={(e) => set("subject", e.target.value)}
          />

          <TextField
            label="Addressed to"
            fullWidth
            size="small"
            value={values.addressed_to}
            onChange={(e) => set("addressed_to", e.target.value)}
            helperText="The office, as it is written on the letter — District Administration Office, Rasuwa."
          />

          <EmailChips
            label="Send to"
            value={values.recipients}
            onChange={(next) => set("recipients", next)}
            placeholder="dao.rasuwa@example.gov.np"
            helperText="Leave empty for a letter going by hand — it is still registered."
          />
          <EmailChips label="Cc" value={values.cc} onChange={(next) => set("cc", next)} />

          <TextField
            label="Note"
            fullWidth
            multiline
            minRows={3}
            size="small"
            value={values.body}
            onChange={(e) => set("body", e.target.value)}
            helperText="Kept with the register entry. The covering email uses the wording set in Settings › Reminders."
          />

          <Divider />
          <LetterAttachments
            direction="outgoing"
            letterId={letter?.id ?? null}
            attachments={letter?.attachments ?? []}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        {/* Drafts only. Once a letter has been posted — or recorded as going by
            hand — it is a record of something that happened, and a register you
            can delete from is not a register. */}
        {letter?.status === "draft" ? (
          <Button
            color="error"
            sx={{ mr: "auto" }}
            disabled={discard.isPending}
            onClick={() =>
              discard.mutate(letter.id, { onSuccess: onClose, onError: (e) => setError(e.message) })
            }
          >
            Discard draft
          </Button>
        ) : null}
        <Button onClick={onClose}>{sent ? "Close" : "Cancel"}</Button>
        <Button variant="outlined" disabled={!canSave || save.isPending} onClick={() => persist()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="contained"
          startIcon={<SendIcon />}
          disabled={!canSave || save.isPending || send.isPending}
          onClick={() =>
            // Saved first, always: sending a letter whose subject was edited a
            // second ago should send the edit, not what the server last saw.
            persist((saved) =>
              send.mutate(saved.id, { onError: (e) => setError(e.message) })
            )
          }
        >
          {send.isPending ? "Sending…" : sent ? "Send again" : "Save & send"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
