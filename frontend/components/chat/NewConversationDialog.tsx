"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import SearchIcon from "@mui/icons-material/Search";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { useCreateConversation, useParticipants } from "@/hooks/useChat";
import { roleLabel } from "@/hooks/useMe";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: number) => void;
};

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

export default function NewConversationDialog({ open, onClose, onCreated }: Props) {
  const { data: participants } = useParticipants(open);
  const createConversation = useCreateConversation();

  const [type, setType] = useState<"dm" | "group">("dm");
  const [selected, setSelected] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setType("dm");
    setSelected([]);
    setName("");
    setSearch("");
    setError(null);
  }

  function close() {
    onClose();
    reset();
  }

  async function start(memberIds: number[]) {
    setError(null);
    try {
      const conv = await createConversation.mutateAsync({
        type,
        member_ids: memberIds,
        name: type === "group" ? name : undefined,
      });
      onCreated(conv.id);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  function handleRowClick(userId: number) {
    if (type === "dm") {
      start([userId]); // clicking a person immediately opens the DM
    } else {
      setSelected((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
    }
  }

  // Sorted by name, with the company's own collation, so Nepali and English
  // names order the way a phone book would. A directory of a hundred people in
  // API order cannot be scanned — you cannot tell whether the name you want is
  // above or below, which leaves the search box as the only route.
  const filtered = (participants ?? [])
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>New conversation</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={type}
            onChange={(_, next) => {
              if (next) {
                setType(next);
                setSelected([]);
              }
            }}
          >
            <ToggleButton value="dm">Direct message</ToggleButton>
            <ToggleButton value="group">Group</ToggleButton>
          </ToggleButtonGroup>

          {type === "group" && (
            <TextField label="Group name" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
          )}

          <TextField
            size="small"
            fullWidth
            placeholder="Search people…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />

          <Box sx={{ maxHeight: 300, overflowY: "auto", mx: -1 }}>
            {filtered.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                {participants?.length === 0 ? "No one else to chat with yet." : "No matches."}
              </Typography>
            ) : (
              filtered.map((p) => {
                const isSelected = selected.includes(p.user_id);
                return (
                  <ListItemButton
                    key={p.user_id}
                    selected={isSelected}
                    onClick={() => handleRowClick(p.user_id)}
                    sx={{ borderRadius: 2, gap: 1.5 }}
                  >
                    <Avatar sx={{ width: 36, height: 36, fontSize: 13, bgcolor: "transparent", color: "primary.main", border: "1.5px solid", borderColor: "primary.main" }}>
                      {initials(p.name)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {p.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {roleLabel(p.role)}
                      </Typography>
                    </Box>
                    {type === "group" && isSelected && <CheckCircleIcon fontSize="small" color="primary" />}
                  </ListItemButton>
                );
              })
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        {type === "group" && (
          <Button
            variant="contained"
            onClick={() => start(selected)}
            disabled={createConversation.isPending || selected.length === 0 || !name.trim()}
          >
            Create group ({selected.length})
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
