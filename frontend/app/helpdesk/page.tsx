"use client";

import AddIcon from "@mui/icons-material/Add";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
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
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import StateChip, { toneFor } from "@/components/common/StateChip";
import EmptyState from "@/components/common/EmptyState";
import SearchField from "@/components/common/SearchField";
import CountFilterBar from "@/components/common/CountFilterBar";
import ListInsight from "@/components/common/ListInsight";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useCan, useMe } from "@/hooks/useMe";
import { useTextFilter } from "@/hooks/useTextFilter";
import {
  useCommentTicket,
  useCreateTicket,
  useTicketQueueSummary,
  useTicketStatusCounts,
  useTickets,
  useUpdateTicket,
  type Ticket,
  type TicketStatus,
} from "@/hooks/useHelpdesk";

import { DepartmentPicker, EmployeePicker } from "@/components/common/pickers";

const CATEGORIES = ["it", "hr", "facilities", "payroll", "other"];
const PRIORITIES = ["low", "medium", "high", "urgent"];
const STATUSES = ["open", "in_progress", "resolved", "closed"];
const PRIORITY_COLOR = { low: "default", medium: "info", high: "warning", urgent: "error" } as const;

export default function HelpdeskPage() {
  const { data: me } = useMe();
  const isHR = useCan("workplace.manage");
  const [status, setStatus] = useState<TicketStatus | "">("");
  const { data } = useTickets({ status: status || undefined });
  const { data: counts } = useTicketStatusCounts();
  const { data: queue } = useTicketQueueSummary();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const tickets = data?.results ?? [];
  // Resolve the open ticket from the live list so it stays fresh after
  // comments/updates (react-query refetches; the id is the stable handle).
  const openTicket = tickets.find((t) => t.id === openId) ?? null;

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(tickets, (t) => [
    `#${t.id}`,
    t.subject,
    t.description,
    t.category,
    t.priority,
    t.status.replace("_", " "),
    t.requester_name,
    t.assignee_name,
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Helpdesk"
        subtitle="Raise and track internal support tickets"
        icon={<SupportAgentIcon />}
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search tickets…"
              label="Search tickets by number, subject, category, status or people"
            />
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
              New ticket
            </Button>
          </>
        }
      />
      {queue && queue.unresolved > 0 ? (
        <ListInsight
          headline={
            queue.oldest_open_days == null
              ? `${queue.unresolved} waiting`
              : queue.oldest_open_days === 0
                ? `${queue.unresolved} waiting, all raised today`
                : `${queue.oldest_open_days} day${queue.oldest_open_days === 1 ? "" : "s"} waiting`
          }
          reading={
            queue.oldest_open_days == null || queue.oldest_open_days === 0
              ? `Nothing has been sitting overnight. ${queue.resolved_this_week} closed in the last seven days.`
              : `is how long the oldest of ${queue.unresolved} unresolved request${queue.unresolved === 1 ? " has" : "s has"} been open. ${queue.resolved_this_week} closed in the last seven days.`
          }
          aside={
            queue.unassigned > 0 ? (
              <>
                <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                  {queue.unassigned} unassigned
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  nobody has picked {queue.unassigned === 1 ? "it" : "them"} up
                </Typography>
              </>
            ) : undefined
          }
          segments={[
            { label: "Open", value: counts?.open ?? 0, depth: 0 },
            { label: "In progress", value: counts?.in_progress ?? 0, depth: 0.4 },
            { label: "Resolved", value: counts?.resolved ?? 0, depth: 0.75 },
            { label: "Closed", value: counts?.closed ?? 0, depth: 1 },
          ]}
        />
      ) : null}

      {/* Backlog at a glance, and the way into it. Counts come from the
          server: "2 open" tallied down the visible list stops at the page. */}
      <Box sx={{ mb: 2 }}>
        <CountFilterBar
          ariaLabel="Filter tickets by status"
          value={status}
          onChange={(next) => setStatus(next)}
          options={[
            { value: "", label: "All", count: counts?.total },
            { value: "open", label: "Open", count: counts?.open, tone: "warning" },
            { value: "in_progress", label: "In progress", count: counts?.in_progress, tone: "info" },
            { value: "resolved", label: "Resolved", count: counts?.resolved, tone: "success" },
            { value: "closed", label: "Closed", count: counts?.closed },
          ]}
        />
      </Box>

      <Stack spacing={1.5}>
        {filtered.length === 0 ? (
          <EmptyState
            variant={isEmptyResult ? "noResults" : "empty"}
            title={isEmptyResult ? `No tickets match “${query}”` : "No tickets yet"}
            description={
              isEmptyResult
              ? "Try a different search, or clear it to see everything."
              : "Internal requests live here — IT problems, HR questions, facilities. Each ticket has a type, a priority and one named owner, so nothing sits unclaimed."
            }
            surface
          />
        ) : (
          filtered.map((t) => (
            <Card key={t.id} sx={{ cursor: "pointer" }} onClick={() => setOpenId(t.id)}>
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
                      #{t.id} {t.subject}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t.category.toUpperCase()} · {t.requester_name ?? "—"}
                      {t.target_department_name ? ` · ${t.target_department_name}` : ""}
                      {t.assignee_name ? ` → ${t.assignee_name}` : ""}
                      {t.comments.length ? ` · ${t.comments.length} comment(s)` : ""}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Chip size="small" label={t.priority} color={PRIORITY_COLOR[t.priority]} variant="outlined" />
                    <StateChip label={String(t.status.replace("_", " "))} tone={toneFor(t.status)} />
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))
        )}
      </Stack>

      {creating && <TicketDialog onClose={() => setCreating(false)} />}
      {openTicket && (
        <TicketDetailDialog
          ticket={openTicket}
          isHR={Boolean(isHR)}
          isRequester={openTicket.requester === me?.employee_id}
          onClose={() => setOpenId(null)}
        />
      )}
    </PageContainer>
  );
}

function TicketDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateTicket();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("it");
  const [priority, setPriority] = useState("medium");
  // Which desk this is for. Chosen here, at the one moment somebody knows what
  // their problem is about — see `Ticket.target_department`.
  const [targetDepartment, setTargetDepartment] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await create.mutateAsync({
        subject,
        description,
        category,
        priority,
        target_department: targetDepartment,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open ticket.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New ticket</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} />
          <Stack direction="row" spacing={2}>
            <TextField select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ flex: 1 }}>
              {CATEGORIES.map((c) => <MenuItem key={c} value={c} sx={{ textTransform: "uppercase" }}>{c}</MenuItem>)}
            </TextField>
            <TextField select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} sx={{ flex: 1 }}>
              {PRIORITIES.map((p) => <MenuItem key={p} value={p} sx={{ textTransform: "capitalize" }}>{p}</MenuItem>)}
            </TextField>
          </Stack>
          <DepartmentPicker
            label="Send it to"
            value={targetDepartment}
            onChange={setTargetDepartment}
            helperText="Which desk handles this. Somebody there picks it up."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={create.isPending || !subject}>Open ticket</Button>
      </DialogActions>
    </Dialog>
  );
}

function TicketDetailDialog({
  ticket,
  isHR,
  isRequester,
  onClose,
}: {
  ticket: Ticket;
  isHR: boolean;
  isRequester: boolean;
  onClose: () => void;
}) {
  const update = useUpdateTicket();
  const comment = useCommentTicket();
  const [body, setBody] = useState("");

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>#{ticket.id} {ticket.subject}</DialogTitle>
      <DialogContent dividers>
        {ticket.description && (
          <Typography variant="body2" sx={{ mb: 2, whiteSpace: "pre-wrap" }}>
            {ticket.description}
          </Typography>
        )}

        {isHR && (
          <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: "wrap", gap: 2 }}>
            <TextField select size="small" label="Status" value={ticket.status} onChange={(e) => update.mutate({ id: ticket.id, status: e.target.value })} sx={{ minWidth: 140 }}>
              {STATUSES.map((s) => <MenuItem key={s} value={s} sx={{ textTransform: "capitalize" }}>{s.replace("_", " ")}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Priority" value={ticket.priority} onChange={(e) => update.mutate({ id: ticket.id, priority: e.target.value })} sx={{ minWidth: 120 }}>
              {PRIORITIES.map((p) => <MenuItem key={p} value={p} sx={{ textTransform: "capitalize" }}>{p}</MenuItem>)}
            </TextField>
            {/* Two controls, because they answer different questions and
                change at different times. The desk is where the ticket
                belongs; the assignee is who is on it today. */}
            <DepartmentPicker
              label="Desk"
              value={ticket.target_department ?? null}
              onChange={(id) => update.mutate({ id: ticket.id, target_department: id })}
              size="small"
              sx={{ minWidth: 180 }}
            />
            <EmployeePicker
              label="Assignee"
              value={ticket.assignee ?? null}
              onChange={(id) => id !== null && update.mutate({ id: ticket.id, assignee: id })}
              size="small"
              sx={{ minWidth: 220 }}
            />
            {/* Not a second assignee — who else can read it and hears about
                it. A manager, a second engineer, the site chief. */}
            <EmployeePicker
              label="Also keep in the loop"
              multiple
              value={ticket.watchers ?? []}
              onChange={(ids) => update.mutate({ id: ticket.id, watchers: ids })}
              size="small"
              sx={{ minWidth: 260 }}
            />
          </Stack>
        )}
        {!isHR && isRequester && ticket.status !== "closed" && (
          <Button size="small" sx={{ mb: 2 }} onClick={() => update.mutate({ id: ticket.id, status: "closed" })}>
            Close ticket
          </Button>
        )}

        <Typography variant="overline" color="text.secondary">Conversation</Typography>
        <Stack spacing={1} sx={{ my: 1 }}>
          {ticket.comments.length === 0 && (
            <Typography variant="body2" color="text.secondary">No comments yet.</Typography>
          )}
          {ticket.comments.map((c) => (
            <Box key={c.id} sx={{ p: 1, borderRadius: 2, bgcolor: "action.hover" }}>
              <Typography variant="caption" color="text.secondary">
                {c.author_name} · {new Date(c.created_at).toLocaleString()}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{c.body}</Typography>
            </Box>
          ))}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <TextField size="small" fullWidth placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button
            variant="contained"
            disabled={comment.isPending || !body.trim()}
            onClick={async () => { await comment.mutateAsync({ id: ticket.id, body }); setBody(""); }}
          >
            Send
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
