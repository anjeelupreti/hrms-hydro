"use client";

import AttachFileIcon from "@mui/icons-material/AttachFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DescriptionIcon from "@mui/icons-material/Description";
import LockIcon from "@mui/icons-material/Lock";
import SendIcon from "@mui/icons-material/Send";
import SkipNextIcon from "@mui/icons-material/SkipNext";
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
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
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
import MemorandumLetter from "@/components/memoranda/MemorandumLetter";
import { withCode } from "@/lib/people";
import { useCompanies } from "@/hooks/useCompanies";
import { useEmployees } from "@/hooks/useEmployees";
import { useMe } from "@/hooks/useMe";
import {
  useAddMemorandumAttachment,
  useApproveMemorandum,
  useCommentOnMemorandum,
  useDeleteMemorandum,
  useMemorandumActions,
  useProceedMemorandum,
  useRejectMemorandum,
  useRemoveMemorandumAttachment,
  useResubmitMemorandum,
  useSkipMemorandum,
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
  const skipHolder = useSkipMemorandum();
  const approve = useApproveMemorandum();
  const reject = useRejectMemorandum();
  const addComment = useCommentOnMemorandum();
  const destroy = useDeleteMemorandum();
  const addAttachment = useAddMemorandumAttachment();
  const removeAttachment = useRemoveMemorandumAttachment();
  const { data: actionPage } = useMemorandumActions();
  const { data: me } = useMe();

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
  const [skipReason, setSkipReason] = useState("");
  const [commentFiles, setCommentFiles] = useState<File[]>([]);

  const isNew = memo === null;
  const isDraft = isNew || memo?.status === "draft";
  const locked = Boolean(memo?.is_locked);

  /** The chain and the approver move together, and only before the memorandum
   *  has reached them. */
  const canEditChain = !locked && (isNew || Boolean(memo?.can_edit_chain));
  /** The one field that survives submission — see `can_edit_content`. */
  const canEditBody = !locked && (isNew || Boolean(memo?.can_edit_content));
  /**
   * Attachments are the initiator's, and only on their turn.
   *
   * That is a draft, or one that has been sent back to them — "initiated or
   * re-initiated". At any other point the chain is reading a fixed set of
   * annexes and a new one appearing under their signatures would change the
   * document they signed.
   */
  const canAttach =
    !locked &&
    !isNew &&
    memo !== null &&
    (memo.status === "draft" ||
      (memo.my_role === "initiator" && memo.current_holder === memo.initiator));

  /**
   * Can this person move it past whoever is holding it?
   *
   * The initiator only, while it is in flight, on somebody else's desk, and not
   * yet at the approver — mirroring `workflow.skip`, which refuses each of
   * those. Drawn from the record's own fields rather than a server flag because
   * every part of the rule is already on it; a flag would be a fifth thing to
   * keep in step.
   */
  const canSkip =
    !locked &&
    memo !== null &&
    memo.status === "in_progress" &&
    memo.my_role === "initiator" &&
    memo.stage !== "approve" &&
    memo.current_holder !== null &&
    memo.current_holder !== memo.initiator;

  const { data: companyPage } = useCompanies();
  const companyName =
    companyPage?.results?.find((c) => c.id === values.company)?.name ?? memo?.company_name ?? null;
  const approverName = memo?.approver === values.approver ? memo?.approver_name ?? null : null;

  /**
   * The Through line, in the order the chain will see it.
   *
   * Read from the *form values* rather than the saved record, so somebody
   * picking recommenders watches them appear on the page. Falls back to the
   * saved row's name when the directory page has not loaded that person.
   */
  const { data: staffPage } = useEmployees({ page: 1, pageSize: 200 });
  const throughNames = values.recommender_ids
    .map((id) => {
      const person = staffPage?.results?.find((row) => row.id === id);
      if (person) return withCode(person.full_name, person.employee_code);
      const saved = memo?.recommenders.find((row) => row.employee === id);
      return saved ? withCode(saved.employee_name, saved.employee_code) : null;
    })
    .filter((name): name is string => Boolean(name));

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

  /**
   * Pre-select the first word, so the primary button is not dead on arrival.
   *
   * "Send on" is disabled until something is chosen, which is right — the word
   * goes in the permanent log and guessing one on somebody's behalf is not the
   * system's to do. But it left the main action greyed out the moment the
   * dialog opened, which reads as broken rather than as waiting. Choosing the
   * first configured word is a default the reader can see and change, not a
   * silent one: the select shows what will be recorded.
   */
  useEffect(() => {
    if (actionId === "" && proceedActions.length > 0) {
      setActionId(proceedActions[0].id);
    }
  }, [actionId, proceedActions]);

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
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {isNew
              ? "New memorandum"
              : isDraft
                ? "Draft memorandum"
                : "Memorandum"}
          </Typography>
          {locked ? <Chip size="small" icon={<LockIcon />} label="Closed" /> : null}
        </Stack>
      </DialogTitle>

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
          <Skeleton variant="rounded" height={480} />
        ) : (
          /* ── Page on the left, everything else on the right ────────────
             The controls used to sit *inside* the page, in the places their
             values print. It read well as an idea and badly on screen: a
             rich-text toolbar inside a white sheet inherits the sheet's serif
             and its ink, so the controls washed out against the paper and the
             thing meant to look like a document looked like a form wearing one.

             Split, each half gets to be itself. The page renders live as the
             column beside it is typed into — which is the same immediacy the
             in-place editing was reaching for, without the two fighting over
             one set of colours. It is also how the reader thinks about it:
             the document, and the work being done to it. */
          <RichTextEditor
            value={values.content}
            disabled={!canEditBody}
            onChange={(html) => set("content", html)}
            // The page's own face and ink, so the words look on screen the way
            // they will look printed. Without this the surface keeps the
            // application's sans-serif on the application's background and the
            // letter has a grey rectangle stamped into the middle of it.
            surfaceSx={{
              p: 0,
              minHeight: 0,
              fontFamily: "inherit",
              fontSize: ".95rem",
              lineHeight: 1.75,
              color: "#16181d",
              "& p": { margin: "0 0 .85em" },
              "& ul, & ol": { margin: "0 0 .85em", paddingLeft: "1.4em" },
            }}
            renderLayout={({ toolbar, surface }) => (
              <Stack spacing={2}>
                {/* ── The ribbon ───────────────────────────────────────────
                    Across the top, the way a word processor puts it, rather
                    than welded to a box in a column. Somebody who has written
                    memoranda on paper for thirty years is being asked to do it
                    on a screen; the closer this is to the tool they already
                    know, the less of it they have to be taught.

                    Sticky, because the page below is a metre of A4 and controls
                    that scroll away are controls you have to go and find. */}
                {canEditBody ? (
                  <Box
                    sx={(theme) => ({
                      position: "sticky",
                      top: 0,
                      zIndex: 3,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 2,
                      overflow: "hidden",
                      // 🔒 `theme.vars`, not `theme.palette`. The theme is built
                      // with `cssVariables` + `colorSchemes`, so reading
                      // `theme.palette.background.paper` here resolves the
                      // *light* value once and keeps it — this bar came out
                      // white in dark mode, under white icons, which read as
                      // the toolbar having no controls at all.
                      bgcolor: theme.vars.palette.background.paper,
                    })}
                  >
                    {toolbar}
                  </Box>
                ) : null}

                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={3}
                  sx={{ alignItems: "flex-start" }}
                >
                  {/* ── The page ─────────────────────────────────────────
                      The whole left side, and the writing happens on it: the
                      surface goes into the letter's body, so the words land
                      where they will print instead of in a form beside a
                      preview of themselves. */}
                  <Box sx={{ flex: { md: "1 1 62%" }, minWidth: 0, width: "100%" }}>
                    <MemorandumLetter
                      printable
                      memo={memo}
                      body={canEditBody ? surface : undefined}
                      draft={{
                        subject: values.subject,
                        content: values.content,
                        memo_date: values.memo_date,
                        companyName,
                        approverName,
                        throughNames,
                        fromName: me ? withCode(me.full_name, me.employee_code) : null,
                      }}
                    />
                  </Box>

                  {/* ── The rail ─────────────────────────────────────────
                      Whose turn it is first, because that is the question
                      anybody opening this has; then who signs it, then what
                      has happened. Sticky for the same reason the ribbon is —
                      the page beside it is taller than the screen. */}
                  <Stack
                    spacing={3}
                    sx={{
                      flex: { md: "1 1 38%" },
                      minWidth: 0,
                      width: "100%",
                      position: { md: "sticky" },
                      top: { md: 64 },
                      maxHeight: { md: "calc(100vh - 190px)" },
                      overflowY: { md: "auto" },
                      pr: { md: 0.5 },
                    }}
                  >
                    <WhoseTurn memo={memo} isNew={isNew} />

                    {/* **Routing around somebody who is away.**
                        The chain has no timeout and only the holder can act, so
                        a recommender on leave stops the memorandum dead. This
                        is the initiator's way past — and only theirs, only
                        while somebody else is holding it, and never over the
                        approver, who has nobody after them to send it to. */}
                    {canSkip ? (
                      <Box>
                        <SectionHeading
                          title="Waiting on somebody who is away?"
                          hint="Moves it to the next person. Recorded as a skip, not as their recommendation."
                        />
                        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                          <TextField
                            label="Why (optional)"
                            size="small"
                            fullWidth
                            value={skipReason}
                            onChange={(event) => setSkipReason(event.target.value)}
                            placeholder="On leave until Sunday"
                          />
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            startIcon={<SkipNextIcon />}
                            disabled={skipHolder.isPending}
                            onClick={() => {
                              if (!memo) return;
                              run(
                                skipHolder.mutateAsync({ id: memo.id, comment: skipReason }),
                                () => setSkipReason("")
                              );
                            }}
                            sx={{ alignSelf: "flex-start" }}
                          >
                            Move past {memo?.current_holder_name ?? "them"}
                          </Button>
                        </Stack>
                      </Box>
                    ) : null}

                    {isDraft && !locked ? (
                      <Box>
                        <SectionHeading
                          title="Basic details"
                          hint="Fixed once the memorandum is on its way."
                        />
                        <Stack spacing={2} sx={{ mt: 1.5 }}>
                          <CompanyPicker
                            label="Company"
                            required
                            value={values.company}
                            onChange={(id) => set("company", id)}
                            size="small"
                            helperText="Its code goes into the memorandum number."
                          />
                          <DateField
                            label="Date"
                            required
                            value={values.memo_date}
                            onChange={(value) => set("memo_date", value)}
                            helperText="Must be today when you submit."
                          />
                          <TextField
                            label="Subject"
                            fullWidth
                            required
                            size="small"
                            value={values.subject}
                            onChange={(e) => set("subject", e.target.value)}
                          />
                        </Stack>
                      </Box>
                    ) : null}

                    <ChainTab
                      memo={memo}
                      values={values}
                      set={set}
                      editable={isNew || Boolean(memo?.can_edit_chain)}
                    />

                    <AttachmentsSection
                      memo={memo}
                      isNew={isNew}
                      canAttach={canAttach}
                      file={file}
                      setFile={setFile}
                      caption={caption}
                      setCaption={setCaption}
                      onAttach={() => {
                        if (!memo || !file) return;
                        run(addAttachment.mutateAsync({ id: memo.id, file, caption }), () => {
                          setFile(null);
                          setCaption("");
                        });
                      }}
                      onRemove={(attachmentId) => {
                        if (!memo) return;
                        removeAttachment.mutate({ id: memo.id, attachmentId });
                      }}
                      busy={addAttachment.isPending}
                    />

                    <HistoryTab memo={memo} />
                  </Stack>
                </Stack>
              </Stack>
            )}
          />
        )}

        {/* ── The action bar ─────────────────────────────────────────────
            Only for whoever is holding it, and shaped by which end of the
            chain they are at: a recommender sends it on, the approver
            decides. Both can send it back. */}
        {memo?.can_act && !locked ? (
          <Box
            sx={(theme) => ({
              mt: 3,
              p: 2.5,
              borderRadius: 2,
              border: "1px solid",
              borderColor: theme.vars.palette.primary.main,
              bgcolor: `rgba(${theme.vars.palette.primary.mainChannel} / 0.04)`,
            })}
          >
            <Typography
              variant="overline"
              sx={{ fontWeight: 800, color: "primary.main", letterSpacing: ".1em" }}
            >
              {memo.my_role === "initiator"
                ? "This has been sent back to you"
                : "It is your turn"}
            </Typography>

            {/* One note, and it says what it is for.
                There used to be a box labelled "Comment" here and a second
                composer labelled "Add a comment" immediately underneath, which
                left the reader to work out which of two identical-looking boxes
                did what. This one travels with the decision; the other one is
                for saying something *without* moving the memorandum, and both
                now say so. */}
            <TextField
              label="Note to go with your decision"
              placeholder="Optional — it is recorded against whichever button you press."
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
                sx={{ mt: 2 }}
                disabled={busy}
                onClick={() =>
                  run(resubmit.mutateAsync({ id: memo.id, comment }), onClose)
                }
              >
                Send forward again
              </Button>
            ) : (
              /* Two decisions, stacked and separated — not one row.
                 They used to sit side by side with a flex spacer between them,
                 which read as a single strip of controls rather than as the two
                 opposite things they are: send it on, or send it back. Anybody
                 scanning it had to notice a gap to tell them apart. */
              <Stack spacing={2} sx={{ mt: 2 }}>
                <Box>
                  {/* No overline heading above these.
                      There was one — "SEND IT ON" — and it landed in exactly the
                      same few pixels as the floating "Record as" label that sits
                      above the field's top edge, so the two words overlapped. It
                      was redundant as well as colliding: the field's own label
                      already says what the control is, and the button says what
                      pressing it does. */}
                  {memo.stage === "approve" ? (
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
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
                    </Stack>
                  ) : (
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1.5}
                      sx={{ alignItems: { sm: "flex-start" } }}
                    >
                      <TextField
                        select
                        size="small"
                        label="Record as"
                        value={actionId}
                        onChange={(e) => setActionId(Number(e.target.value))}
                        sx={{ minWidth: 240 }}
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
                        sx={{ py: 1, px: 2.5 }}
                      >
                        Send on
                      </Button>
                    </Stack>
                  )}
                </Box>

                <Divider sx={{ "&::before, &::after": { top: 0 } }}>
                  <Typography variant="caption" color="text.disabled">
                    or
                  </Typography>
                </Divider>

                <Box>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    sx={{ alignItems: { sm: "flex-start" } }}
                  >
                    <TextField
                      select
                      size="small"
                      label="Send back to"
                      value={returnTo}
                      onChange={(e) => setReturnTo(Number(e.target.value))}
                      sx={{ minWidth: 260 }}
                      helperText="The initiator, or anybody who has already seen it."
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
                      sx={{ py: 1, px: 2.5 }}
                    >
                      Send back
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            )}
          </Box>
        ) : null}

        {/* Anybody who can see it may remark on it — a recommender two steps up
            who spots something should not have to wait for their turn. */}
        {/* **One comment box per person, and it depends whose turn it is.**
            Whoever is holding it comments in the action panel above — the note
            travels with the decision, which is the comment they actually want
            to leave, and offering a second box underneath asks them to choose
            between two things that look the same. Everybody else gets this one,
            which is the only way they can say anything at all. */}
        {memo && !locked && !memo.can_act ? (
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

        {/* A draft nobody has seen is the one thing here that can be deleted.
            Once submitted it has a number in the company's register and people
            have written on it — the server refuses, and says to have it
            rejected instead. */}
        {memo && isDraft && memo.my_role === "initiator" ? (
          <Button
            color="error"
            disabled={busy || destroy.isPending}
            onClick={() => run(destroy.mutateAsync(memo.id), onClose)}
          >
            Delete draft
          </Button>
        ) : null}
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
    <Stack spacing={2}>
      <SectionHeading
        title="Who signs it"
        hint="Recommenders in order, then one approver."
      />
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

      {/* The approver sits beside the chain, not under it: they are the end of
          the same routing decision, and putting them in a separate band made
          the two look like unrelated settings. */}
      <Box sx={{ maxWidth: { sm: 420 }, pt: 1.5 }}>
        <EmployeePicker
          label="Approver — the To of the letter"
          value={values.approver}
          onChange={(id) => set("approver", id)}
          disabled={!editable || memo?.stage === "approve"}
          excludeIds={values.recommender_ids}
          helperText={
            memo?.stage === "approve"
              ? "It is already with them — it has to be sent back before this can change."
              : "One person, and the only one who can end it."
          }
        />
      </Box>
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
  skipped: "warning",
};

/**
 * The cycle, in order, with every comment.
 *
 * This is what a memorandum is actually read for a year later: not what was
 * proposed but who agreed to it, in what words, and how many times it went
 * back first.
 */
function HistoryTab({ memo }: { memo: Memorandum | null }) {
  /**
   * How many times this has been round the loop.
   *
   * A memorandum that was sent back, fixed and sent up again looks identical to
   * one that went straight through — same chain, same words, same holder — and
   * the difference is exactly what a reader wants to know. Counted from the
   * log, which is the only place that remembers.
   */
  const rounds = (memo?.events ?? []).filter((e) => e.kind === "resubmitted").length;
  const events = memo?.events ?? [];
  const heading = (
    <SectionHeading
      title="What has happened to it"
      count={events.length}
      hint={
        rounds > 0
          ? rounds === 1
            ? "Sent back once and started again."
            : `Sent back and started again ${rounds} times.`
          : undefined
      }
    />
  );

  if (events.length === 0) {
    return (
      <Box>
        {heading}
        <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
          Nothing yet.
        </Typography>
      </Box>
    );
  }
  return (
    <Box>
      {heading}
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
                  <Chip
                    key={person.id}
                    size="small"
                    variant="outlined"
                    label={withCode(person.name, person.employee_code)}
                  />
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
        label="Comment without moving it"
        placeholder="Ask a question, attach a document, or point somebody at this."
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

/**
 * The annexes, and who may add one.
 *
 * **The initiator's, and only on their turn.** A memorandum that has been round
 * three desks has been read with a fixed set of papers behind it, and a fourth
 * appearing underneath those signatures changes the document that was signed.
 * So attaching is open in exactly two states: while it is still a draft, and
 * while it is back with the initiator after being sent down — initiated, or
 * re-initiated. Everywhere else the list is there to read and nothing else.
 *
 * Files that arrived on a *comment* are not here. Those belong to the remark
 * that carried them, are shown with it in the history, and are not part of the
 * proposal — which is the whole distinction the freeze rule protects.
 */
function AttachmentsSection({
  memo,
  isNew,
  canAttach,
  file,
  setFile,
  caption,
  setCaption,
  onAttach,
  onRemove,
  busy,
}: {
  memo: Memorandum | null;
  isNew: boolean;
  canAttach: boolean;
  file: File | null;
  setFile: (file: File | null) => void;
  caption: string;
  setCaption: (caption: string) => void;
  onAttach: () => void;
  onRemove: (attachmentId: number) => void;
  busy: boolean;
}) {
  const attachments = memo?.attachments ?? [];

  return (
    <Box>
      <SectionHeading
        title="Attachments"
        hint={
          canAttach
            ? "Yours to add while the memorandum is with you."
            : "Fixed once it is on its way."
        }
        count={attachments.length}
      />

      <Stack spacing={0.5} sx={{ mt: 1 }}>
        {attachments.map((attachment) => (
          <Stack
            key={attachment.id}
            direction="row"
            spacing={1}
            sx={{ alignItems: "center" }}
          >
            <DescriptionIcon fontSize="small" color="action" />
            <Typography
              component="a"
              href={attachment.file_url ?? attachment.file}
              target="_blank"
              rel="noopener"
              variant="body2"
              sx={{ flex: 1, color: "primary.main" }}
            >
              {attachment.caption || attachment.file.split("/").pop()}
            </Typography>
            {canAttach ? (
              <Tooltip title="Remove">
                <IconButton size="small" onClick={() => onRemove(attachment.id)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>
        ))}

        {attachments.length === 0 ? (
          <Typography variant="body2" color="text.disabled">
            {isNew
              ? "Save the draft first — a file attaches to a memorandum, so there has to be one."
              : "None."}
          </Typography>
        ) : null}
      </Stack>

      {canAttach ? (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ mt: 1.5, alignItems: { sm: "center" } }}
        >
          <Button component="label" size="small" variant="outlined" startIcon={<AttachFileIcon />}>
            {file ? file.name : "Choose a file"}
            <input
              type="file"
              hidden
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Button>
          <TextField
            size="small"
            label="Caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            sx={{ flex: 1 }}
          />
          <Button size="small" variant="contained" disabled={!file || busy} onClick={onAttach}>
            Attach
          </Button>
        </Stack>
      ) : null}
    </Box>
  );
}

/** The heading over each band below the letter. One shape, so the three
 *  sections read as a sequence rather than three unrelated cards. */
function SectionHeading({
  title,
  hint,
  count,
}: {
  title: string;
  hint?: string;
  count?: number;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap" }} useFlexGap>
      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
        {title}
      </Typography>
      {count !== undefined ? <Chip size="small" label={count} /> : null}
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Stack>
  );
}

/**
 * Whose desk it is on, and what it is.
 *
 * **The first question anybody opening a memorandum has.** It was answerable
 * only by reading the status chip in one corner, the holder chip in another and
 * the chain further down — three places for one sentence. The client's own
 * template puts From, To, Current Handler and Status in a block at the top, and
 * they are right: on paper that block is what you look at before you read a
 * word of it.
 */
function WhoseTurn({ memo, isNew }: { memo: Memorandum | null; isNew: boolean }) {
  if (isNew || !memo) {
    return (
      <Alert severity="info" icon={false} sx={{ py: 1 }}>
        A new memorandum. It gets its number when you submit it.
      </Alert>
    );
  }

  const rows: [string, React.ReactNode][] = [
    ["Reference", memo.memo_id ?? "issued on submission"],
    ["From", withCode(memo.initiator_name, memo.initiator_code)],
    ["To", memo.approver_name ? withCode(memo.approver_name, memo.approver_code) : "—"],
    [
      "With",
      memo.current_holder_name ? withCode(memo.current_holder_name, memo.current_holder_code) : "—",
    ],
  ];

  return (
    <Box
      sx={(theme) => ({
        p: 2,
        borderRadius: 2,
        border: "1px solid",
        // 🔒 `theme.vars` throughout. `theme.palette` under this theme is
        // resolved once against the light scheme and never updates, so the
        // "not your turn" ground came out as a light wash on a dark dialog.
        borderColor: memo.can_act ? theme.vars.palette.primary.main : theme.vars.palette.divider,
        bgcolor: memo.can_act
          ? `rgba(${theme.vars.palette.primary.mainChannel} / 0.05)`
          : theme.vars.palette.action.hover,
      })}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5, flexWrap: "wrap" }} useFlexGap>
        <StateChip label={memo.status_display} tone={MEMO_STATUS_TONE[memo.status]} />
        {/* Said plainly rather than left to be worked out from the holder's
            name. "It is your turn" is the whole reason somebody opens this. */}
        {memo.can_act ? (
          <Chip size="small" color="primary" label="It is your turn" />
        ) : null}
      </Stack>

      <Stack spacing={0.75}>
        {rows.map(([label, value]) => (
          <Stack key={label} direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ width: 76, flexShrink: 0, textTransform: "uppercase", letterSpacing: ".04em" }}
            >
              {label}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }}>
              {value}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
