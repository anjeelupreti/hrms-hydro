"use client";

import AddIcon from "@mui/icons-material/Add";
import EventIcon from "@mui/icons-material/Event";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateTimeField from "@/components/common/DateTimeField";
import EmptyState from "@/components/common/EmptyState";
import MeetingRecordDialog from "@/components/meetings/MeetingRecordDialog";
import MeetingReport from "@/components/meetings/MeetingReport";
import ResponseState from "@/components/meetings/ResponseState";
import PageContainer from "@/components/shell/PageContainer";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import {
  useCancelMeeting,
  useCreateMeeting,
  useMeetings,
  useReinstateMeeting,
  useRsvpMeeting,
} from "@/hooks/useCalendar";
import { useMe } from "@/hooks/useMe";
import { useTextFilter } from "@/hooks/useTextFilter";
import type { CompanyEvent, MeetingState, RsvpStatus } from "@/types/calendar";
import { EmployeePicker } from "@/components/common/pickers";

const RSVP_COLOR: Record<RsvpStatus, "default" | "success" | "error"> = {
  pending: "default",
  accepted: "success",
  declined: "error",
};

/**
 * **Where a meeting is, said in one word.** A list that shows only a date makes
 * the reader work out "has this happened yet" for every row, and cannot show a
 * cancellation at all.
 */
const STATE: Record<MeetingState, { label: string; color: "info" | "default" | "error" }> = {
  scheduled: { label: "Scheduled", color: "info" },
  ended: { label: "Held", color: "default" },
  cancelled: { label: "Cancelled", color: "error" },
};

const MINUTE_LABEL: Record<string, string> = {
  draft: "Minute in draft",
  circulated: "Minute circulated",
  final: "Minute final",
};

const STATE_TABS: { value: MeetingState | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "scheduled", label: "Coming up" },
  { value: "ended", label: "Held" },
  { value: "cancelled", label: "Cancelled" },
];

const ROLE_TABS: { value: string; label: string }[] = [
  { value: "", label: "Anyone" },
  { value: "mine", label: "I called" },
  { value: "invited", label: "I was invited" },
];

