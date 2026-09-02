"use client";

/**
 * HR's queue of changes people have asked for.
 *
 * **Sensitive requests lead, and say why they are sensitive.** A bank account
 * and a phone number are not the same decision: approving the first sends
 * somebody's salary somewhere new, and the run afterwards looks completely
 * normal. The queue sorts on that rather than on date alone, because a stale
 * address change should never push an account change below the fold.
 *
 * **Approving applies the change**, so the button says so. "Approve" on its own
 * reads like triage — moving a card out of a queue — and this writes to the
 * record.
 */

import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import StateChip, { toneFor } from "@/components/common/StateChip";
import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import PersonAvatar from "@/components/common/PersonAvatar";
import PageContainer from "@/components/shell/PageContainer";
import ListPagination from "@/components/common/ListPagination";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagedList } from "@/hooks/usePagedList";
import ListInsight from "@/components/common/ListInsight";
import {
  useChangeRequestCounts,
  useChangeRequests,
  useDecideChangeRequest,
} from "@/hooks/useChangeRequests";
import type { EmployeeChangeRequest } from "@/types/changeRequests";

/** Nothing to watch: the queue's age is read once per mount, not ticked. */
function subscribeToNothing() {
  return () => {};
}

/** Cached, because `getSnapshot` must return a stable value or React loops. */
let nowCache: number | null = null;
function getNow() {
  if (nowCache === null) nowCache = Date.now();
  return nowCache;
}

const TABS = [
  { label: "Waiting", status: "pending" },
  { label: "Decided", status: "" },
] as const;

