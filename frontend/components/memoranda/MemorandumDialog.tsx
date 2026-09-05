"use client";

import AttachFileIcon from "@mui/icons-material/AttachFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DescriptionIcon from "@mui/icons-material/Description";
import LockIcon from "@mui/icons-material/Lock";
import SendIcon from "@mui/icons-material/Send";
import DrawIcon from "@mui/icons-material/Draw";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
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
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
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
  useDeleteMemorandum,
  useMemorandumActions,
  useProceedMemorandum,
  useRejectMemorandum,
  useRemoveMemorandumAttachment,
  useResubmitMemorandum,
  usePlaceSignature,
  useSignMemorandum,
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

/**
 * An input that looks like a blank on a form, not like a control on a screen.
 *
 * No outline, no filled ground, the page's own serif and ink — so the letter
 * reads as a letter with something typed into it. The underline is the ruled
 * line a paper form would have; it darkens on hover so the blank is findable
 * without having to click around for it.
 */
const INLINE_INPUT = {
  // The outline is removed rather than the variant changed: `CompanyPicker` and
  // `DateField` wrap their own inputs and do not forward `variant`, and giving
  // two shared components a prop for the benefit of one screen is the wrong
  // trade. A bottom rule is drawn back on — that is the ruled line a paper form
  // has, and it darkens on hover so the blank can be found without hunting.
  "& .MuiOutlinedInput-notchedOutline": { border: "none" },
  "& .MuiInputBase-root": {
    fontFamily: '"Georgia", "Times New Roman", serif',
    fontSize: ".95rem",
    color: "#16181d",
    borderBottom: "1px solid rgba(22,24,29,0.25)",
    borderRadius: 0,
    "&:hover": { borderBottomColor: "rgba(22,24,29,0.55)" },
    "&.Mui-focused": { borderBottomColor: "#16181d" },
  },
  "& .MuiInputBase-input": { padding: "1px 0" },
  "& .MuiSvgIcon-root": { color: "rgba(22,24,29,0.45)" },
} as const;

/** The same, sized for the company name across the top of the letterhead. */
const LETTERHEAD_INPUT = {
  ...INLINE_INPUT,
  // **Wide, because it holds a company name.** Left to shrink to fit, the
  // picker rendered as "Ty…" — an autocomplete sizes itself to its input, and
  // an input with no width is as narrow as the box will allow. The letterhead
  // is the full width of the page and the name belongs across it.
  width: "100%",
  minWidth: 320,
  "& .MuiInputBase-root": {
    ...INLINE_INPUT["& .MuiInputBase-root"],
    fontSize: "1.35rem",
    fontWeight: 700,
  },
  "& .MuiInputBase-input": { padding: "1px 0", textAlign: "center" },
} as const;

