"use client";

import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import Breadcrumbs from "@/components/shell/Breadcrumbs";
import ExportButton from "@/components/common/ExportButton";
import CandidateDialog from "@/components/recruitment/CandidateDialog";
import CandidatePipeline from "@/components/recruitment/CandidatePipeline";
import { EMPLOYMENT_LABEL, JOB_STATUS_META, salaryRange } from "@/components/recruitment/recruitmentMeta";
import PageContainer from "@/components/shell/PageContainer";
import { useCandidates, useJob } from "@/hooks/useRecruitment";
import { useCan } from "@/hooks/useMe";

export default function JobDetailPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params.jobId);
  const isHR = useCan("recruitment.manage");

  const { data: job } = useJob(jobId);
  const { data: candidates, isLoading } = useCandidates(isHR ? jobId : null);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <PageContainer>
      <Breadcrumbs />
      <Button component={Link} href="/recruitment" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 2 }}>
        Recruitment
      </Button>

      {job ? (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { sm: "flex-start" }, mb: 3 }}>
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>
                {job.title}
              </Typography>
              <Chip size="small" label={JOB_STATUS_META[job.status].label} color={JOB_STATUS_META[job.status].color} />
            </Stack>
            <Stack direction="row" spacing={2} sx={{ mt: 0.5, color: "text.secondary", flexWrap: "wrap" }} useFlexGap>
              {job.department_name && <Typography variant="body2">{job.department_name}</Typography>}
              {job.location && (
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                  <LocationOnIcon fontSize="small" />
                  <Typography variant="body2">{job.location}</Typography>
                </Stack>
              )}
              <Typography variant="body2">{EMPLOYMENT_LABEL[job.employment_type]}</Typography>
              <Typography variant="body2">{salaryRange(job.salary_min, job.salary_max)}</Typography>
              <Typography variant="body2">{job.openings} opening{job.openings === 1 ? "" : "s"}</Typography>
            </Stack>
          </Box>
          {isHR && (
            <Stack direction="row" spacing={1}>
              <ExportButton
                path="recruitment/candidates"
                baseQuery={`job=${jobId}`}
                label="Export candidates"
                filters={[
                  {
                    type: "select",
                    param: "stage",
                    label: "Stage",
                    options: [
                      { value: "applied", label: "Applied" },
                      { value: "screening", label: "Screening" },
                      { value: "interview", label: "Interview" },
                      { value: "offer", label: "Offer" },
                      { value: "hired", label: "Hired" },
                      { value: "rejected", label: "Rejected" },
                    ],
                  },
                ]}
              />
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
                Add candidate
              </Button>
            </Stack>
          )}
        </Stack>
      ) : (
        <Skeleton variant="text" width={280} height={44} sx={{ mb: 3 }} />
      )}

      {!isHR ? (
        <Typography color="text.secondary">The candidate pipeline is visible to HR admins only.</Typography>
      ) : isLoading ? (
        <Skeleton variant="rounded" height={440} />
      ) : (
        <CandidatePipeline candidates={candidates ?? []} />
      )}

      <CandidateDialog open={addOpen} onClose={() => setAddOpen(false)} jobId={jobId} />
    </PageContainer>
  );
}
