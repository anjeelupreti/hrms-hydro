"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";

import { useSaveJob } from "@/hooks/useRecruitment";
import type { EmploymentType, JobPosting, JobStatus } from "@/types/recruitment";
import { DepartmentPicker } from "@/components/common/pickers";

type Props = { open: boolean; onClose: () => void; job: JobPosting | null };

export default function JobDialog({ open, onClose, job }: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <JobForm key={job?.id ?? "new"} onClose={onClose} job={job} />
    </Dialog>
  );
}

function JobForm({ onClose, job }: Omit<Props, "open">) {
  const saveJob = useSaveJob();
  const [title, setTitle] = useState(job?.title ?? "");
  const [department, setDepartment] = useState<number | "">(job?.department ?? "");
  const [location, setLocation] = useState(job?.location ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType>(job?.employment_type ?? "full_time");
  const [jobStatus, setJobStatus] = useState<JobStatus>(job?.status ?? "open");
  const [openings, setOpenings] = useState(job?.openings ?? 1);
  const [salaryMin, setSalaryMin] = useState(job?.salary_min ?? "");
  const [salaryMax, setSalaryMax] = useState(job?.salary_max ?? "");
  const [description, setDescription] = useState(job?.description ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await saveJob.mutateAsync({
        id: job?.id,
        values: {
          title,
          department: department === "" ? null : Number(department),
          location,
          employment_type: employmentType,
          status: jobStatus,
          openings: Number(openings),
          salary_min: salaryMin ? Number(salaryMin) : null,
          salary_max: salaryMax ? Number(salaryMax) : null,
          description,
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
      <DialogTitle>{job ? "Edit job posting" : "New job posting"}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Job title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <DepartmentPicker
              value={department === "" ? null : department}
              onChange={(id) => setDepartment(id ?? "")}
            />
            <TextField label="Location" fullWidth value={location} onChange={(e) => setLocation(e.target.value)} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select label="Type" fullWidth value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
              <MenuItem value="full_time">Full time</MenuItem>
              <MenuItem value="part_time">Part time</MenuItem>
              <MenuItem value="contract">Contract</MenuItem>
              <MenuItem value="internship">Internship</MenuItem>
            </TextField>
            <TextField select label="Status" fullWidth value={jobStatus} onChange={(e) => setJobStatus(e.target.value as JobStatus)}>
              <MenuItem value="draft">Draft</MenuItem>
              <MenuItem value="open">Open</MenuItem>
              <MenuItem value="closed">Closed</MenuItem>
            </TextField>
            <TextField label="Openings" type="number" fullWidth value={openings} onChange={(e) => setOpenings(Number(e.target.value))} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Salary min" type="number" fullWidth value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} />
            <TextField label="Salary max" type="number" fullWidth value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} />
          </Stack>
          <TextField label="Description" fullWidth multiline minRows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saveJob.isPending || !title.trim()}>
          Save
        </Button>
      </DialogActions>
    </>
  );
}