/** The date sits on one line beside Ref, so it is sized to its content. */
const DATE_INPUT = {
  ...INLINE_INPUT,
  width: 190,
  "& .MuiInputBase-input": { padding: "1px 0" },
} as const;

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
  const signMemo = useSignMemorandum();
  const placeSignature = usePlaceSignature();
  const approve = useApproveMemorandum();
  const reject = useRejectMemorandum();
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
  const [skipReason, setSkipReason] = useState("");
  /**
   * Editing, or looking at it.
   *
   * Starts on Edit for a draft you are writing and on Preview for anything
   * else — opening a memorandum that is with somebody else to read it is by
   * far the commonest thing anybody does here, and landing them in an editor
   * asks them to work out that they are not meant to be typing.
   */
  const [editing, setEditing] = useState(true);

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
    // A new memorandum is written; an existing one is usually read.
    setEditing(memo === null || memo.status === "draft");
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
                    Across the top, the way a word processor puts it. Sticky,
                    because the page below is a metre of A4 and controls that
                    scroll away are controls you have to go and find.

                    **Only while editing.** Reading a memorandum needs no
                    toolbar, and Preview takes it away — which is the whole
                    point of the toggle beside it. */}
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    position: "sticky",
                    top: 0,
                    zIndex: 3,
                    alignItems: "flex-start",
                  }}
                >
                  {editing && canEditBody ? (
                    <Box
                      sx={(theme) => ({
                        flex: 1,
                        minWidth: 0,
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 2,
                        overflow: "hidden",
                        bgcolor: theme.vars.palette.background.paper,
                      })}
                    >
                      {toolbar}
                    </Box>
                  ) : (
                    <Box sx={{ flex: 1 }} />
                  )}

                  {/* **One surface, and a switch — not two panes.**

                      This was an editor on the right and a live preview of it
                      on the left: two copies of the same document, side by
                      side, each half the width it wanted. What somebody
                      filling in a form needs is the form, and what they need
                      afterwards is to see it clean. So the page is the only
                      surface, and Preview takes the blanks and the ribbon away
                      rather than putting a second copy beside them. */}
                  {/* **Signing is a button, not a side effect.**
                      Nothing is applied when somebody recommends or approves —
                      a mark a workflow made for you means nothing by it. This
                      places their own, and it can then be dragged to where it
                      belongs: a recommender signs in the margin beside their
                      remark, the approver at the foot, and which is which
                      carries meaning. */}
                  {memo && !locked && (memo.can_sign || memo.has_signed) ? (
                    <Button
                      size="small"
                      variant={memo.has_signed ? "outlined" : "contained"}
                      color={memo.has_signed ? "inherit" : "primary"}
                      startIcon={<DrawIcon />}
                      disabled={signMemo.isPending}
                      onClick={() =>
                        run(signMemo.mutateAsync({ id: memo.id, sign: !memo.has_signed }))
                      }
                      sx={{ flexShrink: 0 }}
                    >
                      {memo.has_signed ? "Remove my signature" : "Sign"}
                    </Button>
                  ) : null}

                  {canEditBody ? (
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={editing ? "edit" : "preview"}
                      onChange={(_event, next) => {
                        if (next) setEditing(next === "edit");
                      }}
                      sx={(theme) => ({
                        bgcolor: theme.vars.palette.background.paper,
                        flexShrink: 0,
                      })}
                    >
                      <ToggleButton value="edit" sx={{ px: 1.5 }}>
                        <EditIcon fontSize="small" sx={{ mr: 0.75 }} />
                        Edit
                      </ToggleButton>
                      <ToggleButton value="preview" sx={{ px: 1.5 }}>
                        <VisibilityIcon fontSize="small" sx={{ mr: 0.75 }} />
                        Preview
                      </ToggleButton>
                    </ToggleButtonGroup>
                  ) : null}
                </Stack>

                {/* ── The page, and nothing beside it ──────────────────── */}
                <MemorandumLetter
                  printable
                  memo={memo}
                  body={editing && canEditBody ? surface : undefined}
                  history={memo?.events ?? []}
                  meId={me?.employee_id ?? null}
                  // Passed only when they have signed and it can still be
                  // changed — its presence is what makes their own mark
                  // draggable, so a locked memorandum's marks are fixed.
                  onMoveSignature={
                    memo && memo.has_signed && !locked
                      ? (x, y, page) => placeSignature.mutate({ id: memo.id, x, y, page })
                      : undefined
                  }
                  fields={
                    editing && canEditBody
                      ? {
                          company: (
                            <CompanyPicker
                              label=""
                              value={values.company}
                              onChange={(id) => set("company", id)}
                              size="small"
                              sx={LETTERHEAD_INPUT}
                            />
                          ),
                          date: isDraft ? (
                            <DateField
                              label=""
                              value={values.memo_date}
                              onChange={(value) => set("memo_date", value)}
                              size="small"
                              sx={DATE_INPUT}
                            />
                          ) : undefined,
                          subject: isDraft ? (
                            <TextField
                              placeholder="Subject"
                              fullWidth
                              size="small"
                              value={values.subject}
                              onChange={(e) => set("subject", e.target.value)}
                              sx={INLINE_INPUT}
                            />
                          ) : undefined,
                        }
                      : undefined
                  }
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

                {/* ── The rest of the form, under the page ──────────────
                    **Only while editing.** These are inputs — who signs it,
                    what is attached — and they belong with the other inputs,
                    beneath the sheet rather than in a column beside it. In
                    Preview they are gone, which is what makes Preview worth
                    pressing. */}
                {editing ? (
                  <Stack spacing={3} sx={{ pt: 1 }}>
                    <WhoseTurn memo={memo} isNew={isNew} />

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
                  </Stack>
                ) : null}
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

        {/* **No standalone comment box, deliberately.**

            There was one, shown to everybody *except* the person holding the
            memorandum — which is exactly backwards. A comment on a memorandum
            is a contribution to a decision, and the only person making one is
            whoever it is with. Anybody else adding remarks produces a document
            with opinions on it from people who never had to act, and a holder
            who has to read them all before doing so.

            So a comment now travels with an action and nowhere else: the note
            typed in the action panel above, which is attached to the proceed,
            the return or the decision. Somebody who is not holding it has
            nothing to say here yet — and when it reaches them, they will. */}

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

/* `HistoryTab` lived here and is gone: the action log prints on the page
   itself now — see `MemorandumLetter`'s `history` — because on this document
   the history is content rather than a side panel, and a second rendering of
   it beside the page would be the same list twice. */


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
