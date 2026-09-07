"use client";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import MarkunreadMailboxIcon from "@mui/icons-material/MarkunreadMailbox";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
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
import { CompanyPicker, EmployeePicker } from "@/components/common/pickers";
import LetterAttachments from "@/components/correspondence/LetterAttachments";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  useIncomingLetters,
  useNextIncomingRef,
  useOutgoingLetters,
  useSaveIncomingLetter,
  type IncomingLetter,
} from "@/hooks/useCorrespondence";
import { withCode } from "@/lib/people";

/**
 * The incoming register — the darta book, entered by hand.
 *
 * **Nothing is synced, and that is the design.** Letters arrive by post, by
 * hand, and into half a dozen personal mailboxes; a register that captured only
 * one monitored inbox would have holes in it and no way to tell which. So this
 * is somebody typing what arrived — and the one thing it does automatically is
 * the thing the paper book could not: tell the people who need to see it.
 */

const VIA: Record<IncomingLetter["received_via"], string> = {
  post: "By post",
  email: "By email",
  hand: "By hand",
  other: "Other",
};

type FormValues = {
  ref: string;
  company: number | null;
  letter_date: string;
  received_on: string;
  received_via: IncomingLetter["received_via"];
  subject: string;
  from_office: string;
  from_person: string;
  from_email: string;
  notify: number[];
  note: string;
  in_reply_to: number | null;
};

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY: FormValues = {
  ref: "",
  company: null,
  letter_date: "",
  received_on: today(),
  received_via: "post",
  subject: "",
  from_office: "",
  from_person: "",
  from_email: "",
  notify: [],
  note: "",
  in_reply_to: null,
};

