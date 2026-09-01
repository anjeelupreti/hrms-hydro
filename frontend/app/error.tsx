"use client";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect } from "react";

import EmptyState from "@/components/common/EmptyState";
import PageContainer from "@/components/shell/PageContainer";
import { FONT } from "@/lib/theme/tokens";

/**
 * The app-level error boundary.
 *
 * Without this, an unhandled render error shows Next's own error screen in
 * development and a blank page in production — which is how the
 * `alpha(var(--…))` crash presented: a white screen with no way forward.
 *
 * Note `unstable_retry`, not `reset`: the prop was renamed in this version of
 * Next. It re-renders the segment, so a transient failure (a dropped API call,
 * a race on first paint) recovers without a full reload.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Sentry's Next integration captures this automatically; the console line
    // is for local work, where the overlay is not always the thing you are
    // looking at.
    console.error("Unhandled render error:", error);
  }, [error]);

  return (
    <PageContainer>
      <Stack sx={{ minHeight: "60vh", justifyContent: "center" }}>
        <EmptyState
          variant="error"
          title="Something broke on this page"
          description="The rest of the app is fine — this is one screen failing to render. Retrying often clears it; if it doesn't, the details below help us find it."
          action={
            <Stack direction="row" spacing={1.5}>
              <Button variant="contained" onClick={() => unstable_retry()}>
                Try again
              </Button>
              <Button variant="outlined" onClick={() => window.location.assign("/dashboard")}>
                Go to dashboard
              </Button>
            </Stack>
          }
        />

        {/* The digest is what correlates this screen with the server log entry,
            so it is worth showing rather than hiding behind a console. */}
        {error.digest && (
          <Typography
            variant="caption"
            sx={{ textAlign: "center", mt: 2, color: "text.disabled", fontFamily: FONT.mono }}
          >
            Reference: {error.digest}
          </Typography>
        )}
      </Stack>
    </PageContainer>
  );
}
