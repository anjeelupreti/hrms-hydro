"use client";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import GroupsIcon from "@mui/icons-material/Groups";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import PersonSearchIcon from "@mui/icons-material/PersonSearch";
import WorkIcon from "@mui/icons-material/Work";
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

import FunnelBars from "@/components/charts/FunnelBars";
import SectionCard from "@/components/common/SectionCard";
import type { CandidateStage } from "@/types/recruitment";
import Link from "next/link";
import { useEffect, useState } from "react";

import ExportButton from "@/components/common/ExportButton";
import JobDialog from "@/components/recruitment/JobDialog";
import { EMPLOYMENT_LABEL, JOB_STATUS_META, salaryRange } from "@/components/recruitment/recruitmentMeta";
import StatCard from "@/components/dashboard/StatCard";
import PageContainer from "@/components/shell/PageContainer";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import ListPagination from "@/components/common/ListPagination";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagedList } from "@/hooks/usePagedList";
import { useJobs, useRecruitmentSummary } from "@/hooks/useRecruitment";
import { ArchiveButton, ArchiveTabs } from "@/components/common/ArchiveControls";
import { useArchive } from "@/hooks/useCollaboration";
import { useCan } from "@/hooks/useMe";
import type { JobPosting } from "@/types/recruitment";

/**
 * The pipeline, in process order.
 *
 * Declared rather than derived from whatever stages happen to have people in
 * them: an empty stage is information — *nobody is at offer* — and building the
 * list from the data makes that vanish exactly when it matters. `rejected` is
 * deliberately absent; it is an exit from the funnel, not a step through it,
 * and putting it last would read as the destination.
 */
const PIPELINE_STAGES: {
  value: Exclude<CandidateStage, "rejected">;
  label: string;
  tone?: "default" | "success" | "muted";
}[] = [
  { value: "applied", label: "Applied" },
  { value: "screening", label: "Screening" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "hired", label: "Hired", tone: "success" },
];

/**
 * How many candidates have *reached* each stage, from a snapshot of where they
 * are now.
 *
 * `by_stage` counts where everybody currently sits, not where they have been,
 * so reading it directly as a funnel gives conversions above 100%: somebody who
 * was hired is no longer counted under "applied".
 *
 * Since the stages are strictly ordered, the cumulative count is recoverable:
 * anybody currently at *interview* must have passed *applied* and *screening*,
 * so "reached this stage" is the sum of this stage and every stage after it.
 *
 * **What this cannot recover is where a rejection happened.** A rejected
 * candidate holds one terminal stage with no record of the step they fell at,
 * so they are excluded entirely rather than guessed at — which means the funnel
 * describes the people still in it plus those hired, and the conversion figures
 * are "of those who got this far and were not rejected". Recovering the rest
 * needs stage history, which the model does not keep.
 */
function reachedByStage(
  byStage: Partial<Record<CandidateStage, number>>,
): { key: string; label: string; count: number; tone?: "default" | "success" | "muted" }[] {
  return PIPELINE_STAGES.map((stage, index) => ({
    key: stage.value,
    label: stage.label,
    tone: stage.tone,
    count: PIPELINE_STAGES.slice(index).reduce(
      (sum, later) => sum + (byStage[later.value] ?? 0),
      0,
    ),
  }));
}

