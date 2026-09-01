"use client";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import SchoolIcon from "@mui/icons-material/School";
import VerifiedIcon from "@mui/icons-material/Verified";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useEffect, useState } from "react";

import ExportButton from "@/components/common/ExportButton";
import SearchField from "@/components/common/SearchField";
import CatalogueReadiness from "@/components/training/CatalogueReadiness";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import ProgramDialog from "@/components/training/ProgramDialog";
import { DELIVERY_LABEL, ENROLLMENT_META, formatSessionTime } from "@/components/training/trainingMeta";
import { useEnrollments, usePrograms } from "@/hooks/useTraining";
import { useCan, useMe } from "@/hooks/useMe";
import ListPagination from "@/components/common/ListPagination";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagedList } from "@/hooks/usePagedList";
import type { TrainingProgram } from "@/types/training";

export default function TrainingPage() {
  const { data: me } = useMe();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query, 300);
  const { page, pageSize, setPage, setPageSize, reset } = usePagedList();
  const { data: programPage, isLoading } = usePrograms({
    search: search || undefined,
    page,
    pageSize,
  });
  const programs = programPage?.results;
  const isHR = useCan("workplace.manage");

  const [dialog, setDialog] = useState<{ open: boolean; program: TrainingProgram | null }>({
    open: false,
    program: null,
  });

  // Searched on the server, so a programme on page three is findable by name.
  const filtered = programs ?? [];
  const isEmptyResult = Boolean(search) && filtered.length === 0;

  useEffect(() => {
    reset();
  }, [search, reset]);

  return (
    <PageContainer>
      <PageHeader
        title="Training"
        subtitle="Browse programs, request a seat, and track your learning."
        icon={<SchoolIcon />}
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search programs…"
              label="Search programs by title, category or delivery mode"
            />
            {isHR && (
              <ExportButton
                path="training/enrollments"
                label="Export"
                filters={[
                  {
                    type: "select",
                    param: "status",
                    label: "Status",
                    options: [
                      { value: "requested", label: "Requested" },
                      { value: "enrolled", label: "Enrolled" },
                      { value: "completed", label: "Completed" },
                      { value: "no_show", label: "No show" },
                      { value: "cancelled", label: "Cancelled" },
                    ],
                  },
                ]}
              />
            )}
            {isHR && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, program: null })}>
                New Program
              </Button>
            )}
          </>
        }
      />

      {/* Read against the whole catalogue, not the search results — a
          programme with no sessions does not stop being unattendable because
          somebody typed a filter that hides it. */}
      {isLoading ? null : <CatalogueReadiness programs={programs ?? []} />}

      <Typography variant="overline" color="text.secondary">
        Programs
      </Typography>
      <Grid container spacing={2} sx={{ mt: 0, mb: 4 }}>
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
              <Skeleton variant="rounded" height={180} />
            </Grid>
          ))
        ) : filtered.length > 0 ? (
          filtered.map((program) => (
            <Grid key={program.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <ProgramGridCard
                program={program}
                isHR={!!isHR}
                onEdit={() => setDialog({ open: true, program })}
              />
            </Grid>
          ))
        ) : (
          <Grid size={12}>
            {isEmptyResult ? (
              <Card variant="outlined">
                <CardContent sx={{ textAlign: "center", py: 6 }}>
                  <Typography color="text.secondary">No programs match “{query}”.</Typography>
                </CardContent>
              </Card>
            ) : (
              <EmptyState isHR={!!isHR} onNew={() => setDialog({ open: true, program: null })} />
            )}
          </Grid>
        )}
      </Grid>

      <ListPagination
        page={page}
        pageSize={pageSize}
        count={programPage?.count ?? 0}
        noun="programs"
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {me?.employee_id && <MyTraining employeeId={me.employee_id} />}

      <ProgramDialog
        open={dialog.open}
        program={dialog.program}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
      />
    </PageContainer>
  );
}

function ProgramGridCard({
  program,
  isHR,
  onEdit,
}: {
  program: TrainingProgram;
  isHR: boolean;
  onEdit: () => void;
}) {
  return (
    <Card variant="outlined" sx={{ height: "100%", position: "relative", transition: "box-shadow .2s", "&:hover": { boxShadow: 4 } }}>
      {isHR && (
        <IconButton
          size="small"
          onClick={onEdit}
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
          aria-label="Edit program"
        >
          <EditIcon fontSize="small" />
        </IconButton>
      )}
      <CardActionArea component={Link} href={`/training/${program.id}`} sx={{ height: "100%", alignItems: "stretch" }}>
        <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mb: 1.5,
            }}
          >
            <SchoolIcon fontSize="small" />
          </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {program.title}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ my: 0.5, flexWrap: "wrap" }} useFlexGap>
            {program.category && <Chip size="small" label={program.category} />}
            <Chip size="small" variant="outlined" label={DELIVERY_LABEL[program.delivery_mode]} />
            {!program.is_active && <Chip size="small" color="default" label="Inactive" />}
          </Stack>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flex: 1, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {program.description || "No description."}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5 }}>
            {program.session_count} session{program.session_count === 1 ? "" : "s"}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

// Explains why no certificate is shown yet, per enrollment status, so the row
// never renders a blank/empty certificate slot.
function certificateHint(status: string): string {
  switch (status) {
    case "completed":
      return "Certificate not issued yet";
    case "enrolled":
      return "Available after completion";
    case "requested":
      return "Pending enrolment";
    case "no_show":
      return "Not eligible (no-show)";
    default:
      return "No certificate";
  }
}

function MyTraining({ employeeId }: { employeeId: number }) {
  const { data: enrollments } = useEnrollments({ employee: employeeId });
  const mine = (enrollments ?? []).filter((e) => e.status !== "cancelled" && e.status !== "declined");

  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        My Training
      </Typography>
      <Card variant="outlined" sx={{ mt: 1 }}>
        {mine.length === 0 ? (
          <CardContent>
            <Typography color="text.secondary">
              You haven&apos;t joined any training yet — open a program to request a seat.
            </Typography>
          </CardContent>
        ) : (
          <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
            {mine.map((enr) => (
              <Stack
                key={enr.id}
                direction="row"
                sx={{ alignItems: "center", justifyContent: "space-between", px: 2, py: 1.5, gap: 1 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                    {enr.program_title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatSessionTime(enr.session_start, enr.session_start)}
                    {enr.status === "completed" && enr.score != null ? ` · Score ${enr.score}` : ""}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {enr.certificate_issued_at ? (
                    <Button
                      size="small"
                      startIcon={<VerifiedIcon />}
                      color="success"
                      component={Link}
                      href={`/training/certificate/${enr.id}`}
                    >
                      Certificate
                    </Button>
                  ) : (
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={<HourglassEmptyIcon sx={{ fontSize: 16 }} />}
                      label={certificateHint(enr.status)}
                      sx={{ color: "text.secondary" }}
                    />
                  )}
                  <Chip
                    size="small"
                    label={ENROLLMENT_META[enr.status].label}
                    color={ENROLLMENT_META[enr.status].color}
                  />
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </Card>
    </Box>
  );
}

function EmptyState({ isHR, onNew }: { isHR: boolean; onNew: () => void }) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ textAlign: "center", py: 6 }}>
        <SchoolIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
        <Typography variant="h6">No training programs yet</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {isHR ? "Create your first program to get started." : "Check back soon — none have been published."}
        </Typography>
        {isHR && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={onNew}>
            New Program
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
