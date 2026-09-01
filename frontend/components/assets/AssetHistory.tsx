"use client";

import AddIcon from "@mui/icons-material/Add";
import AssignmentIndIcon from "@mui/icons-material/AssignmentInd";
import BuildIcon from "@mui/icons-material/Build";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import NoteIcon from "@mui/icons-material/Note";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useState } from "react";

import DateField from "@/components/common/DateField";
import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import {
  useAddAssetEvent,
  useAssetHistory,
  type Asset,
  type AssetEventKind,
} from "@/hooks/useAssets";

/**
 * Everything that has happened to one asset.
 *
 * **The question this answers is "who had it when it broke".** The register
 * could say who holds a laptop now and could not say what it used to say,
 * because a `status` field was being overwritten and nothing wrote down the
 * previous value. Assignments were kept; repairs, write-offs, losses and the
 * condition it came back in were not.
 *
 * Drawn as a spine rather than a table: this is read as a sequence, and the
 * gap between two entries — six months in the store, then three repairs in a
 * fortnight — is a fact a table hides.
 */

const KIND_ICON: Record<string, typeof NoteIcon> = {
  acquired: AddIcon,
  assigned: AssignmentIndIcon,
  returned: KeyboardReturnIcon,
  maintenance: BuildIcon,
  repaired: CheckCircleIcon,
  status: HelpOutlineIcon,
  note: NoteIcon,
  retired: DeleteForeverIcon,
  lost: HelpOutlineIcon,
};

const KIND_COLOUR: Record<string, "primary" | "warning" | "error" | "success" | "info"> = {
  acquired: "info",
  assigned: "primary",
  returned: "info",
  maintenance: "warning",
  repaired: "success",
  status: "info",
  note: "info",
  retired: "error",
  lost: "error",
};

/** What can be recorded by hand. The rest are written by the assign and return
 *  actions, and offering them here would let somebody log an assignment that
 *  never moved the asset. */
const MANUAL_KINDS: { value: AssetEventKind; label: string }[] = [
  { value: "maintenance", label: "Sent for maintenance" },
  { value: "repaired", label: "Back from maintenance" },
  { value: "note", label: "Note" },
  { value: "retired", label: "Retired" },
  { value: "lost", label: "Reported lost" },
  { value: "acquired", label: "Acquired" },
];

export default function AssetHistory({
  asset,
  canEdit,
  onClose,
}: {
  asset: Asset | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { data: events, isLoading } = useAssetHistory(asset?.id ?? null);
  const add = useAddAssetEvent();

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<AssetEventKind>("note");
  const [note, setNote] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!asset) return;
    setError(null);
    try {
      await add.mutateAsync({
        assetId: asset.id,
        kind,
        note,
        occurred_on: occurredOn || undefined,
      });
      setAdding(false);
      setNote("");
      setOccurredOn("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be recorded.");
    }
  }

  return (
    <Dialog open={asset !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {asset?.name}
        <Typography variant="body2" color="text.secondary">
          {asset?.asset_tag}
          {asset?.serial_number ? ` · ${asset.serial_number}` : ""}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        {canEdit ? (
          adding ? (
            <Box
              sx={(theme) => ({
                p: 2,
                mb: 2,
                borderRadius: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.04),
                border: "1px solid",
                borderColor: "divider",
              })}
            >
              <Stack spacing={2}>
                <TextField
                  select
                  label="What happened"
                  size="small"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AssetEventKind)}
                >
                  {MANUAL_KINDS.map((k) => (
                    <MenuItem key={k.value} value={k.value}>
                      {k.label}
                    </MenuItem>
                  ))}
                </TextField>
                <DateField
                  label="When"
                  size="small"
                  value={occurredOn}
                  onChange={setOccurredOn}
                  helperText="Leave empty for today."
                />
                <TextField
                  label="Note"
                  size="small"
                  multiline
                  minRows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" size="small" onClick={submit} disabled={add.isPending}>
                    Record
                  </Button>
                  <Button size="small" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ) : (
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setAdding(true)}
              sx={{ mb: 2 }}
            >
              Record something
            </Button>
          )
        ) : null}

        {isLoading ? (
          <Skeleton variant="rounded" height={160} />
        ) : (events ?? []).length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Assignments, returns, repairs and write-offs appear here as they happen."
            compact
          />
        ) : (
          <Box sx={{ position: "relative", pl: 3 }}>
            {/* The spine. A single line behind the markers, so the sequence
                reads as one run rather than as a stack of unrelated rows. */}
            <Box
              sx={{
                position: "absolute",
                left: 11,
                top: 8,
                bottom: 8,
                width: 2,
                bgcolor: "divider",
              }}
            />
            <Stack spacing={2.5}>
              {(events ?? []).map((event) => {
                const Icon = KIND_ICON[event.kind] ?? NoteIcon;
                const colour = KIND_COLOUR[event.kind] ?? "info";
                return (
                  <Stack key={event.id} direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                    <Box
                      sx={(theme) => ({
                        position: "absolute",
                        left: 0,
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        display: "grid",
                        placeItems: "center",
                        bgcolor: "background.paper",
                        border: "2px solid",
                        borderColor: theme.palette[colour].main,
                        color: theme.palette[colour].main,
                      })}
                    >
                      <Icon sx={{ fontSize: 13 }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, ml: 1.5 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "baseline", flexWrap: "wrap" }}
                      >
                        <Typography variant="subtitle2">{event.kind_display}</Typography>
                        {event.custodian_name ? (
                          <Typography variant="body2" color="text.secondary">
                            · {event.custodian_name}
                          </Typography>
                        ) : null}
                        <Box sx={{ flex: 1 }} />
                        <Typography variant="caption" color="text.secondary">
                          <DateText value={event.occurred_on} />
                        </Typography>
                      </Stack>
                      {event.from_value || event.to_value ? (
                        <Typography variant="body2" color="text.secondary">
                          {event.from_value || "—"} → {event.to_value || "—"}
                        </Typography>
                      ) : null}
                      {event.note ? (
                        <Typography variant="body2" sx={{ mt: 0.25 }}>
                          {event.note}
                        </Typography>
                      ) : null}
                      <Typography variant="caption" color="text.disabled">
                        {event.actor_name}
                      </Typography>
                    </Box>
                  </Stack>
                );
              })}
            </Stack>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
