"use client";

import AddIcon from "@mui/icons-material/Add";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import EventIcon from "@mui/icons-material/Event";
import GroupsIcon from "@mui/icons-material/Groups";
import PlaceIcon from "@mui/icons-material/Place";
import TodayIcon from "@mui/icons-material/Today";
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
import { useCan, useCanCreate } from "@/hooks/useMe";
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
 * **One line, not two columns.** It was split into "Coming up" and "Already
 * happened" side by side, which is two timelines rather than a timeline: the
 * reader had to hold two positions in their head and there was nowhere on the
 * page that said where *now* is.
 *
 * So: a single spine, running from the furthest future down to the oldest
 * record, with a marker on it for today. Everything above the marker has not
 * happened; everything below it has. That ordering makes the next thing sit
 * immediately above the line — the most useful row on the page lands next to
 * the one fixed point on it — and reading downwards is reading backwards in
 * time, which is how anybody scans a history.
 *
 * **Past entries are drawn back rather than hidden.** Muted ground, hollow
 * node, lighter type. They are still records and still open on a click; they
 * are simply not what the page is for. Upcoming entries keep the module hue,
 * so the eye lands on them first.
 */

const STATUS_TONE: Record<string, "normal" | "caution" | "alarm" | "muted"> = {
  planned: "muted",
  confirmed: "normal",
  completed: "normal",
  cancelled: "alarm",
  postponed: "caution",
};

export default function EventsPage() {
  const canManage = useCan("workplace.manage");
  // Creating and deleting are refused by the API for an officer regardless;
  // this only decides whether the button is offered.
  const canCreate = useCanCreate("workplace.manage");

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
        {canCreate ? (
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
        <Timeline
          // Furthest-future first, so reading downwards runs backwards in time
          // and the next thing to happen sits immediately above the "today"
          // marker rather than at the far end of the page.
          upcoming={[...(data?.upcoming ?? [])].reverse()}
          past={data?.past ?? []}
          upcomingTotal={data?.upcoming_total ?? 0}
          pastTotal={data?.past_total ?? 0}
          onOpen={setOpenId}
        />
      )}

      <EventDialog
        open={creating}
        event={null}
        canEdit={canCreate}
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
/**
 * One spine, today marked on it, everything else placed either side.
 *
 * The card is a child rather than a copy per section: an upcoming event and a
 * past one carry the same facts and differ only in emphasis, so the difference
 * is one `past` flag and not a second component that drifts.
 */
function Timeline({
  upcoming,
  past,
  upcomingTotal,
  pastTotal,
  onOpen,
}: {
  upcoming: EventListItem[];
  past: EventListItem[];
  upcomingTotal: number;
  pastTotal: number;
  onOpen: (id: number) => void;
}) {
  if (upcoming.length === 0 && past.length === 0) {
    return (
      <EmptyState
        title="No events yet"
        description="Public hearings, inaugurations, board meetings and community programmes are recorded here."
      />
    );
  }

  return (
    <Box sx={{ position: "relative", pl: 4 }}>
      {/* The spine. It runs the whole height rather than per section, which is
          the entire point of joining the two lists. */}
      <Box
        sx={{
          position: "absolute",
          left: 11,
          top: 8,
          bottom: 8,
          width: 2,
          bgcolor: "divider",
        }}
      />

      <Stack spacing={2}>
        {upcoming.map((event) => (
          <TimelineRow key={event.id} event={event} onOpen={onOpen} />
        ))}

        <NowMarker upcoming={upcomingTotal} past={pastTotal} />

        {past.map((event) => (
          <TimelineRow key={event.id} event={event} onOpen={onOpen} past />
        ))}
      </Stack>
    </Box>
  );
}

/**
 * Where today is.
 *
 * The one fixed point on the page, and the thing two separate columns could
 * never show. Everything above it is ahead; everything below has happened.
 */
function NowMarker({ upcoming, past }: { upcoming: number; past: number }) {
  return (
    <Box sx={{ position: "relative", py: 0.5 }}>
      <Box
        sx={(theme) => ({
          position: "absolute",
          left: -29,
          top: "50%",
          transform: "translateY(-50%)",
          width: 22,
          height: 22,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          bgcolor: theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.18)}`,
        })}
      >
        <TodayIcon sx={{ fontSize: 12 }} />
      </Box>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
        useFlexGap
      >
        <Typography
          variant="overline"
          sx={{ fontWeight: 800, color: "primary.main", letterSpacing: ".1em" }}
        >
          Today
        </Typography>
        <Typography variant="caption" color="text.secondary">
          <DateText value={new Date().toISOString()} />
        </Typography>
        <Box
          sx={(theme) => ({
            flex: 1,
            height: 1,
            minWidth: 24,
            bgcolor: alpha(theme.palette.primary.main, 0.25),
          })}
        />
        <Typography variant="caption" color="text.secondary">
          {upcoming} ahead, {past} recorded
        </Typography>
      </Stack>
    </Box>
  );
}

function TimelineRow({
  event,
  onOpen,
  past = false,
}: {
  event: EventListItem;
  onOpen: (id: number) => void;
  past?: boolean;
}) {
  return (
    <Box sx={{ position: "relative" }}>
      {/* Filled node ahead of today, hollow behind it. The shape carries the
          difference as well as the colour, so it survives a greyscale print and
          does not rely on hue alone. */}
      <Box
        sx={(theme) => ({
          position: "absolute",
          left: -27,
          top: 18,
          width: 18,
          height: 18,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          bgcolor: past ? theme.palette.background.paper : theme.palette.primary.main,
          border: "2px solid",
          borderColor: past ? theme.palette.divider : theme.palette.primary.main,
          color: past ? theme.palette.text.disabled : theme.palette.primary.contrastText,
        })}
      >
        <EventIcon sx={{ fontSize: 10 }} />
      </Box>

      <Card
        variant={past ? "outlined" : "elevation"}
        sx={(theme) => ({
          ...(past
            ? {
                bgcolor: alpha(theme.palette.text.primary, 0.028),
                borderColor: "divider",
                boxShadow: "none",
                ...theme.applyStyles("dark", {
                  bgcolor: alpha(theme.palette.common.white, 0.03),
                }),
              }
            : {
                borderLeft: "3px solid",
                borderColor: theme.palette.primary.main,
              }),
        })}
      >
        <CardActionArea onClick={() => onOpen(event.id)}>
          <CardContent sx={{ py: past ? 1.5 : 2 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "baseline", flexWrap: "wrap", mb: 0.5 }}
              useFlexGap
            >
              <Typography
                sx={{
                  fontWeight: 700,
                  // Drawn back, not hidden. A past event is still a record.
                  color: past ? "text.secondary" : "text.primary",
                }}
              >
                {event.title}
              </Typography>
              <Chip size="small" label={event.kind_display} variant={past ? "outlined" : "filled"} />
              <StateChip
                label={event.status_display}
                tone={past ? "muted" : STATUS_TONE[event.status] ?? "muted"}
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
              <Typography
                variant="body2"
                sx={{ mt: 0.75, color: past ? "text.secondary" : "text.primary" }}
              >
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
  );
}
