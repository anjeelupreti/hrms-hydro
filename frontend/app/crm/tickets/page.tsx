"use client";

import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import ViewListIcon from "@mui/icons-material/ViewList";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import KanbanBoard from "@/components/common/KanbanBoard";
import CrmSubNav from "@/components/crm/CrmSubNav";
import TicketDetailDrawer from "@/components/crm/TicketDetailDrawer";
import PageContainer from "@/components/shell/PageContainer";
import ListInsight from "@/components/common/ListInsight";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import {
  useClientDeskSummary,
  useMoveTicket,
  useTicketBoard,
  type ClientTicket,
} from "@/hooks/useTickets";

const PRIORITY_COLOR: Record<string, "default" | "info" | "warning" | "error"> = {
  low: "default",
  normal: "info",
  high: "warning",
  urgent: "error",
};

/** Hours, said the way somebody would say it. A queue is read by age far more
 *  than by date — "open four days" is what makes somebody act. */
function age(hours: number) {
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function TicketCard({ ticket }: { ticket: ClientTicket }) {
  const breached = ticket.response_breached || ticket.resolution_breached;

  return (
    <Card
      variant="outlined"
      sx={{
        // A breach is the one thing that should be visible without reading.
        borderColor: breached ? "error.main" : undefined,
        borderWidth: breached ? 2 : 1,
      }}
    >
      <CardContent sx={{ p: "12px !important" }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>
            {ticket.reference}
          </Typography>
          <Chip
            size="small"
            label={ticket.priority}
            color={PRIORITY_COLOR[ticket.priority]}
            sx={{ height: 18, fontSize: 10 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
            {age(ticket.age_hours)}
          </Typography>
        </Stack>

        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {ticket.subject}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
          {ticket.client_name}
          {ticket.assignee_name ? ` · ${ticket.assignee_name}` : " · unassigned"}
        </Typography>

        {breached && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, flexWrap: "wrap" }}>
            {/* Named separately: missing the first reply and missing the fix are
                different failures with different remedies. */}
            {ticket.response_breached && (
              <Tooltip title="First reply is overdue">
                <Chip size="small" color="error" label="response" sx={{ height: 18, fontSize: 10 }} />
              </Tooltip>
            )}
            {ticket.resolution_breached && (
              <Tooltip title="Resolution is overdue">
                <Chip size="small" color="error" label="resolution" sx={{ height: 18, fontSize: 10 }} />
              </Tooltip>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

export default function TicketsPage() {
  const [view, setView] = useState<"board" | "list">("board");
  const [selected, setSelected] = useState<ClientTicket | null>(null);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");

  const { data: board, isLoading, error } = useTicketBoard({
    search: search || undefined,
    priority: priority || undefined,
  });
  const move = useMoveTicket();
  const { data: desk } = useClientDeskSummary();

  return (
    <PageContainer>
      <PageHeader
        title="Client desk"
        subtitle="Concerns customers have raised, and where each one stands"
        icon={<SupportAgentIcon />}
        module="CRM"
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            
            <TextField
              select
              size="small"
              label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              sx={{ minWidth: 130 }}
            >
              <MenuItem value="">All</MenuItem>
              {["low", "normal", "high", "urgent"].map((p) => (
                <MenuItem key={p} value={p}>
                  {p}
                </MenuItem>
              ))}
            </TextField>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={view}
              onChange={(_, v) => v && setView(v)}
              aria-label="View"
            >
              <ToggleButton value="board">
                <ViewKanbanIcon fontSize="small" sx={{ mr: 0.5 }} /> Board
              </ToggleButton>
              <ToggleButton value="list">
                <ViewListIcon fontSize="small" sx={{ mr: 0.5 }} /> List
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        }
      />

      <ListControls
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search tickets…"
      />

      <CrmSubNav />

      {desk && desk.live > 0 ? (
        <Box sx={{ mt: 2 }}>
          <ListInsight
            headline={
              desk.response_breaches > 0
                ? `${desk.response_breaches} client${desk.response_breaches === 1 ? " is" : "s are"} still waiting for a first reply`
                : `${desk.live} open, all replied to in time`
            }
            reading={
              desk.response_breaches > 0
                ? `past the time we promised them. ${desk.awaiting_first_reply} of ${desk.live} open tickets have had no reply at all yet.`
                : desk.awaiting_first_reply > 0
                  ? `${desk.awaiting_first_reply} are awaiting a first reply, all still inside their promised time.`
                  : "Every open ticket has been picked up and answered."
            }
            aside={
              desk.resolution_breaches > 0 ? (
                <>
                  <Typography
                    color="error.main"
                    sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}
                  >
                    {desk.resolution_breaches} overdue
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    past the fix we committed to
                  </Typography>
                </>
              ) : desk.unassigned > 0 ? (
                <>
                  <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                    {desk.unassigned} unassigned
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    nobody owns {desk.unassigned === 1 ? "it" : "them"} yet
                  </Typography>
                </>
              ) : undefined
            }
          />
        </Box>
      ) : null}

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error instanceof Error ? error.message : "Could not load the desk."}
        </Alert>
      )}

      {isLoading || !board ? (
        <Skeleton variant="rounded" height={440} sx={{ mt: 2 }} />
      ) : view === "board" ? (
        <Box sx={{ mt: 2 }}>
          <KanbanBoard
            columns={board.columns}
            transitions={board.transitions}
            getId={(t) => t.id}
            renderCard={(t) => (
              <Box onClick={() => setSelected(t)}>
                <TicketCard ticket={t} />
              </Box>
            )}
            onMove={async (ticket, to) => {
              // Awaited so the board's refusal path and the server's 409
              // (an illegal move the client did not know about) both land
              // before the drag is considered finished.
              await move.mutateAsync({ id: ticket.id, status: to });
            }}
            emptyHint="Nothing waiting"
          />
        </Box>
      ) : (
        <Stack spacing={1} sx={{ mt: 2 }}>
          {/* The same data, same filters — a list is a different reading of one
              queue, not a different queue. */}
          {board.columns.flatMap((column) =>
            column.cards.map((ticket) => (
              <Stack
                key={ticket.id}
                direction="row"
                spacing={2}
                onClick={() => setSelected(ticket)}
                sx={{
                  alignItems: "center",
                  p: 1.5,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 2,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 72 }}>
                  {ticket.reference}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {ticket.subject}
                </Typography>
                <Chip size="small" label={column.label} />
                <Chip size="small" label={ticket.priority} color={PRIORITY_COLOR[ticket.priority]} />
                <Typography variant="caption" color="text.secondary">
                  {age(ticket.age_hours)}
                </Typography>
              </Stack>
            ))
          )}
          {board.columns.every((c) => c.cards.length === 0) && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
              No tickets match those filters.
            </Typography>
          )}
        </Stack>
      )}

      {/* Re-read from the board so a move or a reply made in the drawer is
          reflected here rather than showing the card as it was when opened. */}
      <TicketDetailDrawer
        ticket={
          selected
            ? (board?.columns.flatMap((c) => c.cards).find((t) => t.id === selected.id) ?? selected)
            : null
        }
        onClose={() => setSelected(null)}
      />
    </PageContainer>
  );
}
