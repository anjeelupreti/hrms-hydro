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
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateTimeField from "@/components/common/DateTimeField";
import EmptyState from "@/components/common/EmptyState";
import ResponseState from "@/components/meetings/ResponseState";
import PageContainer from "@/components/shell/PageContainer";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import { useCreateMeeting, useMeetings, useRsvpMeeting } from "@/hooks/useCalendar";
import { useMe } from "@/hooks/useMe";
import { useTextFilter } from "@/hooks/useTextFilter";
import type { RsvpStatus } from "@/types/calendar";
import { EmployeePicker } from "@/components/common/pickers";

const RSVP_COLOR: Record<RsvpStatus, "default" | "success" | "error"> = {
  pending: "default",
  accepted: "success",
  declined: "error",
};

export default function MeetingsPage() {
  const { data: me } = useMe();
  const { data: meetings, isLoading } = useMeetings();
  const createMeeting = useCreateMeeting();
  const rsvpMeeting = useRsvpMeeting();

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
        subtitle="Scheduled meetings and who has responded"
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
      />

      {/* Read across every upcoming meeting, not the filtered view: a room
          that has not replied is still waiting whether or not the current
          search term happens to match its title. */}
      <ResponseState meetings={meetings?.results ?? []} />

      <Stack spacing={2}>
        {filtered.map((meeting) => {
          const myAttendee = meeting.attendees.find((a) => a.employee === me?.employee_id);
          return (
            <Card key={meeting.id} variant="outlined">
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 1 }}>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {meeting.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(meeting.start_datetime).toLocaleString()} — {new Date(meeting.end_datetime).toLocaleTimeString()}
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
                  </Box>
                  {myAttendee && (
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Chip size="small" label={myAttendee.rsvp_status} color={RSVP_COLOR[myAttendee.rsvp_status]} />
                      {myAttendee.rsvp_status === "pending" && (
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
    </PageContainer>
  );
}
