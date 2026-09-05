"use client";

import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DescriptionIcon from "@mui/icons-material/Description";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import SendIcon from "@mui/icons-material/Send";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateText from "@/components/common/DateText";
import RichTextEditor from "@/components/common/RichTextEditor";
import MinutesSheet from "@/components/meetings/MinutesSheet";
import {
  useAddAgendaItem,
  useAddDecision,
  useAgenda,
  useCirculateDecision,
  useDecisions,
  useDraftMinutes,
  useFinaliseMinutes,
  useMarkAttendance,
  useMeeting,
  useMinutes,
  useRemoveAgendaItem,
  useRespondToDecision,
  useSaveMinutes,
} from "@/hooks/useMeetingRecord";
import { useMe } from "@/hooks/useMe";
import { withCode } from "@/lib/people";
import type { MeetingAttendee, MeetingDecision } from "@/types/meetings";

/**
 * A meeting and everything it produced.
 *
 * **Four things in the order they happen**, which is also the order they
 * depend on each other: the agenda is what will be discussed, the register is
 * who was there, the decisions are what was settled, and the minute is written
 * from all three. Tabs rather than one long scroll because they are used at
 * different moments — the agenda before, the register straight after, the
 * decisions over the following days, the minute once those are answered.
 */
export default function MeetingRecordDialog({
  meetingId,
  onClose,
}: {
  meetingId: number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const { data: meeting, isPending } = useMeeting(meetingId);
  const { data: me } = useMe();

  const isOrganiser = Boolean(
    meeting && me && (meeting as unknown as { created_by?: number }).created_by === me.id
  );

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>
        {isPending ? (
          <Skeleton width={260} />
        ) : (
          <>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {meeting?.title}
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", mt: 0.5 }} useFlexGap>
              <Typography variant="body2" color="text.secondary">
                <DateText value={meeting?.start_datetime} withTime />
              </Typography>
              {meeting?.duration_minutes != null ? (
                <Chip size="small" variant="outlined" label={formatDuration(meeting.duration_minutes)} />
              ) : null}
              {meeting?.location ? (
                <Chip size="small" variant="outlined" label={meeting.location} />
              ) : null}
              {meeting?.company_name ? (
                <Chip size="small" label={meeting.company_name} />
              ) : null}
            </Stack>
          </>
        )}

        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mt: 1.5 }} variant="scrollable">
          <Tab label="Agenda" />
          <Tab label="Who came" />
          <Tab label="Decisions" />
          <Tab label="Minute" />
        </Tabs>
      </DialogTitle>

      <DialogContent dividers>
        {tab === 0 ? <AgendaTab meetingId={meetingId} /> : null}
        {tab === 1 ? <RegisterTab meetingId={meetingId} attendees={meeting?.attendees ?? []} /> : null}
        {tab === 2 ? <DecisionsTab meetingId={meetingId} /> : null}
        {tab === 3 ? <MinuteTab meetingId={meetingId} /> : null}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── The agenda ─────────────────────────────────────────────────────────

function AgendaTab({ meetingId }: { meetingId: number }) {
  const { data: items, isPending } = useAgenda(meetingId);
  const add = useAddAgendaItem();
  const remove = useRemoveAgendaItem();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isPending) return <Skeleton variant="rounded" height={180} />;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Add to this at any point — before the meeting, or afterwards for
        anything raised from the floor.
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Stack spacing={1} sx={{ mb: 2 }}>
        {(items ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing on the agenda yet.
          </Typography>
        ) : (
          items?.map((item, index) => (
            <Stack
              key={item.id}
              direction="row"
              spacing={1.5}
              sx={{
                alignItems: "center",
                p: 1.25,
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700, width: 22 }}>
                {index + 1}.
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">{item.title}</Typography>
                {item.detail ? (
                  <Typography variant="caption" color="text.secondary">
                    {item.detail}
                  </Typography>
                ) : null}
              </Box>
              {/* An item nobody saw in advance is one people may reasonably not
                  have been ready for, and the minute should say so. */}
              {item.raised_in_meeting ? (
                <Chip size="small" variant="outlined" label="Raised in the meeting" />
              ) : null}
              <Tooltip title="Remove">
                <IconButton
                  size="small"
                  onClick={() =>
                    remove.mutate(
                      { meetingId, itemId: item.id },
                      { onError: (e) => setError(e.message) }
                    )
                  }
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))
        )}
      </Stack>

      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          fullWidth
          placeholder="Add an item"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) {
              add.mutate(
                { meetingId, values: { title: title.trim() } },
                { onSuccess: () => setTitle(""), onError: (er) => setError(er.message) }
              );
            }
          }}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          disabled={!title.trim() || add.isPending}
          onClick={() =>
            add.mutate(
              { meetingId, values: { title: title.trim() } },
              { onSuccess: () => setTitle(""), onError: (e) => setError(e.message) }
            )
          }
        >
          Add
        </Button>
      </Stack>
    </Box>
  );
}

