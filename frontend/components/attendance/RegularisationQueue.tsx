"use client";

import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import UndoIcon from "@mui/icons-material/Undo";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import CountFilterBar from "@/components/common/CountFilterBar";
import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import PersonAvatar from "@/components/common/PersonAvatar";
import { useDecideRegularisation, useRegularisations } from "@/hooks/useRegularisation";
import type { RegularisationStatus } from "@/hooks/useRegularisation";

/**
 * Attendance disputes, and deciding them.
 *
 * **The reason is the content.** An approver is not checking arithmetic — the
 * request carries times that may be blank and a sentence explaining what
 * happened, and the sentence is what the decision rests on. So it is shown at
 * full width rather than truncated into a table cell, which is what a DataGrid
 * would have done to it.
 *
 * Approving writes to the attendance log; nothing before that does. A pending
 * request is a claim.
 */

const TONE: Record<RegularisationStatus, "default" | "success" | "error" | "warning"> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
  cancelled: "default",
};

export default function RegularisationQueue({
  /** HR sees everyone's and can decide; an employee sees only their own. */
  canDecide,
  employee,
}: {
  canDecide: boolean;
  employee?: number;
}) {
  const [status, setStatus] = useState<string>("pending");
  const { data, isLoading } = useRegularisations({ employee, status: status || undefined });
  const decide = useDecideRegularisation();
  const [error, setError] = useState("");

  const rows = data?.results ?? [];

  async function act(id: number, action: "approve" | "reject" | "cancel") {
    setError("");
    try {
      await decide.mutateAsync({ id, action });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be recorded.");
    }
  }

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      <CountFilterBar
        ariaLabel="Filter disputes by status"
        value={status}
        onChange={setStatus}
        options={[
          { value: "pending", label: "Pending", tone: "warning" },
          { value: "approved", label: "Approved", tone: "success" },
          { value: "rejected", label: "Rejected", tone: "danger" },
          { value: "", label: "All" },
        ]}
      />

      <Box sx={{ mt: 2 }}>
        {isLoading ? (
          <Stack spacing={1}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={92} />
            ))}
          </Stack>
        ) : rows.length === 0 ? (
          <EmptyState
            title={status === "pending" ? "Nothing waiting" : "Nothing here"}
            description={
              status === "pending"
                ? "Attendance disputes appear here for a decision."
                : "No requests with this status."
            }
          />
        ) : (
          <Stack spacing={1.5}>
            {rows.map((row) => (
              <Card key={row.id} variant="outlined">
                <CardContent>
                  <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                    <PersonAvatar name={row.employee_name} size={38} variant="outlined" />

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "center", flexWrap: "wrap" }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {row.employee_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          <DateText value={row.date} format="short" />
                        </Typography>
                        <Chip size="small" label={row.status} color={TONE[row.status]} />
                      </Stack>

                      {/* Full width, not a cell. This is what is being decided. */}
                      <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
                        {row.reason}
                      </Typography>

                      {row.requested_check_in || row.requested_check_out || row.requested_status ? (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                          Asking for{" "}
                          {row.requested_status ? `“${row.requested_status.replace("_", " ")}”` : "a correction"}
                          {row.requested_check_in
                            ? ` from ${new Date(row.requested_check_in).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
                            : ""}
                          {row.requested_check_out
                            ? ` to ${new Date(row.requested_check_out).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
                            : ""}
                        </Typography>
                      ) : null}

                      {row.reviewed_by_name ? (
                        <Typography variant="caption" color="text.disabled" sx={{ mt: 0.75, display: "block" }}>
                          Decided by {row.reviewed_by_name}
                          {row.review_note ? ` — ${row.review_note}` : ""}
                        </Typography>
                      ) : null}
                    </Box>

                    {row.status === "pending" ? (
                      <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                        {canDecide ? (
                          <>
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<CheckIcon />}
                              onClick={() => act(row.id, "approve")}
                              disabled={decide.isPending}
                            >
                              Approve
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              startIcon={<CloseIcon />}
                              onClick={() => act(row.id, "reject")}
                              disabled={decide.isPending}
                            >
                              Reject
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="small"
                            startIcon={<UndoIcon />}
                            onClick={() => act(row.id, "cancel")}
                            disabled={decide.isPending}
                          >
                            Withdraw
                          </Button>
                        )}
                      </Stack>
                    ) : null}
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
