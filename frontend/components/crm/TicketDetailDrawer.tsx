"use client";

import LockIcon from "@mui/icons-material/Lock";
import PublicIcon from "@mui/icons-material/Public";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import { useState } from "react";

import { EmployeePicker } from "@/components/common/pickers";
import {
  useAssignTicket,
  useTicketReply,
  useTicketTimeline,
  type ClientTicket,
  type TimelineEntry,
} from "@/hooks/useTickets";

/**
 * One ticket, and the conversation on it.
 *
 * The board showed a queue and gave no way to work it — you could see that
 * somebody was waiting and not answer them.
 *
 * **The composer is the whole risk of this screen.** A reply reaches the
 * customer and stops the response clock; an internal note does neither. Getting
 * that boundary wrong once leaks "their account is overdue, go carefully" to
 * the person it is about, and there is no taking it back. So the two modes are
 * not a subtle toggle — the box changes colour, the placeholder changes, the
 * button changes word, and an internal note carries a padlock. The default is
 * **reply**, because the common act is answering somebody and a default of
 * *internal* would train people to click past it.
 */
export default function TicketDetailDrawer({
  ticket,
  onClose,
}: {
  ticket: ClientTicket | null;
  onClose: () => void;
}) {
  const { data: timeline, isLoading } = useTicketTimeline(ticket?.id ?? null);
  const reply = useTicketReply();
  const assign = useAssignTicket();

  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!ticket) return null;
  const internal = mode === "note";

  async function send() {
    if (!ticket || !body.trim()) return;
    setError(null);
    try {
      await reply.mutateAsync({ id: ticket.id, body: body.trim(), internal });
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not send.");
    }
  }

  return (
    <Drawer anchor="right" open onClose={onClose} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 520 } } } }}>
      <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", height: "100%" }}>
        <Stack direction="row" sx={{ alignItems: "flex-start", mb: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              {ticket.reference} · {ticket.client_name}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {ticket.subject}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", mb: 2 }} useFlexGap>
          <Chip size="small" label={ticket.priority} />
          <Chip size="small" variant="outlined" label={ticket.channel} />
          {ticket.response_breached && (
            <Tooltip title="First reply was overdue">
              <Chip size="small" color="error" label="response breached" />
            </Tooltip>
          )}
          {ticket.resolution_breached && (
            <Tooltip title="Resolution is overdue">
              <Chip size="small" color="error" label="resolution breached" />
            </Tooltip>
          )}
        </Stack>

        {ticket.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {ticket.description}
          </Typography>
        )}

        <Box sx={{ mb: 2 }}>
          <EmployeePicker
            label="Assigned to"
            value={ticket.assignee}
            onChange={(id) => assign.mutate({ id: ticket.id, assignee: id })}
          />
        </Box>

        <Divider sx={{ mb: 1.5 }} />

        <Typography variant="overline" color="text.secondary">
          History
        </Typography>

        <Box sx={{ flex: 1, overflowY: "auto", mb: 2 }}>
          {isLoading ? (
            <Skeleton variant="rounded" height={160} />
          ) : (timeline ?? []).length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              Nothing recorded yet.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {(timeline ?? []).map((entry) => (
                <TimelineRow key={entry.id} entry={entry} />
              ))}
            </Stack>
          )}
        </Box>

        <Divider sx={{ mb: 1.5 }} />

        {/* The composer. Two modes, made loud rather than subtle — see the
            component docstring for why this is the risky part of the screen. */}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_, v) => v && setMode(v)}
          sx={{ mb: 1 }}
        >
          <ToggleButton value="reply">
            <PublicIcon fontSize="small" sx={{ mr: 0.5 }} /> Reply to client
          </ToggleButton>
          <ToggleButton value="note">
            <LockIcon fontSize="small" sx={{ mr: 0.5 }} /> Internal note
          </ToggleButton>
        </ToggleButtonGroup>

        <TextField
          multiline
          minRows={3}
          fullWidth
          size="small"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            internal
              ? "Only your colleagues will see this."
              : "This goes to the client and stops the response clock."
          }
          sx={{
            // The colour is the warning. A note and a reply must not look alike.
            "& .MuiOutlinedInput-root": {
              bgcolor: internal ? "warning.main" : "transparent",
              // A tint, not a fill — readable, but unmistakably different.
              backgroundImage: internal
                ? "linear-gradient(rgba(255,255,255,0.86), rgba(255,255,255,0.86))"
                : "none",
            },
          }}
        />

        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {internal
              ? "Does not stop the response clock — the customer has still heard nothing."
              : ticket.first_response_at
                ? "The response clock already stopped on the first reply."
                : "This will stop the response clock."}
          </Typography>
          <Button
            variant="contained"
            color={internal ? "warning" : "primary"}
            disabled={!body.trim() || reply.isPending}
            onClick={send}
          >
            {reply.isPending ? "Sending…" : internal ? "Save note" : "Send reply"}
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const isInternal = entry.visibility === "internal";
  const isStatus = entry.kind === "status";

  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: 2,
        border: 1,
        borderColor: isInternal ? "warning.light" : "divider",
        bgcolor: isStatus ? "transparent" : "background.paper",
      }}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.5 }}>
        {/* Said on every row, not inferred from a colour somebody might not
            notice: whether the customer saw this is the fact that matters. */}
        <Chip
          size="small"
          icon={isInternal ? <LockIcon /> : <PublicIcon />}
          label={isInternal ? "internal" : "client saw this"}
          color={isInternal ? "warning" : "success"}
          variant="outlined"
          sx={{ height: 20, fontSize: 10 }}
        />
        <Typography variant="caption" color="text.secondary">
          {entry.who || "system"}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
          {new Date(entry.created_at).toLocaleString()}
        </Typography>
      </Stack>

      {isStatus ? (
        <Typography variant="body2" color="text.secondary">
          Moved {entry.from_value || "—"} to <strong>{entry.to_value}</strong>
          {entry.body ? ` · ${entry.body}` : ""}
        </Typography>
      ) : (
        <Typography variant="body2">{entry.body}</Typography>
      )}
    </Box>
  );
}
