"use client";

import FileDownloadIcon from "@mui/icons-material/FileDownload";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { TOAST_ANCHOR, toastSx } from "@/components/common/GlobalToaster";
import DateField from "@/components/common/DateField";

export type ExportFilter =
  | { type: "daterange"; field: string; label: string }
  | { type: "select"; param: string; label: string; options: { value: string; label: string }[] };

/**
 * Opens a filter modal (filters vary per module), then downloads the
 * module's styled Excel via fetch → blob so we can show a real
 * success/failure snackbar and honour the server's dated filename.
 */
export default function ExportButton({
  path,
  filters = [],
  baseQuery,
  label = "Export",
  title = "Export to Excel",
  size = "medium",
}: {
  path: string;
  filters?: ExportFilter[];
  baseQuery?: string;
  label?: string;
  title?: string;
  size?: "small" | "medium" | "large";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [snack, setSnack] = useState<{ open: boolean; ok: boolean; msg: string }>({ open: false, ok: true, msg: "" });

  function setVal(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function runExport() {
    const params = new URLSearchParams(baseQuery);
    for (const f of filters) {
      if (f.type === "daterange") {
        if (values[`${f.field}__gte`]) params.set(`${f.field}__gte`, values[`${f.field}__gte`]);
        if (values[`${f.field}__lte`]) params.set(`${f.field}__lte`, values[`${f.field}__lte`]);
      } else if (values[f.param]) {
        params.set(f.param, values[f.param]);
      }
    }
    const qs = params.toString();
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/${path}/export${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? "export.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setSnack({ open: true, ok: true, msg: `Download started — ${name}` });
      setOpen(false);
    } catch {
      setSnack({ open: true, ok: false, msg: "Export failed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outlined" size={size} startIcon={<FileDownloadIcon />} onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          {filters.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Export the current list to a styled Excel workbook.
            </Typography>
          ) : (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Optionally narrow the export — leave blank to include everything.
              </Typography>
              {filters.map((f) =>
                f.type === "daterange" ? (
                  <Stack key={f.field} direction="row" spacing={2}>
                    <DateField
                      label={`${f.label} from`}
                      value={values[`${f.field}__gte`] ?? ""}
                      onChange={(v) => setVal(`${f.field}__gte`, v)}
                    />
                    <DateField
                      label="to"
                      value={values[`${f.field}__lte`] ?? ""}
                      onChange={(v) => setVal(`${f.field}__lte`, v)}
                    />
                  </Stack>
                ) : (
                  <TextField key={f.param} select label={f.label} fullWidth value={values[f.param] ?? ""} onChange={(e) => setVal(f.param, e.target.value)}>
                    <MenuItem value="">All</MenuItem>
                    {f.options.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" startIcon={<FileDownloadIcon />} onClick={runExport} disabled={busy}>
            {busy ? "Preparing…" : "Download"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={TOAST_ANCHOR}
        sx={toastSx}
      >
        <Alert severity={snack.ok ? "success" : "error"} variant="filled" onClose={() => setSnack((s) => ({ ...s, open: false }))}>
          {snack.msg}
        </Alert>
      </Snackbar>
    </>
  );
}