export default function IncomingLettersPage() {
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState<number | null>(null);
  // An id rather than the row, so an edit's result lands back in the open form.
  const [openId, setOpenId] = useState<number | "new" | null>(null);

  const { data, isPending, isError, error, refetch } = useIncomingLetters({
    search: search || undefined,
    company,
  });
  const letters = data?.results ?? [];
  const editing = typeof openId === "number" ? letters.find((l) => l.id === openId) ?? null : null;

  return (
    <PageContainer>
      <PageHeader
        title="Incoming letters"
        subtitle="The darta register — what arrived, and who was told about it"
        icon={<MarkunreadMailboxIcon />}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpenId("new")}>
            Register a letter
          </Button>
        }
      />

      <ListControls
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Reference, subject or who it came from"
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
      />

      {isPending ? (
        <Skeleton variant="rounded" height={280} />
      ) : isError ? (
        // **Say what actually failed.** "Could not be loaded" is the same
        // sentence for a restarted server, an expired session and a bad
        // filter, and none of them can be acted on without knowing which.
        <Alert severity="error" action={<Button onClick={() => refetch()}>Try again</Button>}>
          The register could not be loaded — {error?.message ?? "no reason given"}.
        </Alert>
      ) : letters.length === 0 ? (
        <Alert severity="info">
          Nothing registered yet. Entering a letter here is what stops it living in one person&apos;s
          drawer — everybody named on it is told.
        </Alert>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Ref</TableCell>
                <TableCell>Received</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>From</TableCell>
                <TableCell>Told</TableCell>
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
                  <TableCell>
                    <Typography variant="body2">{letter.received_on}</Typography>
                    {/* A letter dated the 3rd that reached the office on the
                        11th is eight days of somebody else's delay, and only
                        showing both dates makes that visible. */}
                    {letter.letter_date && letter.letter_date !== letter.received_on ? (
                      <Typography variant="caption" color="text.secondary">
                        dated {letter.letter_date}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography variant="body2" noWrap title={letter.subject}>
                      {letter.subject}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.25 }}>
                      <Typography variant="caption" color="text.secondary">
                        {VIA[letter.received_via]}
                      </Typography>
                      {letter.attachments.length > 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          · {letter.attachments.length} attached
                        </Typography>
                      ) : null}
                      {letter.in_reply_to_ref ? (
                        <Typography variant="caption" color="primary.main">
                          · replies to {letter.in_reply_to_ref}
                        </Typography>
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography variant="body2" color="text.secondary" noWrap title={letter.from_office}>
                      {letter.from_office || "—"}
                    </Typography>
                    {letter.from_person ? (
                      <Typography variant="caption" color="text.secondary">
                        {letter.from_person}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {letter.notify_names.length === 0 ? (
                      // Worth saying plainly: a registered letter nobody was
                      // told about is a row in a book and nothing more.
                      <Typography variant="caption" color="warning.main">
                        Nobody
                      </Typography>
                    ) : (
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }} useFlexGap>
                        {letter.notify_names.map((person) => (
                          <Chip
                            key={person.id}
                            size="small"
                            variant="outlined"
                            label={withCode(person.name, person.employee_code)}
                          />
                        ))}
                      </Stack>
                    )}
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

      <IncomingLetterDialog
        open={openId !== null}
        letter={editing}
        creating={openId === "new"}
        onCreated={setOpenId}
        onClose={() => setOpenId(null)}
      />
    </PageContainer>
  );
}

function IncomingLetterDialog({
  open,
  letter,
  creating,
  onCreated,
  onClose,
}: {
  open: boolean;
  letter: IncomingLetter | null;
  creating: boolean;
  onCreated: (id: number) => void;
  onClose: () => void;
}) {
  const save = useSaveIncomingLetter();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);

  const suggestion = useNextIncomingRef(values.company, open && creating);
  // What this could be an answer to. Loaded only while the dialog is open, and
  // narrowed to the same company — a reply to another company's letter is not
  // a thing, and offering the whole register would be a list nobody can scan.
  const { data: outgoing } = useOutgoingLetters(open ? { company: values.company } : {});
  const replyOptions = outgoing?.results ?? [];

  const key = letter?.id ?? 0;
  if (open && seeded !== key) {
    setSeeded(key);
    setValues(
      letter
        ? {
            ref: letter.ref,
            company: letter.company,
            letter_date: letter.letter_date ?? "",
            received_on: letter.received_on,
            received_via: letter.received_via,
            subject: letter.subject,
            from_office: letter.from_office,
            from_person: letter.from_person,
            from_email: letter.from_email,
            notify: letter.notify,
            note: letter.note,
            in_reply_to: letter.in_reply_to,
          }
        : EMPTY
    );
    setError(null);
  }
  if (!open && seeded !== null) setSeeded(null);

  function set<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  const canSave = values.ref.trim().length > 0 && values.subject.trim().length > 0;
  // A tie that exists on the row but is not among the options offered.
  const unlisted =
    values.in_reply_to !== null && !replyOptions.some((l) => l.id === values.in_reply_to);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{letter ? `Letter ${letter.ref}` : "Register an incoming letter"}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
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
                  : "The number this office gives it on arrival."
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
              label="How it arrived"
              select
              fullWidth
              size="small"
              value={values.received_via}
              onChange={(e) => set("received_via", e.target.value as IncomingLetter["received_via"])}
            >
              {(Object.keys(VIA) as IncomingLetter["received_via"][]).map((key) => (
                <MenuItem key={key} value={key}>
                  {VIA[key]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Received on"
              type="date"
              fullWidth
              size="small"
              value={values.received_on}
              onChange={(e) => set("received_on", e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Date on the letter"
              type="date"
              fullWidth
              size="small"
              value={values.letter_date}
              onChange={(e) => set("letter_date", e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Often earlier. Leave empty if it is not dated."
            />
          </Stack>

          <CompanyPicker
            label="Company"
            value={values.company}
            onChange={(id) => set("company", id)}
            size="small"
            helperText="Which of ours it was addressed to."
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
            label="From — the office"
            fullWidth
            size="small"
            value={values.from_office}
            onChange={(e) => set("from_office", e.target.value)}
            helperText="District Administration Office, Rasuwa. Searchable."
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="From — the person"
              fullWidth
              size="small"
              value={values.from_person}
              onChange={(e) => set("from_person", e.target.value)}
            />
            <TextField
              label="Their email"
              fullWidth
              size="small"
              value={values.from_email}
              onChange={(e) => set("from_email", e.target.value)}
              helperText="For the reply, if there is one."
            />
          </Stack>

          <Autocomplete
            options={replyOptions}
            size="small"
            value={replyOptions.find((l) => l.id === values.in_reply_to) ?? null}
            onChange={(_event, next) => set("in_reply_to", next?.id ?? null)}
            getOptionLabel={(option) => `${option.ref} — ${option.subject}`}
            isOptionEqualToValue={(option, selected) => option.id === selected.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="In reply to"
                helperText={
                  // The list is narrowed to this company and to one page, so a
                  // tie made earlier can be real and still not be among the
                  // options. Saying so beats an empty box that reads as "no
                  // reply", which is how somebody clears one by accident.
                  unlisted
                    ? `Currently ${letter?.in_reply_to_ref}. Change the company above to pick a different one.`
                    : "Ties it to the letter we sent, so the thread reads as one."
                }
              />
            )}
          />

          <EmployeePicker
            label="Notify"
            multiple
            value={values.notify}
            onChange={(ids) => set("notify", (ids as number[]) ?? [])}
            size="small"
            enabled={open}
            helperText="They are told in the product and by email — once, when they are first named."
          />

          <TextField
            label="Note"
            fullWidth
            multiline
            minRows={2}
            size="small"
            value={values.note}
            onChange={(e) => set("note", e.target.value)}
          />

          <Divider />
          <LetterAttachments
            direction="incoming"
            letterId={letter?.id ?? null}
            attachments={letter?.attachments ?? []}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!canSave || save.isPending}
          onClick={() =>
            save.mutate(
              {
                id: letter?.id ?? null,
                // An empty date field is "not dated", which the column holds as
                // null — "" would be rejected as a malformed date.
                values: { ...values, letter_date: values.letter_date || null },
              },
              {
                onSuccess: (saved) => {
                  // Stays open on a new letter: attachments need a row to
                  // belong to, and the scan of the letter is the whole point.
                  if (!letter) onCreated(saved.id);
                  else onClose();
                },
                onError: (e) => setError(e.message),
              }
            )
          }
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