export default function RecruitmentPage() {
  const isHR = useCan("recruitment.manage");
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query, 300);
  const { page, pageSize, setPage, setPageSize, reset } = usePagedList();
  const { data: jobPage, isLoading } = useJobs(archived, {
    search: search || undefined,
    page,
    pageSize,
  });
  const jobs = jobPage?.results;

  useEffect(() => {
    reset();
  }, [archived, search, reset]);
  const archiveJob = useArchive("recruitment/jobs", "recruitment");
  const { data: summary } = useRecruitmentSummary();
  const [dialog, setDialog] = useState<{ open: boolean; job: JobPosting | null }>({ open: false, job: null });

  return (
    <PageContainer>
      <PageHeader
        title="Recruitment"
        subtitle="Open roles and the hiring pipeline"
        icon={<PersonSearchIcon />}
        actions={
          <>
            
            {/* The public board this page publishes to.
                It existed and nothing inside the product linked to it, so the
                people posting the roles had no way to see what a candidate
                sees — or to copy the address they are meant to share. Opens
                in a new tab: it is a different audience’s page, not a step
                in this one. */}
            <Button
              component="a"
              href="/careers"
              target="_blank"
              rel="noopener"
              startIcon={<OpenInNewIcon />}
            >
              Public job board
            </Button>
            <ExportButton
              path="recruitment/jobs"
              label="Export jobs"
              filters={[
                {
                  type: "select",
                  param: "status",
                  label: "Status",
                  options: [
                    { value: "draft", label: "Draft" },
                    { value: "open", label: "Open" },
                    { value: "closed", label: "Closed" },
                  ],
                },
              ]}
            />
            {isHR && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, job: null })}>
                New Job
              </Button>
            )}
          </>
        }
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search roles…"
        searchLabel="Search job postings by title, place or description"
      />

      {isHR && summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 6, md: 3 }}>
            <StatCard label="Open positions" value={summary.open_positions} icon={<WorkIcon />} color="primary" />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <StatCard label="Total candidates" value={summary.total_candidates} icon={<GroupsIcon />} color="info" />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <StatCard label="In interview" value={summary.by_stage.interview ?? 0} icon={<PersonSearchIcon />} color="secondary" />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <StatCard label="Hired" value={summary.hired} icon={<GroupsIcon />} color="success" />
          </Grid>
        </Grid>
      )}

      {/* **The four tiles above say how many; this says where they stop.**
          `by_stage` was already being served and only one of its six numbers
          was ever read — "In interview" — so the shape of the pipeline was in
          the payload and never on the screen. */}
      {summary ? (
        <Box sx={{ mb: 3 }}>
          <SectionCard
            title="Pipeline"
            subtitle="How far candidates get. Rejections are excluded — the record does not say which stage they left at"
          >
            <FunnelBars
              stages={reachedByStage(summary.by_stage)}
              emptyTitle="Nobody in the pipeline yet"
              emptyDescription="Once candidates apply, this shows how many reach each stage and how many are lost between them."
            />
          </SectionCard>
        </Box>
      ) : null}

      <Typography variant="overline" color="text.secondary">
        Job postings
      </Typography>
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <ArchiveTabs archived={archived} onChange={setArchived} liveLabel="Open roles" />
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={92} />)
        ) : jobs && jobs.length > 0 ? (
          jobs.map((job) => (
            <Card key={job.id} sx={{ position: "relative", transition: "box-shadow .2s", "&:hover": { boxShadow: 3 } }}>
              {isHR && (
                // Outside the action area: filing a role away must not also
                // open it.
                <Box sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}>
                  <ArchiveButton
                    archived={archived}
                    noun="role"
                    onToggle={() => archiveJob.mutate({ id: job.id, archived })}
                  />
                </Box>
              )}
              <CardActionArea component={Link} href={`/recruitment/${job.id}`}>
                <CardContent>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ justifyContent: "space-between" }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {job.title}
                        </Typography>
                        <Chip size="small" label={JOB_STATUS_META[job.status].label} color={JOB_STATUS_META[job.status].color} />
                      </Stack>
                      <Stack direction="row" spacing={2} sx={{ mt: 0.5, color: "text.secondary", flexWrap: "wrap" }} useFlexGap>
                        {job.department_name && (
                          <Typography variant="body2">{job.department_name}</Typography>
                        )}
                        {job.location && (
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                            <LocationOnIcon fontSize="small" />
                            <Typography variant="body2">{job.location}</Typography>
                          </Stack>
                        )}
                        <Typography variant="body2">{EMPLOYMENT_LABEL[job.employment_type]}</Typography>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                          <GroupsIcon fontSize="small" />
                          <Typography variant="body2">{job.candidate_count} applicants</Typography>
                        </Stack>
                      </Stack>
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Chip variant="outlined" label={salaryRange(job.salary_min, job.salary_max)} />
                      {isHR && (
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.preventDefault();
                            setDialog({ open: true, job });
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent sx={{ textAlign: "center", py: 6 }}>
              <PersonSearchIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
              <Typography variant="h6">No job postings</Typography>
              <Typography color="text.secondary">
                {isHR ? "Post your first opening." : "No open positions right now."}
              </Typography>
            </CardContent>
          </Card>
        )}
      </Stack>

      <ListPagination
        page={page}
        pageSize={pageSize}
        count={jobPage?.count ?? 0}
        noun="roles"
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      <JobDialog open={dialog.open} job={dialog.job} onClose={() => setDialog((d) => ({ ...d, open: false }))} />
    </PageContainer>
  );
}
