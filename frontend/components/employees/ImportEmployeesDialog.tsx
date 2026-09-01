"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import {
  useImportEmployees,
  usePreviewImport,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportSummary,
} from "@/hooks/useEmployees";

/**
 * Choose a file, see who is in it, choose who comes in.
 *
 * Shows what a spreadsheet contains before anything is written, so somebody
 * can see who is in it and choose who comes in — a judgement the import itself
 * cannot make.
 *
 * **Everything is shown, nothing is filtered away.** Rows that cannot be
 * created — no email, or somebody already on the payroll — stay in the list,
 * greyed and labelled with why. Hiding them produces the question "where did my
 * row go", which is worse than an explained refusal.
 *
 */

type Stage = "choose" | "review" | "done";

const STATUS_TEXT: Record<ImportPreviewRow["status"], string> = {
  ready: "",
  duplicate: "Already here",
  invalid: "No email",
};

export default function ImportEmployeesDialog({ onClose }: { onClose: () => void }) {
  const preview = usePreviewImport();
  const importEmployees = useImportEmployees();

  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<ImportPreview | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stage: Stage = summary ? "done" : data ? "review" : "choose";

  const ready = (data?.rows ?? []).filter((r) => r.status === "ready");

  async function choose(chosen: File | undefined) {
    if (!chosen) return;
    setError(null);
    setFile(chosen);
    try {
      const result = await preview.mutateAsync(chosen);
      setData(result);
      // Everybody importable, ticked. Somebody unticks whoever they would
      // rather leave out.
      const importable = result.rows.filter((r) => r.status === "ready");
      setPicked(new Set(importable.map((r) => r.row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file could not be read.");
    }
  }

  function toggle(row: ImportPreviewRow) {
    if (row.status !== "ready") return;
    setError(null);
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(row.row)) {
        next.delete(row.row);
        return next;
      }
      next.add(row.row);
      return next;
    });
  }

  async function run() {
    if (!file) return;
    setError(null);
    try {
      setSummary(await importEmployees.mutateAsync({ file, rows: [...picked] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import could not be completed.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Import employees</DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {stage === "choose" && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Download the template, fill in one employee per row, and upload it. Nothing is
              created until you have seen the list and confirmed it. Departments and job titles
              are created automatically if they do not exist.
            </Typography>
            <Link href="/api/proxy/employees/employees/import-template" variant="body2">
              Download the template
            </Link>
            <Button
              component="label"
              variant="outlined"
              startIcon={<UploadFileIcon />}
              disabled={preview.isPending}
            >
              {preview.isPending ? "Reading the file…" : "Choose a spreadsheet"}
              <input
                hidden
                type="file"
                accept=".xlsx"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </Button>
          </Stack>
        )}

        {stage === "review" && data && (
          <Stack spacing={2}>
            {/* The constraint, stated before the list rather than discovered
                inside it. `--/80` in the owner's shorthand. */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                p: 2,
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700 }}>
                  {picked.size} of {ready.length} selected
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "44ch" }}>
                  Untick anybody you would rather leave out. The rows that
                  cannot be created are listed below rather than hidden.
                </Typography>
              </Box>
            </Box>

            <Box sx={{ maxHeight: 340, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
              {data.rows.map((row) => {
                const selectable = row.status === "ready";
                const checked = picked.has(row.row);
                return (
                  <Box
                    key={row.row}
                    onClick={() => toggle(row)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      px: 1,
                      py: 0.75,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      cursor: selectable ? "pointer" : "default",
                      opacity: selectable ? 1 : 0.55,
                      "&:last-of-type": { borderBottom: "none" },
                      "&:hover": selectable ? { bgcolor: "action.hover" } : undefined,
                    }}
                  >
                    <Tooltip title={row.note || ""}>
                      <Box component="span" sx={{ display: "inline-flex" }}>
                        <Checkbox
                          size="small"
                          checked={checked}
                          disabled={!selectable}
                          onChange={() => toggle(row)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Box>
                    </Tooltip>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                        {row.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                        {row.email || "no email"}
                        {row.department ? ` · ${row.department}` : ""}
                        {row.designation ? ` · ${row.designation}` : ""}
                      </Typography>
                    </Box>

                    {!selectable && (
                      <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 600, flexShrink: 0 }}>
                        {STATUS_TEXT[row.status]}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Stack>
        )}

        {stage === "done" && summary && (
          <Stack spacing={2}>
            <Alert severity={summary.errors.length ? "warning" : "success"} icon={<CheckCircleIcon />}>
              Added <strong>{summary.created}</strong> employee{summary.created === 1 ? "" : "s"}
              {summary.skipped ? `, skipped ${summary.skipped}` : ""}.
            </Alert>
            {summary.errors.length > 0 && (
              <Box sx={{ maxHeight: 220, overflowY: "auto" }}>
                {summary.errors.map((e, i) => (
                  <Typography key={i} variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                    Row {e.row}{e.email ? ` · ${e.email}` : ""} — {e.error}
                  </Typography>
                ))}
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{stage === "done" ? "Done" : "Cancel"}</Button>
        {stage === "review" && (
          <Button
            variant="contained"
            onClick={run}
            disabled={picked.size === 0 || importEmployees.isPending}
          >
            {importEmployees.isPending
              ? "Adding…"
              : `Add ${picked.size} employee${picked.size === 1 ? "" : "s"}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
