"use client";

/**
 * Biometric terminal management.
 *
 * The delicate part is the token. It exists in plaintext for exactly one
 * render — the server only ever stores a hash — so the UI has to make that
 * unmissable rather than tuck it into a toast the user might dismiss. Hence
 * the blocking dialog with a copy button and an explicit acknowledgement.
 */

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import KeyIcon from "@mui/icons-material/Key";
import { useState } from "react";

import {
  useCreateDevice,
  useDevices,
  useRotateDeviceToken,
  useUpdateDevice,
} from "@/hooks/useAttendance";
import type { AttendanceDevice } from "@/types/attendance";

const DEVICE_TYPES = [
  { value: "zkteco", label: "ZKTeco" },
  { value: "hikvision", label: "Hikvision" },
  { value: "generic", label: "Generic / custom push" },
];

function lastSeen(iso: string | null) {
  if (!iso) return { label: "Never", stale: true };
  const ageMinutes = (Date.now() - new Date(iso).getTime()) / 60000;
  return {
    label: new Date(iso).toLocaleString(undefined, {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }),
    // A terminal that hasn't reported in a day is almost certainly unplugged,
    // and silence is exactly how that goes unnoticed until payroll.
    stale: ageMinutes > 60 * 24,
  };
}

/** Shown once, immediately after issue or rotation. */
function TokenDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Push token</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This is the only time this token will be shown. We store a hash of it,
          so it cannot be recovered — if you lose it, rotate and reconfigure.
        </Alert>

        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
          <Box
            sx={{
              flex: 1, p: 1.5, borderRadius: 1.5, overflowX: "auto",
              bgcolor: "background.default", border: "1px solid", borderColor: "divider",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13,
            }}
          >
            {token}
          </Box>
          <Tooltip title={copied ? "Copied" : "Copy"}>
            <IconButton
              onClick={() => {
                navigator.clipboard?.writeText(token);
                setCopied(true);
              }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Configure the terminal to POST punches to:
        </Typography>
        <Box
          sx={{
            p: 1.5, borderRadius: 1.5, bgcolor: "background.default",
            border: "1px solid", borderColor: "divider",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12.5, whiteSpace: "pre-wrap",
          }}
        >
          {`POST /api/v1/attendance/device-sync/\nAuthorization: Bearer <token>\n\n{"employee_id": "EMP-001",\n "event_type": "check_in",\n "timestamp": "2026-08-05T09:14:00Z"}`}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          I&apos;ve saved it
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeviceDialog({ onClose, onIssued }: { onClose: () => void; onIssued: (t: string) => void }) {
  const create = useCreateDevice();
  const [form, setForm] = useState<Partial<AttendanceDevice>>({
    name: "", serial: "", device_type: "generic", location: "", timezone_name: "Asia/Kathmandu",
  });
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    setError("");
    create.mutate(form, {
      onSuccess: (device) => {
        onClose();
        if (device.token) onIssued(device.token);
      },
      onError: (e) => setError(e instanceof Error ? e.message : "Could not add the device."),
    });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add a terminal</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name" fullWidth size="small" value={form.name}
            onChange={(e) => set("name")(e.target.value)}
            placeholder="Main gate"
          />
          <TextField
            label="Serial number" fullWidth size="small" value={form.serial}
            onChange={(e) => set("serial")(e.target.value)}
            placeholder="ZK-8821"
            helperText="Must be unique. Printed on the device or shown in its admin menu."
          />
          <TextField
            select label="Type" fullWidth size="small" value={form.device_type}
            onChange={(e) => set("device_type")(e.target.value)}
            helperText="Vendor drivers aren't shipped yet — all types use the push endpoint."
          >
            {DEVICE_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Location" fullWidth size="small" value={form.location}
            onChange={(e) => set("location")(e.target.value)}
            placeholder="Reception"
          />
          <TextField
            label="Device timezone" fullWidth size="small" value={form.timezone_name}
            onChange={(e) => set("timezone_name")(e.target.value)}
            helperText="The zone the terminal stamps its punches in."
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={create.isPending || !form.name || !form.serial}
        >
          {create.isPending ? "Adding…" : "Add and issue token"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function DeviceManager() {
  const { data, isLoading } = useDevices();
  const update = useUpdateDevice();
  const rotate = useRotateDeviceToken();
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<AttendanceDevice | null>(null);

  if (isLoading || !data) return <Skeleton variant="rounded" height={280} />;

  const devices = data.results ?? [];

  return (
    <>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Attendance terminals</Typography>
          <Typography variant="body2" color="text.secondary">
            Devices allowed to push punches. Each has its own token; revoking one
            never affects the others.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          Add terminal
        </Button>
      </Stack>

      <Card>
        <Box sx={{ overflowX: "auto" }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Serial</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Punches</TableCell>
                <TableCell>Last seen</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
                      No terminals registered. Until one is added, the ingest endpoint
                      rejects every push — which is the intended default.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                devices.map((d) => {
                  const seen = lastSeen(d.last_seen_at);
                  return (
                    <TableRow key={d.id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{d.name}</Typography>
                        {d.location && (
                          <Typography variant="caption" color="text.secondary">{d.location}</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                        {d.serial}
                      </TableCell>
                      <TableCell>{d.device_type_label}</TableCell>
                      <TableCell>{d.event_count}</TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color={seen.stale ? "warning.main" : "text.primary"}
                        >
                          {seen.label}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={d.is_active ? "Active" : "Disabled"}
                          color={d.is_active ? "success" : "default"}
                          variant={d.is_active ? "filled" : "outlined"}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                          <Tooltip title="Issue a new token, invalidating the current one">
                            <IconButton size="small" onClick={() => setConfirmRotate(d)}>
                              <KeyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Button
                            size="small"
                            onClick={() => update.mutate({ id: d.id, values: { is_active: !d.is_active } })}
                            disabled={update.isPending}
                          >
                            {d.is_active ? "Disable" : "Enable"}
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Box>
      </Card>

      {adding && <DeviceDialog onClose={() => setAdding(false)} onIssued={setToken} />}
      {token && <TokenDialog token={token} onClose={() => setToken(null)} />}

      <Dialog open={confirmRotate !== null} onClose={() => setConfirmRotate(null)}>
        <DialogTitle>Rotate this token?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            <strong>{confirmRotate?.name}</strong> will stop being able to push punches
            until it is reconfigured with the new token. Punches it attempts in the
            meantime are rejected, not queued.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRotate(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={rotate.isPending}
            onClick={() => {
              if (!confirmRotate) return;
              rotate.mutate(confirmRotate.id, {
                onSuccess: (device) => {
                  setConfirmRotate(null);
                  if (device.token) setToken(device.token);
                },
              });
            }}
          >
            Rotate
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
