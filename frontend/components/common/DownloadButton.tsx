"use client";

import DownloadIcon from "@mui/icons-material/Download";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import { useState, type ReactNode } from "react";

import { TOAST_ANCHOR, toastSx } from "@/components/common/GlobalToaster";

/**
 * Fetches a file and hands it to the browser, instead of navigating at it.
 *
 * **What a plain link does when the server says no.** `<a href="/api/…">` on a
 * failing endpoint navigates to the response, so the reader gets a tab
 * containing `{"detail":"No PDF has been generated for this payslip yet."}`.
 * That is a developer's view of an error shown to somebody who wanted their
 * payslip, and it loses the page they were on.
 *
 * Fetching instead means a failure stays on the page and can be *read*: the
 * server's own explanation is surfaced, which for the payslip PDF is the
 * difference between "not generated" and "the renderer needs GTK installed".
 *
 * A success still ends in a real download — an object URL and a synthesised
 * click — so `Content-Disposition` is honoured and nothing changes for the
 * common case.
 */
export default function DownloadButton({
  url,
  filename,
  children,
  size = "small",
  startIcon,
  variant,
  /** Render as an icon button. Same fetch, same error handling — a compact
   *  row should not have to fall back to a raw link to save space. */
  iconOnly = false,
  title,
}: {
  url: string;
  /** Fallback name; the server's `Content-Disposition` wins when it sends one. */
  filename: string;
  children: ReactNode;
  size?: "small" | "medium" | "large";
  startIcon?: ReactNode;
  variant?: "text" | "outlined" | "contained";
  iconOnly?: boolean;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        // The API answers with `detail` throughout; anything else is shown as
        // a status rather than as an empty message.
        const body = await response.json().catch(() => null);
        setError(body?.detail ?? `The download failed (${response.status}).`);
        return;
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const named = /filename="?([^";]+)"?/.exec(disposition)?.[1];
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = named ?? filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Released on the next tick — revoking immediately can cancel the
      // download in some browsers before it has read the blob.
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      setError("The download could not be started. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {iconOnly ? (
        <IconButton size={size} onClick={download} disabled={busy} title={title}>
          {busy ? <CircularProgress size={16} /> : (startIcon ?? <DownloadIcon fontSize="small" />)}
        </IconButton>
      ) : (
        <Button
          size={size}
          variant={variant}
          onClick={download}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={14} /> : (startIcon ?? <DownloadIcon />)}
        >
          {children}
        </Button>
      )}

      <Snackbar
        open={Boolean(error)}
        autoHideDuration={null}
        onClose={() => setError(null)}
        anchorOrigin={TOAST_ANCHOR}
        sx={toastSx}
      >
        {/* No auto-hide: this carries the only explanation there is, and a
            message that vanishes while somebody is reading it is worse than
            no message. */}
        <Alert severity="warning" onClose={() => setError(null)} sx={{ maxWidth: 520 }}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}
