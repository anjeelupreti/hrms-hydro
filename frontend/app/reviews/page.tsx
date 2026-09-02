"use client";

import AddIcon from "@mui/icons-material/Add";
import AssessmentIcon from "@mui/icons-material/Assessment";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
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
import Rating from "@mui/material/Rating";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import DateText from "@/components/common/DateText";
import DateField from "@/components/common/DateField";
import EmptyState from "@/components/common/EmptyState";
import EmployeeLink from "@/components/common/EmployeeLink";
import CycleProgress from "@/components/reviews/CycleProgress";
import PageContainer from "@/components/shell/PageContainer";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import { useCan, useMe } from "@/hooks/useMe";
import ListPagination from "@/components/common/ListPagination";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagedList } from "@/hooks/usePagedList";
import {
  useCreateReviewCycle,
  useReviewCycles,
  useReviews,
  useStartReviewCycle,
  useSubmitManagerAssessment,
  useSubmitSelfAssessment,
} from "@/hooks/useOrganization";
import type { Review, ReviewCycleStatus } from "@/types/organization";

const CYCLE_STATUS_COLOR: Record<ReviewCycleStatus, "default" | "info" | "success"> = {
  draft: "default",
  active: "info",
  closed: "success",
};

const REVIEW_STATUS_COLOR = {
  pending_self: "warning",
  pending_manager: "info",
  completed: "success",
} as const;

export default function ReviewsPage() {
  const { data: me } = useMe();
  const isHR = useCan("workplace.manage");
  const { data: cycles } = useReviewCycles();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query, 300);
  const { page, pageSize, setPage, setPageSize, reset } = usePagedList();
  const { data: reviews } = useReviews({ search: search || undefined, page, pageSize });

  useEffect(() => {
    reset();
  }, [search, reset]);
  const createCycle = useCreateReviewCycle();
  const startCycle = useStartReviewCycle();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [assessDialog, setAssessDialog] = useState<{ review: Review; mode: "self" | "manager" } | null>(null);

  async function handleCreateCycle() {
    setError(null);
    try {
      await createCycle.mutateAsync({ name, start_date: startDate, end_date: endDate });
      setDialogOpen(false);
      setName("");
      setStartDate("");
      setEndDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const myEmployeeId = me?.employee_id;

  // Searched on the server, so a review on page three is findable by name.
  const filtered = reviews?.results ?? [];
  const isEmptyResult = Boolean(search) && filtered.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Performance Reviews"
        subtitle="Cycles, self-assessments and manager reviews"
        icon={<AssessmentIcon />}
        actions={
          <>
            
            {isHR && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
                New Cycle
              </Button>
            )}
          </>
        }
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search reviews…"
        searchLabel="Search reviews by employee, reviewer, cycle or status"
      />

      {/* Where the cycle stands, before the machinery for running it. Shown to
          everyone: an employee who has not written their self-assessment is
          exactly who this is for, and hiding it behind `isHR` would show the
          reading only to the people not holding it up. */}
      <CycleProgress
        cycles={cycles?.results ?? []}
        reviews={reviews?.results ?? []}
        truncated={Boolean(reviews && reviews.count > reviews.results.length)}
      />

      {isHR && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Cycles
          </Typography>
          <Stack spacing={1}>
            {cycles?.results.map((cycle) => (
              <Card key={cycle.id} variant="outlined">
                <CardContent sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Box>
                    <Typography variant="subtitle1">{cycle.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      <DateText value={cycle.start_date} /> → <DateText value={cycle.end_date} />
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Chip size="small" label={cycle.status} color={CYCLE_STATUS_COLOR[cycle.status]} />
                    {cycle.status === "draft" && (
                      <Button
                        size="small"
                        startIcon={<PlayArrowIcon />}
                        onClick={() => startCycle.mutate(cycle.id)}
                        disabled={startCycle.isPending}
                      >
                        Start
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            ))}
            {cycles && cycles.results.length === 0 && (
              <Typography color="text.secondary">No review cycles yet.</Typography>
            )}
          </Stack>
        </Box>
      )}

      <Typography variant="h6" sx={{ mb: 2 }}>
        {isHR ? "All reviews" : "My reviews"}
      </Typography>
      <Stack spacing={1}>
        {filtered.map((review) => {
          const isOwner = review.employee === myEmployeeId;
          const isReviewer = review.reviewer === myEmployeeId;
          return (
            <Card key={review.id} variant="outlined">
              <CardContent sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                <Box>
                  <Typography variant="subtitle1" component="div">
                    <EmployeeLink id={review.employee} name={review.employee_name} variant="subtitle1" /> —{" "}
                    {review.cycle_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Reviewer: {review.reviewer_name ?? "—"}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Chip size="small" label={review.status.replace("_", " ")} color={REVIEW_STATUS_COLOR[review.status]} />
                  {review.status === "pending_self" && isOwner && (
                    <Button size="small" onClick={() => setAssessDialog({ review, mode: "self" })}>
                      Submit self-assessment
                    </Button>
                  )}
                  {review.status === "pending_manager" && (isReviewer || isHR) && (
                    <Button size="small" onClick={() => setAssessDialog({ review, mode: "manager" })}>
                      Submit review
                    </Button>
                  )}
                </Stack>
              </CardContent>
            </Card>
          );
        })}
        {reviews && filtered.length === 0 && (
          <EmptyState
            variant={isEmptyResult ? "noResults" : "empty"}
            title={isEmptyResult ? `No reviews match “${query}”` : "No reviews yet"}
            description={
              isEmptyResult
              ? "Try a different search, or clear it to see everything."
              : "A review cycle asks each employee for a self-assessment, then their manager for a rating. Create a cycle to begin."
            }
            surface
          />
        )}
      </Stack>

      <ListPagination
        page={page}
        pageSize={pageSize}
        count={reviews?.count ?? 0}
        noun="reviews"
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New review cycle</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
            <DateField label="Start date" value={startDate} onChange={setStartDate} />
            <DateField label="End date" value={endDate} onChange={setEndDate} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateCycle} disabled={createCycle.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {assessDialog && (
        <AssessmentDialog
          key={`${assessDialog.review.id}-${assessDialog.mode}`}
          review={assessDialog.review}
          mode={assessDialog.mode}
          onClose={() => setAssessDialog(null)}
        />
      )}
    </PageContainer>
  );
}

function AssessmentDialog({
  review,
  mode,
  onClose,
}: {
  review: Review;
  mode: "self" | "manager";
  onClose: () => void;
}) {
  const submitSelf = useSubmitSelfAssessment();
  const submitManager = useSubmitManagerAssessment();
  const [text, setText] = useState("");
  const [rating, setRating] = useState<number | null>(3);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!rating) {
      setError("Please select a rating.");
      return;
    }
    try {
      if (mode === "self") {
        await submitSelf.mutateAsync({ id: review.id, self_assessment: text, self_rating: rating });
      } else {
        await submitManager.mutateAsync({ id: review.id, manager_assessment: text, manager_rating: rating });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{mode === "self" ? "Self-assessment" : "Manager review"}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Rating
            </Typography>
            <Rating value={rating} onChange={(_, value) => setRating(value)} />
          </Box>
          <TextField
            label={mode === "self" ? "Your self-assessment" : "Your assessment"}
            fullWidth
            multiline
            minRows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitSelf.isPending || submitManager.isPending}
        >
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
}
