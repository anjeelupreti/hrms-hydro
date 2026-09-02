"use client";

import AttachFileIcon from "@mui/icons-material/AttachFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DescriptionIcon from "@mui/icons-material/Description";
import LockIcon from "@mui/icons-material/Lock";
import SendIcon from "@mui/icons-material/Send";
import UndoIcon from "@mui/icons-material/Undo";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";

import DateField from "@/components/common/DateField";
import DateText from "@/components/common/DateText";
import RichTextEditor, { RichText } from "@/components/common/RichTextEditor";
import StateChip from "@/components/common/StateChip";
import { CompanyPicker, EmployeePicker } from "@/components/common/pickers";
import {
  useAddMemorandumAttachment,
  useApproveMemorandum,
  useCommentOnMemorandum,
  useMemorandumActions,
  useProceedMemorandum,
  useRejectMemorandum,
  useRemoveMemorandumAttachment,
  useResubmitMemorandum,
  useSaveMemorandum,
  useSendBackMemorandum,
  useSubmitMemorandum,
} from "@/hooks/useMemoranda";
import {
  MEMO_STATUS_TONE,
  type Memorandum,
  type MemorandumFormValues,
} from "@/types/memoranda";

/**
 * One memorandum: writing it, moving it, and reading what happened to it.
 *
 * **What the reader may do is not decided here.** `can_act`,
 * `can_edit_content`, `can_edit_chain` and `return_targets` come down with the
 * record — the workflow owns those rules and the browser asking again would be
 * a second copy of them, which is how a button appears that the API refuses.
 *
 * **Two save buttons and they are different acts.** Save keeps a draft; Submit
 * mints the number, fixes everything but the text, and puts it on the first
 * recommender's desk. A single button that did both would make the irreversible
 * one indistinguishable from the reversible one.
 */

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

const EMPTY: MemorandumFormValues = {
  company: null,
  // Filled in with today, which is what submission validates against. See
  // `workflow.submit`: a memorandum is dated the day it is raised.
  memo_date: todayIso(),
  subject: "",
  content: "",
  approver: null,
  recommender_ids: [],
};

