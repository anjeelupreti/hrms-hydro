"use client";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Stack from "@mui/material/Stack";
import Avatar from "@mui/material/Avatar";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmColor?: "error" | "warning" | "primary" | "success";
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Reusable confirmation dialog for destructive or important actions.
 * Drop-in replacement for window.confirm() with proper MUI styling.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  confirmColor = "error",
  loading = false,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Avatar
            sx={{
              bgcolor: `${confirmColor}.light`,
              color: `${confirmColor}.dark`,
              width: 40,
              height: 40,
            }}
          >
            <WarningAmberIcon fontSize="small" />
          </Avatar>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
        </Stack>
      </DialogTitle>
      {description && (
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </DialogContent>
      )}
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={confirmColor}
          onClick={onConfirm}
          disabled={loading}
          sx={{ minWidth: 100 }}
        >
          {loading ? "Please wait…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