export default function ChangeRequestQueuePage() {
  const [tab, setTab] = useState(0);
  const { data: counts } = useChangeRequestCounts();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query, 300);
  const { page, pageSize, setPage, setPageSize, reset } = usePagedList();
  const { data, isLoading } = useChangeRequests({
    ...(TABS[tab].status ? { status: TABS[tab].status } : { decided: true }),
    search: search || undefined,
    page,
    pageSize,
  });

  useEffect(() => {
    reset();
  }, [tab, search, reset]);
  const decide = useDecideChangeRequest();

  const [rejecting, setRejecting] = useState<EmployeeChangeRequest | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // "Now" read through `useSyncExternalStore` rather than `Date.now()` in the
  // body: a clock call during render is impure — it returns something different
  // on every re-render — and it is also the classic hydration mismatch, since
  // the server's clock is not the reader's. Same pattern as `PageHeader`.
  const now = useSyncExternalStore(subscribeToNothing, getNow, getNow);

  // The age of the oldest waiting request, from the rows. Not served, and
  // deliberately: a pending queue that outgrows one page is itself the finding,
  // and at that point the number to show is "more than a page of them".
  const oldestWaitDays = useMemo(() => {
    const waiting = (data?.results ?? []).filter((r) => r.status === "pending");
    if (waiting.length === 0) return 0;
    const oldest = Math.min(...waiting.map((r) => new Date(r.created_at).getTime()));
    return Math.max(0, Math.floor((now - oldest) / 86_400_000));
  }, [data, now]);

  // Both the "decided" split and the sensitive-first order now come from the
  // server. Doing either here sorted and filtered one page and presented the
  // result as the queue, which put the most urgent request on page four.
  const rows = data?.results ?? [];

  async function act(row: EmployeeChangeRequest, action: "approve" | "reject", text = "") {
    setError("");
    try {
      await decide.mutateAsync({ id: row.id, action, note: text });
      setRejecting(null);
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Change requests"
        subtitle="Changes people have asked for on their own records"
        icon={<ManageAccountsIcon />}
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search requests…"
        searchLabel="Search change requests by field or person"
      />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      {/* **A queue's health is its age, not its size.** Three waiting is fine
          if the oldest arrived this morning and a problem if it arrived last
          month, and a count alone cannot tell those apart — which is exactly
          how an approval queue quietly stops being worked. */}
      {counts ? (
        <ListInsight
          headline={
            counts.pending === 0 ? "Nothing waiting" : `${counts.pending} waiting`
          }
          reading={
            counts.pending === 0
              ? "Every request people have made has been decided."
              : oldestWaitDays === 0
                ? "all raised today."
                : `the oldest has been waiting ${oldestWaitDays} day${oldestWaitDays === 1 ? "" : "s"}. Bank details and statutory numbers are what these change, so payroll is downstream of this queue.`
          }
          aside={
            counts.rejected > 0 ? (
              <>
                <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                  {counts.rejected} refused
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  each with a reason on it
                </Typography>
              </>
            ) : undefined
          }
          segments={[
            { label: "Waiting", value: counts.pending, depth: 0 },
            { label: "Approved", value: counts.approved, depth: 1 },
            { label: "Refused", value: counts.rejected, depth: 0, attention: true },
            { label: "Withdrawn", value: counts.withdrawn, depth: 0.4 },
          ]}
        />
      ) : null}

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        {TABS.map((t) => (
          <Tab key={t.label} label={t.label} />
        ))}
      </Tabs>

      {isLoading ? <CircularProgress /> : null}

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          surface
          title={tab === 0 ? "Nothing waiting" : "Nothing decided yet"}
          description={
            tab === 0
              ? "When somebody asks to change their bank details or their legal name, it lands here for a second pair of eyes."
              : "Approved and declined requests are kept here as the record of what changed and who agreed to it."
          }
        />
      ) : null}

      <Stack spacing={1.5}>
        {rows.map((row) => (
          <Card key={row.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                <PersonAvatar name={row.employee_name} size={32} variant="outlined" />

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {row.employee_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      wants to change
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {row.field_label}
                    </Typography>
                    {row.is_sensitive ? (
                      <Chip
                        size="small"
                        color="warning"
                        icon={<WarningAmberIcon />}
                        label="Check carefully"
                      />
                    ) : null}
                    {row.status !== "pending" ? (
                      <StateChip label={String(row.status)} tone={toneFor(row.status)} />
                    ) : null}
                  </Stack>

                  <Typography variant="body2" sx={{ mt: 0.75 }}>
                    <Box component="span" sx={{ color: "text.secondary" }}>
                      {row.old_value || "nothing on record"}
                    </Box>{" "}
                    → <strong>{row.new_value}</strong>
                  </Typography>

                  {row.reason ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                      “{row.reason}”
                    </Typography>
                  ) : null}

                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                    Asked by {row.requested_by_name ?? "—"} · <DateText value={row.created_at} />
                  </Typography>

                  {row.decision_note ? (
                    <Alert severity="info" sx={{ mt: 1, py: 0 }}>
                      {row.decided_by_name}: {row.decision_note}
                    </Alert>
                  ) : null}
                </Box>

                {row.status === "pending" ? (
                  <Stack spacing={0.5} sx={{ flexShrink: 0 }}>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<CheckIcon />}
                      disabled={decide.isPending}
                      onClick={() => act(row, "approve")}
                    >
                      {/* Says what it does: this writes to the record. */}
                      Approve &amp; apply
                    </Button>
                    <Button
                      size="small"
                      color="inherit"
                      startIcon={<CloseIcon />}
                      onClick={() => {
                        setRejecting(row);
                        setNote("");
                      }}
                    >
                      Decline
                    </Button>
                  </Stack>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <ListPagination
        page={page}
        pageSize={pageSize}
        count={data?.count ?? 0}
        noun="requests"
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      <Dialog open={Boolean(rejecting)} onClose={() => setRejecting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Decline this change?</DialogTitle>
        <DialogContent>
          {/* Required by the server too. A refusal with no reason sends the
              employee back to HR by email to ask why, which is the loop this
              whole feature exists to close. */}
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Why?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            helperText="They will see this, so it saves them asking."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!note.trim() || decide.isPending}
            onClick={() => rejecting && act(rejecting, "reject", note.trim())}
          >
            Decline
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
