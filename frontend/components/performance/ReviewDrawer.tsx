"use client";

import { useState } from "react";
import { Box, Typography, Button, TextField, Stack, Rating, Divider } from "@mui/material";
import { useModalStore } from "@/hooks/useModalStore";
import { useReviews } from "@/hooks/useOrganization";
import type { Review } from "@/types/organization";

export default function ReviewDrawer({ reviewId }: { reviewId: number }) {
  const { closeDrawer } = useModalStore();
  
  // Since we only have the ID (or we might get the review object, but let's assume we fetch or find it)
  // Let's fetch the reviews for the given ID. We can just use the list query and find it.
  const { data, isLoading } = useReviews();
  const review = data?.results?.find((r: Review) => r.id === reviewId);

  const [selfAssessment, setSelfAssessment] = useState("");
  const [selfRating, setSelfRating] = useState<number | null>(null);
  
  const [managerAssessment, setManagerAssessment] = useState("");
  const [managerRating, setManagerRating] = useState<number | null>(null);

  // Sync the form to whichever review is open. Done during render rather
  // than in an effect: an effect would paint the previous review's answers
  // for a frame, and re-render immediately after — which is exactly what the
  // set-state-in-effect rule is warning about.
  const [syncedId, setSyncedId] = useState<number | null>(null);
  if (review && syncedId !== review.id) {
    setSyncedId(review.id);
    setSelfAssessment(review.self_assessment || "");
    setSelfRating(review.self_rating || null);
    setManagerAssessment(review.manager_assessment || "");
    setManagerRating(review.manager_rating || null);
  }

  if (isLoading) {
    return <Box sx={{ p: 3 }}><Typography>Loading review...</Typography></Box>;
  }

  if (!review) {
    return <Box sx={{ p: 3 }}><Typography>Review not found.</Typography></Box>;
  }

  // Assuming a generic save logic for demo - in reality you would have hooks `useSubmitSelfReview` / `useSubmitManagerReview`
  // We saw those in useOrganization.ts
  const isPendingSelf = review.status === "pending_self";
  const isPendingManager = review.status === "pending_manager";

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="h6" gutterBottom>{review.cycle_name || 'Performance Review'}</Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Employee: {review.employee_name}
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Status: {review.status.replace('_', ' ').toUpperCase()}
        </Typography>

        <Divider sx={{ my: 3 }} />

        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Self Assessment</Typography>
            <Rating 
              value={selfRating} 
              onChange={(_, newValue) => setSelfRating(newValue)} 
              readOnly={!isPendingSelf}
              sx={{ mb: 1 }}
            />
            <TextField 
              multiline 
              rows={4} 
              fullWidth 
              placeholder="Employee self-assessment..."
              value={selfAssessment}
              onChange={(e) => setSelfAssessment(e.target.value)}
              disabled={!isPendingSelf}
            />
          </Box>
          
          <Box>
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Manager Assessment</Typography>
            <Rating 
              value={managerRating} 
              onChange={(_, newValue) => setManagerRating(newValue)} 
              readOnly={!isPendingManager}
              sx={{ mb: 1 }}
            />
            <TextField 
              multiline 
              rows={4} 
              fullWidth 
              placeholder="Manager's feedback..."
              value={managerAssessment}
              onChange={(e) => setManagerAssessment(e.target.value)}
              disabled={!isPendingManager}
            />
          </Box>
        </Stack>
      </Box>

      <Box sx={{ pt: 3, mt: 3, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <Button onClick={closeDrawer}>Close</Button>
        {(isPendingSelf || isPendingManager) && (
          <Button variant="contained" onClick={closeDrawer}>
            Submit Review
          </Button>
        )}
      </Box>
    </Box>
  );
}