export default function MemorandumDialog({
  open,
  memo,
  loading = false,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** `null` creates. */
  memo: Memorandum | null;
  loading?: boolean;
  onClose: () => void;
  /** A new draft was saved. The page reopens the dialog on it, so the
   *  initiator can go straight on to attaching files. */
  onCreated?: (id: number) => void;
}) {
  const save = useSaveMemorandum();
  const submit = useSubmitMemorandum();
  const proceed = useProceedMemorandum();
  const sendBack = useSendBackMemorandum();
  const resubmit = useResubmitMemorandum();
  const approve = useApproveMemorandum();
  const reject = useRejectMemorandum();
  const addComment = useCommentOnMemorandum();
  const addAttachment = useAddMemorandumAttachment();
  const removeAttachment = useRemoveMemorandumAttachment();
  const { data: actionPage } = useMemorandumActions();

  const [tab, setTab] = useState(0);
  const [values, setValues] = useState<MemorandumFormValues>(EMPTY);
  const [comment, setComment] = useState("");
  const [actionId, setActionId] = useState<number | "">("");
  const [returnTo, setReturnTo] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  // Separate from `comment`, which is the note that travels *with* an action
  // (approve, send back). Sharing one field meant a holder typing a standalone
  // remark would find it attached to whichever button they pressed next.
  const [remark, setRemark] = useState("");
  const [mentions, setMentions] = useState<number[]>([]);
  const [commentFiles, setCommentFiles] = useState<File[]>([]);

  const isNew = memo === null;
  const isDraft = isNew || memo?.status === "draft";
  const locked = Boolean(memo?.is_locked);

  useEffect(() => {
    if (!open) return;
    setValues(
      memo
        ? {
            company: memo.company,
            memo_date: memo.memo_date,
            subject: memo.subject,
            content: memo.content,
            approver: memo.approver,
            recommender_ids: memo.recommenders.map((r) => r.employee),
          }
        : { ...EMPTY, memo_date: todayIso() }
    );
    setTab(0);
    setComment("");
    setActionId("");
    setReturnTo("");
    setError(null);
  }, [open, memo]);

  // The default target is the initiator, which is where a returned memorandum
  // goes nine times in ten.
  useEffect(() => {
    if (returnTo === "" && memo?.return_targets?.length) {
      const initiator = memo.return_targets.find((t) => t.is_initiator);
      setReturnTo(initiator?.id ?? memo.return_targets[0].id);
    }
  }, [memo, returnTo]);

  const actions = actionPage?.results ?? [];
  const proceedActions = useMemo(
    () =>
      actions.filter(
        (a) =>
          a.is_active &&
          a.effect === "proceed" &&
          (memo?.stage === "approve" ? a.for_approver : true)
      ),
    [actions, memo?.stage]
  );
  const returnActions = useMemo(
    () => actions.filter((a) => a.is_active && a.effect === "return"),
    [actions]
  );

  function set<K extends keyof MemorandumFormValues>(key: K, value: MemorandumFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  async function run<T>(promise: Promise<T>, after?: () => void) {
    setError(null);
    try {
      await promise;
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be done.");
    }
  }

  async function handleSave(thenSubmit: boolean) {
    setError(null);
    try {
      const saved = await save.mutateAsync({
        id: memo?.id,
        // After submission only the content moves; sending the rest back would
        // be refused, and sending it is how a form comes to fight the API.
        values: isDraft
          ? values
          : { content: values.content, recommender_ids: values.recommender_ids, approver: values.approver },
      });
      if (thenSubmit) {
        await submit.mutateAsync({ id: saved.id });
        onClose();
        return;
      }
      // A brand-new draft reopens as itself rather than closing.
      //
      // Attachments hang off a memorandum, so until one exists there is
      // nothing to attach to — which is why the attachment controls were
      // simply absent on a new memorandum and the initiator had no way to add
      // a file at all. Handing the id back lets the page swap this dialog for
      // the saved draft, where the controls apply.
      if (isNew && onCreated) {
        onCreated(saved.id);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  const busy =
    save.isPending || submit.isPending || proceed.isPending || sendBack.isPending ||
    approve.isPending || reject.isPending || resubmit.isPending;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {isNew ? "New memorandum" : memo?.memo_id || "Draft memorandum"}
          </Typography>
          {memo ? (
            <>
              <StateChip label={memo.status_display} tone={MEMO_STATUS_TONE[memo.status]} />
              {memo.status === "in_progress" && memo.current_holder_name ? (
                <Chip size="small" variant="outlined" label={`With ${memo.current_holder_name}`} />
              ) : null}
              {locked ? <Chip size="small" icon={<LockIcon />} label="Closed" /> : null}
            </>
          ) : null}
        </Stack>
        {memo?.subject ? (
          <Typography variant="body2" color="text.secondary">
            {memo.subject}
          </Typography>
        ) : null}
      </DialogTitle>

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ px: 3 }}>
        <Tab label="Memorandum" />
        <Tab label={`Chain${memo ? ` (${memo.recommenders.length})` : ""}`} />
        <Tab label={`History${memo ? ` (${memo.events.length})` : ""}`} />
      </Tabs>

      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        {locked ? (
          <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
            This memorandum was {memo?.status === "approved" ? "approved" : "rejected"} on{" "}
            <DateText value={memo?.decided_at ?? ""} />. It is a record now — nothing
            on it can be changed.
          </Alert>
        ) : null}

        {loading ? (
          <Skeleton variant="rounded" height={320} />
        ) : tab === 0 ? (
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 5 }}>
              <CompanyPicker
                label="Company"
                required
                value={values.company}
                onChange={(id) => set("company", id)}
                disabled={!isDraft || locked}
                helperText={
                  isDraft
                    ? "Its code goes into the memorandum number."
                    : "Fixed once submitted."
                }
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <DateField
                label="Date"
                required
                value={values.memo_date}
                onChange={(value) => set("memo_date", value)}
                disabled={!isDraft || locked}
                helperText={isDraft ? "Must be today when you submit." : "Fixed once submitted."}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <TextField
                label="Number"
                fullWidth
                value={memo?.memo_id ?? "On submission"}
                disabled
                helperText="yyyy-mm-dd · code · serial"
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Subject"
                fullWidth
                required
                value={values.subject}
                onChange={(e) => set("subject", e.target.value)}
                disabled={!isDraft || locked}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                CONTENT
              </Typography>
              {locked ? (
                <Box sx={{ mt: 0.5, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
                  <RichText html={memo?.content ?? ""} />
                </Box>
              ) : (
                <Box sx={{ mt: 0.5 }}>
                  <RichTextEditor
                    value={values.content}
                    onChange={(html) => set("content", html)}
                    disabled={!isNew && !memo?.can_edit_content}
                  />
                </Box>
              )}
              {!isDraft && !locked && memo?.can_edit_content ? (
                <Typography variant="caption" color="text.secondary">
                  The only field that can still be changed — that is what sending
                  a memorandum back is for.
                </Typography>
              ) : null}
            </Grid>

            {/* Attachments, fixed at submission like everything but the text. */}
            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                ATTACHMENTS
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {(memo?.attachments ?? []).map((attachment) => (
                  <Stack key={attachment.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <DescriptionIcon fontSize="small" color="action" />
                    <Typography
                      component="a"
                      href={attachment.file_url ?? attachment.file}
                      target="_blank"
                      rel="noopener"
                      variant="body2"
                      sx={{ flex: 1, color: "inherit" }}
                    >
                      {attachment.caption || attachment.file.split("/").pop()}
                    </Typography>
                    {isDraft && memo ? (
                      <IconButton
                        size="small"
                        onClick={() =>
                          removeAttachment.mutate({ id: memo.id, attachmentId: attachment.id })
                        }
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    ) : null}
                  </Stack>
                ))}
                {(memo?.attachments ?? []).length === 0 ? (
                  <Typography variant="body2" color="text.disabled">
                    {isNew
                      ? "Save the draft first — a file attaches to a memorandum, so there has to be one."
                      : "None. Optional."}
                  </Typography>
                ) : null}
              </Stack>
              {isDraft && memo ? (
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.5 }}>
                  <Button component="label" size="small" variant="outlined" startIcon={<AttachFileIcon />}>
                    {file ? file.name : "Choose a file"}
                    <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </Button>
                  <TextField
                    size="small"
                    label="Caption"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    sx={{ flex: 1 }}
                  />
                  <Button
                    size="small"
                    disabled={!file || addAttachment.isPending}
                    onClick={() =>
                      file &&
                      run(addAttachment.mutateAsync({ id: memo.id, file, caption }), () => {
                        setFile(null);
                        setCaption("");
                      })
                    }
                  >
                    Attach
                  </Button>
                </Stack>
              ) : isNew ? (
                <Typography variant="caption" color="text.secondary">
                  Save the draft first, then attach.
                </Typography>
              ) : null}
            </Grid>
          </Grid>
        ) : null}

        {tab === 1 ? (
          <ChainTab
            memo={memo}
            values={values}
            set={set}
            editable={isNew || Boolean(memo?.can_edit_chain)}
          />
        ) : null}

        {tab === 2 ? <HistoryTab memo={memo} /> : null}

        {/* ── The action bar ─────────────────────────────────────────────
            Only for whoever is holding it, and shaped by which end of the
            chain they are at: a recommender sends it on, the approver
            decides. Both can send it back. */}
        {memo?.can_act && !locked ? (
          <Box
            sx={(theme) => ({
              mt: 3,
              p: 2,
              borderRadius: 2,
              border: "1px solid",
              borderColor: theme.palette.primary.main,
              bgcolor: alpha(theme.palette.primary.main, 0.04),
            })}
          >
            <Typography variant="overline" color="text.secondary">
              {memo.my_role === "initiator"
                ? "This has been sent back to you"
                : "It is your turn"}
            </Typography>

            <TextField
              label="Comment"
              fullWidth
              multiline
              minRows={2}
              size="small"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              sx={{ mt: 1.5 }}
            />

            {memo.my_role === "initiator" ? (
              <Button
                variant="contained"
                startIcon={<SendIcon />}
                sx={{ mt: 1.5 }}
                disabled={busy}
                onClick={() =>
                  run(resubmit.mutateAsync({ id: memo.id, comment }), onClose)
                }
              >
                Send forward again
              </Button>
            ) : (
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ mt: 1.5 }}>
                {memo.stage === "approve" ? (
                  <>
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={<CheckCircleIcon />}
                      disabled={busy}
                      onClick={() => run(approve.mutateAsync({ id: memo.id, comment }), onClose)}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      disabled={busy}
                      onClick={() => run(reject.mutateAsync({ id: memo.id, comment }), onClose)}
                    >
                      Reject
                    </Button>
                  </>
                ) : (
                  <>
                    <TextField
                      select
                      size="small"
                      label="Record as"
                      value={actionId}
                      onChange={(e) => setActionId(Number(e.target.value))}
                      sx={{ minWidth: 220 }}
                    >
                      {proceedActions.map((a) => (
                        <MenuItem key={a.id} value={a.id}>
                          {a.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button
                      variant="contained"
                      startIcon={<SendIcon />}
                      disabled={busy || actionId === ""}
                      onClick={() =>
                        run(
                          proceed.mutateAsync({
                            id: memo.id,
                            action: Number(actionId),
                            comment,
                          }),
                          onClose
                        )
                      }
                    >
                      Send on
                    </Button>
                  </>
                )}

                <Box sx={{ flex: 1 }} />

                <TextField
                  select
                  size="small"
                  label="Send back to"
                  value={returnTo}
                  onChange={(e) => setReturnTo(Number(e.target.value))}
                  sx={{ minWidth: 200 }}
                  helperText="Defaults to the initiator."
                >
                  {memo.return_targets.map((target) => (
                    <MenuItem key={target.id} value={target.id}>
                      {target.name}
                      {target.is_initiator ? " · initiator" : ""}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={<UndoIcon />}
                  disabled={busy || returnTo === ""}
                  onClick={() =>
                    run(
                      sendBack.mutateAsync({
                        id: memo.id,
                        to: Number(returnTo),
                        action: returnActions[0]?.id ?? null,
                        comment,
                      }),
                      onClose
                    )
                  }
                >
                  Send back
                </Button>
              </Stack>
            )}
          </Box>
        ) : null}

        {/* Anybody who can see it may remark on it — a recommender two steps up
            who spots something should not have to wait for their turn. */}
        {/* Shown to everybody who can see it, holder included. A holder used
            to have only the note that rides along with approving or sending
            back — so the one person most likely to need to ask a question, or
            attach the thing they were asked for, could not do either without
            also moving the memorandum. */}
        {memo && !locked ? (
          <CommentComposer
            busy={addComment.isPending}
            comment={remark}
            onCommentChange={setRemark}
            mentions={mentions}
            onMentionsChange={setMentions}
            files={commentFiles}
            onFilesChange={setCommentFiles}
            onPost={() =>
              run(
                addComment.mutateAsync({
                  id: memo.id,
                  comment: remark,
                  mentionIds: mentions,
                  files: commentFiles,
                }),
                () => {
                  setRemark("");
                  setMentions([]);
                  setCommentFiles([]);
                }
              )
            }
          />
        ) : null}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {isDraft && !locked ? (
          <>
            {/* Two acts, two buttons. Save is reversible; Submit mints the
                number and fixes everything but the text. */}
            <Button disabled={busy || !values.subject.trim()} onClick={() => handleSave(false)}>
              Save draft
            </Button>
            <Button
              variant="contained"
              startIcon={<SendIcon />}
              disabled={busy || !values.subject.trim() || !values.company}
              onClick={() => handleSave(true)}
            >
              Submit
            </Button>
          </>
        ) : memo?.can_edit_content && !locked ? (
          <Button variant="contained" disabled={busy} onClick={() => handleSave(false)}>
            Save changes
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}

/* ── The chain ───────────────────────────────────────────────────────────── */

/**
 * Who sees it, in what order, and who signs it off.
 *
 * **Somebody who has handled it cannot be taken off.** Their comment is part of
 * the record and the chain is what it is attached to. Those rows are shown
 * locked rather than hidden, because a chain that silently drops the people
 * already in it is one nobody can check.
 */
function ChainTab({
  memo,
  values,
  set,
  editable,
}: {
  memo: Memorandum | null;
  values: MemorandumFormValues;
  set: <K extends keyof MemorandumFormValues>(k: K, v: MemorandumFormValues[K]) => void;
  editable: boolean;
}) {
  const lockedIds = new Set(
    (memo?.recommenders ?? []).filter((r) => r.has_acted || r.is_current).map((r) => r.employee)
  );

  return (
    <Stack spacing={2} sx={{ mt: 1 }}>
      <Alert severity="info">
        A memorandum goes to each recommender in turn, then to the approver.
        Anybody holding it can send it back — to you, or to somebody who has
        already seen it — and it comes forward again from there.
      </Alert>

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          RECOMMENDERS, IN ORDER
        </Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {(memo?.recommenders ?? []).map((row, index) => (
            <Stack key={row.id} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Avatar sx={{ width: 26, height: 26, fontSize: 12 }}>{index + 1}</Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {row.employee_name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.employee_code}
                  {row.designation ? ` · ${row.designation}` : ""}
                </Typography>
              </Box>
              {row.is_current ? <Chip size="small" color="warning" label="Here now" /> : null}
              {row.has_acted ? (
                <Tooltip title="Has handled it — cannot be removed">
                  <Chip size="small" icon={<LockIcon />} label="Acted" variant="outlined" />
                </Tooltip>
              ) : null}
            </Stack>
          ))}
          {(memo?.recommenders ?? []).length === 0 ? (
            <Typography variant="body2" color="text.disabled">
              Nobody yet.
            </Typography>
          ) : null}
        </Stack>
      </Box>

      {editable ? (
        <EmployeePicker
          label="Recommenders, in order"
          multiple
          value={values.recommender_ids}
          onChange={(ids) => {
            // Anybody already locked has to stay, and stay where they were.
            const kept = values.recommender_ids.filter((id) => lockedIds.has(id));
            const added = ids.filter((id) => !kept.includes(id));
            set("recommender_ids", [...kept, ...added]);
          }}
          helperText="The order you pick them is the order they see it."
        />
      ) : null}

      <Divider />

      <EmployeePicker
        label="Approver"
        value={values.approver}
        onChange={(id) => set("approver", id)}
        disabled={!editable || memo?.stage === "approve"}
        helperText={
          memo?.stage === "approve"
            ? "It is already with them — it has to be sent back before this can change."
            : "One person, and the only one who can end it."
        }
      />
    </Stack>
  );
}

/* ── The history ─────────────────────────────────────────────────────────── */

const KIND_COLOUR: Record<string, "primary" | "warning" | "success" | "error" | "info"> = {
  created: "info",
  submitted: "primary",
  proceeded: "primary",
  returned: "warning",
  resubmitted: "primary",
  approved: "success",
  rejected: "error",
  edited: "info",
  commented: "info",
};

/**
 * The cycle, in order, with every comment.
 *
 * This is what a memorandum is actually read for a year later: not what was
 * proposed but who agreed to it, in what words, and how many times it went
 * back first.
 */
function HistoryTab({ memo }: { memo: Memorandum | null }) {
  const events = memo?.events ?? [];
  if (events.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
        Nothing yet.
      </Typography>
    );
  }
  return (
    <Box sx={{ position: "relative", pl: 3, mt: 2 }}>
      <Box
        sx={{
          position: "absolute",
          left: 7,
          top: 8,
          bottom: 8,
          width: 2,
          bgcolor: "divider",
        }}
      />
      <Stack spacing={2.5}>
        {events.map((event) => (
          <Box key={event.id} sx={{ position: "relative" }}>
            <Box
              sx={(theme) => ({
                position: "absolute",
                left: -21,
                top: 4,
                width: 16,
                height: 16,
                borderRadius: "50%",
                bgcolor: "background.paper",
                border: "3px solid",
                borderColor: theme.palette[KIND_COLOUR[event.kind] ?? "info"].main,
              })}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {event.actor_label}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {event.action_label || event.kind_display.toLowerCase()}
              </Typography>
              {event.returned_to_name ? (
                <Chip size="small" variant="outlined" label={`to ${event.returned_to_name}`} />
              ) : null}
              {event.role ? (
                <Typography variant="caption" color="text.disabled">
                  · {event.role}
                </Typography>
              ) : null}
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.secondary">
                <DateText value={event.created_at} />
              </Typography>
            </Stack>
            {event.comment ? (
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
                {event.comment}
              </Typography>
            ) : null}

            {/* Who the remark was pointed at, and what came with it. Shown on
                the line itself rather than collected somewhere else, because a
                file's meaning is the sentence it answers. */}
            {event.mentions.length > 0 ? (
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, flexWrap: "wrap" }} useFlexGap>
                <Typography variant="caption" color="text.secondary">
                  Notified
                </Typography>
                {event.mentions.map((person) => (
                  <Chip key={person.id} size="small" variant="outlined" label={person.name} />
                ))}
              </Stack>
            ) : null}

            {event.attachments.length > 0 ? (
              <Stack spacing={0.25} sx={{ mt: 0.75 }}>
                {event.attachments.map((attachment) => (
                  <Stack
                    key={attachment.id}
                    direction="row"
                    spacing={0.75}
                    sx={{ alignItems: "center" }}
                  >
                    <DescriptionIcon sx={{ fontSize: 15 }} color="action" />
                    <Typography
                      component="a"
                      href={attachment.file_url ?? attachment.file}
                      target="_blank"
                      rel="noopener"
                      variant="caption"
                      sx={{ color: "primary.main" }}
                    >
                      {attachment.caption || attachment.file.split("/").pop()}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

/**
 * Say something, name whoever needs to see it, and attach what answers it.
 *
 * **Why a comment carries all three.** A memorandum's chain is chosen for who
 * must *decide*; the people who know the answer are usually not in it. Before
 * this, "can you check the ground conditions" left the product as an email and
 * the record kept no trace of the question or the reply. Naming somebody
 * notifies them and lets them read the memorandum — nothing more; acting on it
 * still means being the holder.
 *
 * **And why files are allowed here when the annexes are frozen.** The annexes
 * are part of the proposal: a chain that has read three of them must not find a
 * fourth appear underneath its signatures. A file on a comment is the opposite
 * — it is the survey somebody was sent back to fetch — and refusing it does not
 * keep the record clean, it moves the survey to email and leaves the record
 * incomplete.
 */
function CommentComposer({
  comment,
  onCommentChange,
  mentions,
  onMentionsChange,
  files,
  onFilesChange,
  onPost,
  busy,
}: {
  comment: string;
  onCommentChange: (value: string) => void;
  mentions: number[];
  onMentionsChange: (ids: number[]) => void;
  files: File[];
  onFilesChange: (files: File[]) => void;
  onPost: () => void;
  busy: boolean;
}) {
  return (
    <Box sx={{ mt: 3, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
      <TextField
        size="small"
        label="Add a comment"
        fullWidth
        multiline
        minRows={2}
        value={comment}
        onChange={(event) => onCommentChange(event.target.value)}
      />

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ mt: 1.5, alignItems: { sm: "center" } }}
      >
        <EmployeePicker
          multiple
          label="Notify"
          value={mentions}
          onChange={onMentionsChange}
          placeholder="Nobody"
          size="small"
          sx={{ flex: 1, minWidth: 220 }}
        />
        <Button component="label" size="small" startIcon={<AttachFileIcon />}>
          Attach
          <input
            type="file"
            hidden
            multiple
            onChange={(event) => {
              // Appended rather than replaced: choosing a second file should
              // not silently drop the first, which is what a plain assignment
              // does and what makes a multi-file picker feel broken.
              const chosen = Array.from(event.target.files ?? []);
              if (chosen.length > 0) onFilesChange([...files, ...chosen]);
              event.target.value = "";
            }}
          />
        </Button>
        <Button
          variant="contained"
          size="small"
          disabled={busy || (!comment.trim() && files.length === 0)}
          onClick={onPost}
        >
          Comment
        </Button>
      </Stack>

      {files.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap" }} useFlexGap>
          {files.map((chosen, index) => (
            <Chip
              key={`${chosen.name}-${index}`}
              size="small"
              icon={<DescriptionIcon />}
              label={chosen.name}
              onDelete={() => onFilesChange(files.filter((_, i) => i !== index))}
            />
          ))}
        </Stack>
      ) : null}

      {mentions.length > 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          They will be told, and will be able to read this memorandum.
        </Typography>
      ) : null}
    </Box>
  );
}
