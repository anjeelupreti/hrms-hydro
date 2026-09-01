"use client";

import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EventSeatIcon from "@mui/icons-material/EventSeat";
import GroupsIcon from "@mui/icons-material/Groups";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import PersonIcon from "@mui/icons-material/Person";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import EditIcon from "@mui/icons-material/Edit";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import Breadcrumbs from "@/components/shell/Breadcrumbs";
import RosterDialog from "@/components/training/RosterDialog";
import SessionDialog from "@/components/training/SessionDialog";
import { ArchiveButton, ArchiveTabs } from "@/components/common/ArchiveControls";
import { useArchive } from "@/hooks/useCollaboration";
import {
  DELIVERY_LABEL,
  ENROLLMENT_META,
  SESSION_META,
  formatSessionTime,
} from "@/components/training/trainingMeta";
import { useEnrollmentAction, useProgram, useRequestEnrollment, useSessions } from "@/hooks/useTraining";
import { useCan } from "@/hooks/useMe";
import type { TrainingSession } from "@/types/training";

export default function ProgramDetailPage() {
  const params = useParams<{ programId: string }>();
  const programId = Number(params.programId);
  const isHR = useCan("workplace.manage");

  const { data: program } = useProgram(programId);
  const [archived, setArchived] = useState(false);
  const { data: sessions, isLoading } = useSessions(programId, archived);
  const archiveSession = useArchive("training/sessions", "training");

  const [sessionDialog, setSessionDialog] = useState<{ open: boolean; session: TrainingSession | null }>({
    open: false,
    session: null,
  });
  const [roster, setRoster] = useState<TrainingSession | null>(null);

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, sm: 4 }, pb: 10 }}>
      <Breadcrumbs />
      <Button component={Link} href="/training" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        All programs
      </Button>

      {program ? (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
            {program.title}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ my: 1, flexWrap: "wrap" }} useFlexGap>
            {program.category && <Chip size="small" label={program.category} />}
            <Chip size="small" variant="outlined" label={DELIVERY_LABEL[program.delivery_mode]} />
          </Stack>
          {program.description && (
            <Typography variant="body2" color="text.secondary">
              {program.description}
            </Typography>
          )}
        </Box>
      ) : (
        <Skeleton variant="text" width={260} height={48} sx={{ mb: 3 }} />
      )}

      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <Typography variant="overline" color="text.secondary">
          Sessions
        </Typography>
        {isHR && (
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setSessionDialog({ open: true, session: null })}
          >
            Schedule session
          </Button>
        )}
      </Stack>

      {/* A session is a run that finishes, so it archives. The *program* above
          is a reusable definition — a course you stop offering is deactivated,
          not archived — which is why this control is here and not on the
          program list. */}
      <ArchiveTabs archived={archived} onChange={setArchived} liveLabel="Scheduled" />

      <Stack spacing={1.5}>
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} variant="rounded" height={96} />)
        ) : sessions && sessions.length > 0 ? (
          sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              isHR={!!isHR}
              onManage={() => setRoster(session)}
              onEdit={() => setSessionDialog({ open: true, session })}
              archived={archived}
              onArchive={() => archiveSession.mutate({ id: session.id, archived })}
            />
          ))
        ) : (
          <Card variant="outlined">
            <CardContent sx={{ textAlign: "center", py: 4 }}>
              <Typography color="text.secondary">
                No sessions scheduled{isHR ? " — schedule one above." : " yet."}
              </Typography>
            </CardContent>
          </Card>
        )}
      </Stack>

      <SessionDialog
        open={sessionDialog.open}
        programId={programId}
        session={sessionDialog.session}
        onClose={() => setSessionDialog((d) => ({ ...d, open: false }))}
      />
      {roster && <RosterDialog open onClose={() => setRoster(null)} session={roster} />}
    </Container>
  );
}

function SessionRow({
  session,
  isHR,
  onManage,
  onEdit,
  archived = false,
  onArchive,
}: {
  session: TrainingSession;
  isHR: boolean;
  onManage: () => void;
  onEdit: () => void;
  archived?: boolean;
  onArchive?: () => void;
}) {
  const request = useRequestEnrollment();
  const action = useEnrollmentAction();

  const seatsLabel =
    session.capacity > 0 ? `${session.seats_taken}/${session.capacity} seats` : `${session.seats_taken} enrolled`;
  const my = session.my_enrollment;
  const cancelled = session.status === "cancelled";

  return (
    <Card variant="outlined" sx={{ transition: "box-shadow .2s", "&:hover": { boxShadow: 2 } }}>
      <CardContent>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ justifyContent: "space-between" }}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {formatSessionTime(session.start_datetime, session.end_datetime)}
              </Typography>
              <Chip size="small" label={SESSION_META[session.status].label} color={SESSION_META[session.status].color} variant="outlined" />
            </Stack>
            <Stack direction="row" spacing={2} sx={{ mt: 0.75, flexWrap: "wrap", color: "text.secondary" }} useFlexGap>
              {session.location && (
                <Tooltip title="Location / link">
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                    <LocationOnIcon fontSize="small" />
                    <Typography variant="body2">{session.location}</Typography>
                  </Stack>
                </Tooltip>
              )}
              {session.trainer_name && (
                <Tooltip title="Trainer">
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                    <PersonIcon fontSize="small" />
                    <Typography variant="body2">{session.trainer_name}</Typography>
                  </Stack>
                </Tooltip>
              )}
              <Tooltip title="Seats filled">
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                  <EventSeatIcon fontSize="small" />
                  <Typography variant="body2">{seatsLabel}</Typography>
                </Stack>
              </Tooltip>
            </Stack>
          </Box>

          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
            {/* Employee-facing enrollment control */}
            {my ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Chip size="small" label={ENROLLMENT_META[my.status].label} color={ENROLLMENT_META[my.status].color} />
                {(my.status === "requested" || my.status === "enrolled") && (
                  <Button size="small" color="error" onClick={() => action.mutate({ id: my.id, action: "cancel" })}>
                    Cancel
                  </Button>
                )}
              </Stack>
            ) : (
              !isHR && (
                <Tooltip title={cancelled ? "Session cancelled" : session.is_full ? "Session is full" : ""}>
                  <span>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={cancelled || session.is_full || request.isPending}
                      onClick={() => request.mutate(session.id)}
                    >
                      Request to join
                    </Button>
                  </span>
                </Tooltip>
              )
            )}

            {isHR && (
              <>
                <Button size="small" variant="outlined" startIcon={<GroupsIcon />} onClick={onManage}>
                  Roster
                </Button>
                {onArchive && (
                  <ArchiveButton archived={archived} noun="session" onToggle={onArchive} />
                )}
                <IconButton size="small" onClick={onEdit} aria-label="Edit session">
                  <EditIcon fontSize="small" />
                </IconButton>
              </>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