// ── The register ───────────────────────────────────────────────────────

function RegisterTab({
  meetingId,
  attendees,
}: {
  meetingId: number;
  attendees: MeetingAttendee[];
}) {
  const mark = useMarkAttendance();
  const [error, setError] = useState<string | null>(null);

  function set(employeeId: number, present: boolean) {
    mark.mutate(
      {
        meetingId,
        present: present ? [employeeId] : [],
        absent: present ? [] : [employeeId],
      },
      { onError: (e) => setError(e.message) }
    );
  }

  const unmarked = attendees.filter((a) => a.attendance === "unmarked").length;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Who actually came, which is not the same as who accepted. Mark it now or
        any time afterwards.
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {unmarked > 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {unmarked} {unmarked === 1 ? "person has" : "people have"} not been marked. The
          minute will say the register was not taken for them, rather than that
          they were absent.
        </Alert>
      ) : null}

      <Stack spacing={1}>
        {attendees.map((row) => (
          <Stack
            key={row.id}
            direction="row"
            spacing={1.5}
            sx={{
              alignItems: "center",
              p: 1.25,
              borderRadius: 2,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {withCode(row.employee_name, row.employee_code)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                RSVP: {row.rsvp_status}
              </Typography>
            </Box>
            <Button
              size="small"
              variant={row.attendance === "present" ? "contained" : "outlined"}
              color="success"
              startIcon={<HowToRegIcon />}
              disabled={mark.isPending}
              onClick={() => set(row.employee, true)}
            >
              Present
            </Button>
            <Button
              size="small"
              variant={row.attendance === "absent" ? "contained" : "outlined"}
              color="inherit"
              disabled={mark.isPending}
              onClick={() => set(row.employee, false)}
            >
              Absent
            </Button>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

// ── Decisions ──────────────────────────────────────────────────────────

function DecisionsTab({ meetingId }: { meetingId: number }) {
  const { data: decisions, isPending } = useDecisions(meetingId);
  const add = useAddDecision();
  const circulate = useCirculateDecision();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isPending) return <Skeleton variant="rounded" height={220} />;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        What was settled. Circulating a decision asks everybody who was invited
        — not only those who came — to consent or dissent.
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Stack spacing={2} sx={{ mb: 2 }}>
        {(decisions ?? []).map((decision, index) => (
          <DecisionCard
            key={decision.id}
            meetingId={meetingId}
            decision={decision}
            index={index}
            onCirculate={() =>
              circulate.mutate(
                { meetingId, decisionId: decision.id },
                { onError: (e) => setError(e.message) }
              )
            }
            onError={setError}
          />
        ))}
      </Stack>

      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          placeholder="Record a decision"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          disabled={!text.trim() || add.isPending}
          onClick={() =>
            add.mutate(
              { meetingId, text: text.trim() },
              { onSuccess: () => setText(""), onError: (e) => setError(e.message) }
            )
          }
          sx={{ alignSelf: "flex-start" }}
        >
          Add
        </Button>
      </Stack>
    </Box>
  );
}

function DecisionCard({
  meetingId,
  decision,
  index,
  onCirculate,
  onError,
}: {
  meetingId: number;
  decision: MeetingDecision;
  index: number;
  onCirculate: () => void;
  onError: (message: string) => void;
}) {
  const respond = useRespondToDecision();
  const [reason, setReason] = useState("");
  const [dissenting, setDissenting] = useState(false);

  const answered = decision.my_position && decision.my_position !== "pending";

  return (
    <Box sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {index + 1}.
        </Typography>
        <Typography variant="body2" sx={{ flex: 1 }}>
          {decision.text}
        </Typography>
        <Chip
          size="small"
          label={decision.status}
          color={decision.status === "circulated" ? "primary" : "default"}
        />
      </Stack>

      {decision.positions.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap" }} useFlexGap>
          <Chip size="small" color="success" variant="outlined" label={`${decision.tally.consent} consented`} />
          <Chip size="small" color="error" variant="outlined" label={`${decision.tally.dissent} dissented`} />
          {decision.tally.abstain > 0 ? (
            <Chip size="small" variant="outlined" label={`${decision.tally.abstain} abstained`} />
          ) : null}
          {decision.tally.pending > 0 ? (
            <Chip size="small" variant="outlined" label={`${decision.tally.pending} not answered`} />
          ) : null}
        </Stack>
      ) : null}

      {decision.status === "draft" ? (
        <Button size="small" startIcon={<SendIcon />} onClick={onCirculate} sx={{ mt: 1.5 }}>
          Circulate for consent
        </Button>
      ) : null}

      {/* Only where the reader was actually asked. `my_position` is null for
          anybody not on the list, so no button is drawn that would be refused. */}
      {decision.my_position !== null && !answered ? (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<ThumbUpIcon />}
              disabled={respond.isPending}
              onClick={() =>
                respond.mutate(
                  { meetingId, decisionId: decision.id, position: "consent" },
                  { onError: (e) => onError(e.message) }
                )
              }
            >
              Consent
            </Button>
            <Button
              size="small"
              variant={dissenting ? "contained" : "outlined"}
              color="error"
              startIcon={<ThumbDownIcon />}
              onClick={() => setDissenting((v) => !v)}
            >
              Dissent
            </Button>
          </Stack>
          {dissenting ? (
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                placeholder="Why do you disagree?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                helperText="Required — a dissent that does not say why records nothing."
              />
              <Button
                size="small"
                variant="contained"
                color="error"
                disabled={!reason.trim() || respond.isPending}
                onClick={() =>
                  respond.mutate(
                    { meetingId, decisionId: decision.id, position: "dissent", reason },
                    {
                      onSuccess: () => {
                        setReason("");
                        setDissenting(false);
                      },
                      onError: (e) => onError(e.message),
                    }
                  )
                }
                sx={{ alignSelf: "flex-start" }}
              >
                Record
              </Button>
            </Stack>
          ) : null}
        </Stack>
      ) : null}

      {answered ? (
        <Chip
          size="small"
          icon={<CheckCircleIcon />}
          color={decision.my_position === "consent" ? "success" : "error"}
          label={`You ${decision.my_position === "consent" ? "consented" : decision.my_position}`}
          sx={{ mt: 1.5 }}
        />
      ) : null}
    </Box>
  );
}

// ── The minute ─────────────────────────────────────────────────────────

function MinuteTab({ meetingId }: { meetingId: number }) {
  const { data: minute, isPending } = useMinutes(meetingId);
  const { data: decisions } = useDecisions(meetingId);
  const draft = useDraftMinutes();
  const save = useSaveMinutes();
  const finalise = useFinaliseMinutes();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isPending) return <Skeleton variant="rounded" height={320} />;

  if (!minute) {
    return (
      <Box sx={{ textAlign: "center", py: 6 }}>
        <DescriptionIcon sx={{ fontSize: 44, color: "text.disabled", mb: 1 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No minute yet. Drafting one fills in the register, the agenda and the
          decisions from what this meeting already knows.
        </Typography>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Button
          variant="contained"
          disabled={draft.isPending}
          onClick={() => draft.mutate(meetingId, { onError: (e) => setError(e.message) })}
        >
          Draft the minute
        </Button>
      </Box>
    );
  }

  const body = content ?? minute.content;

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {minute.is_locked ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          This minute is final. It is a record now and cannot be changed.
        </Alert>
      ) : null}

      <MinutesSheet
        minute={minute}
        decisions={decisions ?? []}
        body={
          minute.is_locked ? undefined : (
            <RichTextEditor
              value={body}
              onChange={setContent}
              // The page's own face and ink, so the words look on screen the
              // way they will look printed.
              surfaceSx={{
                p: 0,
                minHeight: 0,
                fontFamily: "inherit",
                fontSize: ".95rem",
                lineHeight: 1.75,
                color: "#16181d",
              }}
              renderLayout={({ toolbar, surface }) => (
                <>
                  <Box
                    sx={(theme) => ({
                      mb: 1.5,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      overflow: "hidden",
                      bgcolor: theme.vars.palette.background.paper,
                    })}
                  >
                    {toolbar}
                  </Box>
                  {surface}
                </>
              )}
            />
          )
        }
        actions={
          minute.is_locked ? null : (
            <>
              <Button
                size="small"
                disabled={content === null || save.isPending}
                onClick={() =>
                  save.mutate(
                    { meetingId, content: content ?? "" },
                    { onSuccess: () => setContent(null), onError: (e) => setError(e.message) }
                  )
                }
              >
                Save
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={finalise.isPending}
                onClick={() =>
                  finalise.mutate(meetingId, { onError: (e) => setError(e.message) })
                }
              >
                Finalise
              </Button>
            </>
          )
        }
      />
    </Box>
  );
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}
