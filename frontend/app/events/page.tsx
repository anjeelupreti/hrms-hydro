"use client";

import AddIcon from "@mui/icons-material/Add";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import EventIcon from "@mui/icons-material/Event";
import GroupsIcon from "@mui/icons-material/Groups";
import PlaceIcon from "@mui/icons-material/Place";
import TimelineIcon from "@mui/icons-material/Timeline";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useState } from "react";

import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import SearchField from "@/components/common/SearchField";
import StateChip from "@/components/common/StateChip";
import EventDialog from "@/components/events/EventDialog";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import PageContainer from "@/components/shell/PageContainer";
import { useEvent, useEventTimeline } from "@/hooks/useEvents";
import { useCan, useMe } from "@/hooks/useMe";
import { EVENT_KINDS, EVENT_STATUSES, type EventListItem } from "@/types/events";

/**
 * The company's events, as a timeline.
 *
 * **Why a timeline and not the calendar.** These are read chronologically —
 * what is coming, and what has happened — and a month grid answers neither
 * well: an event three months out is off the screen entirely, and last year's
 * audit is several clicks back. The calendar remains the right shape for "what
 * else is on that day", which is a different question and already has a page.
 *
 * **Two columns, each reading outward from now.** The next thing is at the top
 * of one and the most recent thing at the top of the other. One combined list
 * sorted ascending would open on the furthest-future event, which is the least
 * interesting row on the page; sorted descending it would bury everything
 * upcoming below a year of history.
 */

const STATUS_TONE: Record<string, "normal" | "caution" | "alarm" | "muted"> = {
  planned: "muted",
  confirmed: "normal",
  completed: "normal",
  cancelled: "alarm",
  postponed: "caution",
};

export default function EventsPage() {
  const { data: me } = useMe();
  const canManage = useCan("workplace.manage");
  // Creating and deleting are refused by the API for an officer regardless;
  // this only decides whether the button is offered.
  const isAdmin = me?.role === "owner" || me?.role === "hr_admin" || Boolean(me?.is_superuser);

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useEventTimeline({
    search: search || undefined,
    kind: kind || undefined,
    status: status || undefined,
  });
  // Fetched whole only once something is opened — the timeline rows carry
  // counts, not the nested stakeholder and attachment lists.
  const { data: open } = useEvent(openId);

  return (
    <PageContainer>
      <Breadcrumbs />

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", mb: 2 }}
      >
        <Box>
          <Typography variant="h5">Events</Typography>
          <Typography variant="body2" color="text.secondary">
            Board meetings, ceremonies, drills, inspections and public hearings —
            who was in them and what came of them.
          </Typography>
        </Box>
        {isAdmin && canManage ? (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
            New event
          </Button>
        ) : null}
      </Stack>

      <Card sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Title, subject matter, location…"
          />
          <TextField
            select
            size="small"
            label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">All kinds</MenuItem>
            {EVENT_KINDS.map((k) => (
              <MenuItem key={k.value} value={k.value}>
                {k.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="">Any status</MenuItem>
            {EVENT_STATUSES.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ flex: 1 }} />
          <Button
            component="a"
            href="/calendar"
            startIcon={<CalendarMonthIcon />}
            size="small"
          >
            Calendar
          </Button>
        </Stack>
      </Card>

      {isLoading ? (
        <Stack spacing={2}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={110} />
          ))}
        </Stack>
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            alignItems: "start",
          }}
        >
          <TimelineColumn
            title="Coming up"
            total={data?.upcoming_total ?? 0}
            events={data?.upcoming ?? []}
            emptyText="Nothing scheduled."
            onOpen={setOpenId}
          />
          <TimelineColumn
            title="Already happened"
            total={data?.past_total ?? 0}
            events={data?.past ?? []}
            emptyText="Nothing recorded yet."
            onOpen={setOpenId}
            muted
          />
        </Box>
      )}

      <EventDialog
        open={creating}
        event={null}
        canEdit={Boolean(isAdmin && canManage)}
        onClose={() => setCreating(false)}
      />
      <EventDialog
        open={openId !== null && open != null}
        event={open ?? null}
        canEdit={canManage}
        onClose={() => setOpenId(null)}
      />
    </PageContainer>
  );
}