export default function MeetingsPage() {
  /** 0 = the list, 1 = the report. */
  const [view, setView] = useState(0);
  /** The meeting whose record is open — its agenda, register, decisions and
   *  minute. Held as an id rather than the object so the dialog reads the
   *  live record instead of a snapshot taken at click time. */
  const [recordId, setRecordId] = useState<number | null>(null);
  const { data: me } = useMe();
  /** The two questions a meetings list is asked, answered by the API rather
   *  than by filtering whatever happened to be fetched. */
  const [state, setState] = useState<MeetingState | "">("");
  const [role, setRole] = useState("");
  const { data: meetings, isLoading } = useMeetings({ state, role });
  const createMeeting = useCreateMeeting();
  const rsvpMeeting = useRsvpMeeting();
  const cancelMeeting = useCancelMeeting();
  const reinstateMeeting = useReinstateMeeting();
  /** The meeting being called off, and the reason being typed for it. */
  const [cancelling, setCancelling] = useState<CompanyEvent | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [attendeeIds, setAttendeeIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(
    meetings?.results ?? [],
    (m) => [m.title, m.description, m.location, ...m.attendees.map((a) => a.employee_name)]
  );

  async function handleCreate() {
    setError(null);
    try {
      await createMeeting.mutateAsync({
        title,
        description,
        location,
        start_datetime: new Date(start).toISOString(),
        end_datetime: new Date(end).toISOString(),
        attendee_ids: attendeeIds,
      });
      setDialogOpen(false);
      setTitle("");
      setDescription("");
      setLocation("");
      setStart("");
      setEnd("");
      setAttendeeIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Meetings"
        subtitle="What is coming up, what was held, and what was called off"
        icon={<EventIcon />}
        actions={
          <>
            
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
              Schedule Meeting
            </Button>
          </>
        }
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search meetings…"
        searchLabel="Search meetings by title, location, description or attendee"
        chips={
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }} useFlexGap>
            {/* Two independent questions, so two rows of chips rather than one
                list of every combination. "My cancelled meetings" is a real
                thing to want and a single flat list cannot express it. */}
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
              {STATE_TABS.map((tab) => (
                <Chip
                  key={tab.label}
                  size="small"
                  label={tab.label}
                  color={state === tab.value ? "primary" : "default"}
                  variant={state === tab.value ? "filled" : "outlined"}
                  onClick={() => setState(tab.value)}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
              {ROLE_TABS.map((tab) => (
                <Chip
                  key={tab.label}
                  size="small"
                  label={tab.label}
                  color={role === tab.value ? "secondary" : "default"}
                  variant={role === tab.value ? "filled" : "outlined"}
                  onClick={() => setRole(tab.value)}
                />
              ))}
            </Stack>
          </Stack>
        }
      />

      {/* Read across every upcoming meeting, not the filtered view: a room
          that has not replied is still waiting whether or not the current
          search term happens to match its title. */}
      <ResponseState meetings={meetings?.results ?? []} />

      {/* **The report is a tab, not a page of its own.** It answers questions
          about the same meetings listed below it — who turns up, whether
          decisions get answered — and putting it elsewhere would mean
          navigating away from the thing it is about. */}
      <Tabs value={view} onChange={(_e, v) => setView(v)} sx={{ mb: 2 }}>
        <Tab label="Meetings" />
        <Tab label="Report" />
      </Tabs>

      {view === 1 ? <MeetingReport /> : null}

      <Stack spacing={2}>
        {view === 1 ? null : filtered.map((meeting) => {
          const myAttendee = meeting.attendees.find((a) => a.employee === me?.employee_id);
          const meetingState = (meeting.state ?? "scheduled") as MeetingState;
          const cancelled = meetingState === "cancelled";
          return (
            <Card
              key={meeting.id}
              variant="outlined"
              // A cancelled meeting stays in the list — the agenda, the
              // register and the reason are still worth reading — but it must
              // not read as something anybody should turn up to.
              sx={cancelled ? { opacity: 0.72 } : undefined}
            >
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 1 }}>
                  <Box>
                    {/* **The title opens the record.** A meeting is not only
                        a calendar entry any more — it has an agenda, a
                        register, decisions and a minute — and the place
                        somebody looks for those is the meeting itself. */}
                    <Typography
                      variant="subtitle1"
                      sx={{
                        fontWeight: 700,
                        cursor: "pointer",
                        "&:hover": { textDecoration: "underline" },
                      }}
                      onClick={() => setRecordId(meeting.id)}
                    >
                      {meeting.title}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", mt: 0.5 }} useFlexGap>
                      <Chip
                        size="small"
                        label={STATE[meetingState].label}
                        color={STATE[meetingState].color}
                        variant={meetingState === "ended" ? "outlined" : "filled"}
                      />
                      {/* Who called it. The organiser may cancel it, take the
                          register and write the minute; an invitee may not, and
                          a card that looks identical either way is one people
                          have to click into to find out. */}
                      <Typography variant="caption" color="text.secondary">
                        {meeting.is_organiser
                          ? "You called this"
                          : meeting.organiser_name
                            ? `Called by ${meeting.organiser_name}`
                            : ""}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {new Date(meeting.start_datetime).toLocaleString()} — {new Date(meeting.end_datetime).toLocaleTimeString()}
                      {meeting.duration_minutes ? ` · ${meeting.duration_minutes} min` : ""}
                    </Typography>
                    {meeting.location && (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.5 }}>
                        <LocationOnIcon fontSize="small" color="action" />
                        <Typography variant="body2" color="text.secondary">
                          {meeting.location}
                        </Typography>
                      </Stack>
                    )}
                    {meeting.description && (
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        {meeting.description}
                      </Typography>
                    )}
                    {/* **The reason is the point of keeping a cancellation.**
                        "Postponed, the engineer is in Kathmandu" is the
                        difference between one people understand and one they
                        resent. */}
                    {cancelled && meeting.cancellation_reason && (
                      <Alert severity="warning" sx={{ mt: 1.5 }}>
                        {meeting.cancellation_reason}
                      </Alert>
                    )}
                    {/* What the meeting has actually produced. Without this a
                        held meeting and one nobody ever wrote up look the same
                        from outside. */}
                    <Stack direction="row" spacing={0.75} sx={{ mt: 1.25, flexWrap: "wrap" }} useFlexGap>
                      {meeting.agenda_count ? (
                        <Chip size="small" variant="outlined" label={`Agenda · ${meeting.agenda_count}`} />
                      ) : null}
                      {meeting.attendance_taken ? (
                        <Chip size="small" variant="outlined" color="success" label="Register taken" />
                      ) : meetingState === "ended" ? (
                        <Chip size="small" variant="outlined" color="warning" label="Register not taken" />
                      ) : null}
                      {meeting.decision_count ? (
                        <Chip size="small" variant="outlined" label={`Decisions · ${meeting.decision_count}`} />
                      ) : null}
                      {meeting.minute_status ? (
                        <Chip
                          size="small"
                          variant={meeting.minute_status === "final" ? "filled" : "outlined"}
                          color={meeting.minute_status === "final" ? "success" : "default"}
                          label={MINUTE_LABEL[meeting.minute_status]}
                        />
                      ) : meetingState === "ended" ? (
                        <Chip size="small" variant="outlined" color="warning" label="No minute yet" />
                      ) : null}
                    </Stack>
                  </Box>
                  <Stack spacing={1} sx={{ alignItems: "flex-end" }}>
                  {/* Only the organiser, and only where it means something —
                      calling off a meeting that already happened is a real
                      thing (people turned up and it did not run), so this is
                      not hidden on past meetings. */}
                  {meeting.is_organiser && (
                    <Stack direction="row" spacing={0.5}>
                      {cancelled ? (
                        <Button
                          size="small"
                          onClick={() => reinstateMeeting.mutate(meeting.id)}
                          disabled={reinstateMeeting.isPending}
                        >
                          Put it back on
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            setCancelling(meeting);
                            setCancelReason("");
                          }}
                        >
                          Cancel meeting
                        </Button>
                      )}
                    </Stack>
                  )}
                  {myAttendee && (
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      {/* Your own reply, which stops meaning anything once
                          the meeting is off — a "pending" chip on a cancelled
                          meeting reads as something still owed. */}
                      {!cancelled ? (
                        <Chip
                          size="small"
                          label={myAttendee.rsvp_status}
                          color={RSVP_COLOR[myAttendee.rsvp_status]}
                        />
                      ) : null}
                      {myAttendee.rsvp_status === "pending" && !cancelled && (
                        <Stack direction="row" spacing={0.5}>
                          <Button
                            size="small"
                            startIcon={<CheckIcon />}
                            onClick={() => rsvpMeeting.mutate({ id: meeting.id, rsvp_status: "accepted" })}
                          >
                            Accept
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            startIcon={<CloseIcon />}
                            onClick={() => rsvpMeeting.mutate({ id: meeting.id, rsvp_status: "declined" })}
                          >
                            Decline
                          </Button>
                        </Stack>
                      )}
                    </Stack>
                  )}
                  </Stack>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap" }} useFlexGap>
                  {meeting.attendees.map((attendee) => (
                    <Chip
                      key={attendee.id}
                      size="small"
                      variant="outlined"
                      label={attendee.employee_name}
                      color={RSVP_COLOR[attendee.rsvp_status]}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          );
        })}
        {!isLoading && filtered.length === 0 && (
          <EmptyState
            variant={isEmptyResult ? "noResults" : "empty"}
            title={isEmptyResult ? `No meetings match “${query}”` : "No meetings scheduled"}
            description={
              isEmptyResult
              ? "Try a different search, or clear it to see everything."
              : "Schedule a meeting and attendees get an invitation they can accept or decline, so you know who is coming before the room is booked."
            }
            surface
          />
        )}
      </Stack>

      {/* **Calling one off asks for a reason, and does not insist on one.**
          The reason is what makes a cancellation something people accept
          rather than resent — but a meeting that has to be cancelled at eight
          in the morning should not be held up by a text box. */}
      <Dialog open={cancelling !== null} onClose={() => setCancelling(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Cancel “{cancelling?.title}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Everybody invited is told, including anyone who had declined — they may
            have arranged cover for it. The agenda and anything already recorded stays.
          </Typography>
          <TextField
            label="Why (optional)"
            fullWidth
            multiline
            minRows={2}
            autoFocus
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Postponed — the lenders’ engineer is held up in Kathmandu."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelling(null)}>Keep it</Button>
          <Button
            color="error"
            variant="contained"
            disabled={cancelMeeting.isPending}
            onClick={() => {
              if (!cancelling) return;
              cancelMeeting.mutate(
                { id: cancelling.id, reason: cancelReason },
                { onSuccess: () => setCancelling(null) }
              );
            }}
          >
            {cancelMeeting.isPending ? "Cancelling…" : "Cancel the meeting"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Schedule a meeting</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <TextField label="Location / link" fullWidth value={location} onChange={(e) => setLocation(e.target.value)} />
            <Stack direction="row" spacing={2}>
              <DateTimeField label="Start" value={start} onChange={setStart} />
              <DateTimeField label="End" value={end} onChange={setEnd} />
            </Stack>
            <Box>
              {/* Was a scrolling checkbox list of the first page, so on a
                  larger company most colleagues could not be invited at all. */}
              <EmployeePicker
                multiple
                label="Attendees"
                value={attendeeIds}
                onChange={setAttendeeIds}
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createMeeting.isPending}>
            Schedule
          </Button>
        </DialogActions>
      </Dialog>
      {recordId !== null ? (
        <MeetingRecordDialog meetingId={recordId} onClose={() => setRecordId(null)} />
      ) : null}

    </PageContainer>
  );
}