/**
 * One side of the timeline.
 *
 * The spine is a single line behind the markers, so a run of events reads as a
 * sequence and the gaps between them are visible — three inspections in a
 * fortnight looks different from three across a year, and a list of cards does
 * not show that.
 */
function TimelineColumn({
  title,
  total,
  events,
  emptyText,
  onOpen,
  muted = false,
}: {
  title: string;
  total: number;
  events: EventListItem[];
  emptyText: string;
  onOpen: (id: number) => void;
  muted?: boolean;
}) {
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
        <TimelineIcon fontSize="small" color={muted ? "disabled" : "primary"} />
        <Typography variant="overline" color="text.secondary">
          {title}
        </Typography>
        <Chip size="small" label={total} />
      </Stack>

      {events.length === 0 ? (
        <EmptyState title={emptyText} description="" compact />
      ) : (
        <Box sx={{ position: "relative", pl: 3 }}>
          <Box
            sx={{
              position: "absolute",
              left: 9,
              top: 12,
              bottom: 12,
              width: 2,
              bgcolor: "divider",
            }}
          />
          <Stack spacing={2}>
            {events.map((event) => (
              <Box key={event.id} sx={{ position: "relative" }}>
                <Box
                  sx={(theme) => ({
                    position: "absolute",
                    left: -22,
                    top: 18,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    bgcolor: "background.paper",
                    border: "2px solid",
                    borderColor: muted
                      ? theme.palette.divider
                      : theme.palette.primary.main,
                    color: muted ? theme.palette.text.disabled : theme.palette.primary.main,
                  })}
                >
                  <EventIcon sx={{ fontSize: 11 }} />
                </Box>
                <Card
                  sx={(theme) => ({
                    opacity: muted ? 0.92 : 1,
                    bgcolor: muted ? alpha(theme.palette.text.primary, 0.015) : undefined,
                  })}
                >
                  <CardActionArea onClick={() => onOpen(event.id)}>
                    <CardContent>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "baseline", flexWrap: "wrap", mb: 0.5 }}
                      >
                        <Typography sx={{ fontWeight: 700 }}>{event.title}</Typography>
                        <Chip size="small" label={event.kind_display} />
                        <StateChip
                          label={event.status_display}
                          tone={STATUS_TONE[event.status] ?? "muted"}
                        />
                      </Stack>

                      <Typography variant="body2" color="text.secondary">
                        <DateText value={event.starts_at} />
                        {!event.is_all_day
                          ? ` · ${new Date(event.starts_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`
                          : " · all day"}
                      </Typography>

                      {event.subject_matter ? (
                        <Typography variant="body2" sx={{ mt: 0.75 }}>
                          {event.subject_matter}
                        </Typography>
                      ) : null}

                      <Stack
                        direction="row"
                        spacing={2}
                        sx={{ mt: 1.25, color: "text.secondary", flexWrap: "wrap" }}
                        useFlexGap
                      >
                        {event.location ? (
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                            <PlaceIcon sx={{ fontSize: 15 }} />
                            <Typography variant="caption">{event.location}</Typography>
                          </Stack>
                        ) : null}
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                          <GroupsIcon sx={{ fontSize: 15 }} />
                          <Typography variant="caption">
                            {event.stakeholder_count} stakeholder
                            {event.stakeholder_count === 1 ? "" : "s"}
                          </Typography>
                        </Stack>
                        {event.attachment_count > 0 ? (
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                            <AttachFileIcon sx={{ fontSize: 15 }} />
                            <Typography variant="caption">{event.attachment_count}</Typography>
                          </Stack>
                        ) : null}
                        {event.company_name ? (
                          <Typography variant="caption">{event.company_name}</Typography>
                        ) : null}
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
