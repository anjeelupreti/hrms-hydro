"use client";

import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";

import {
  useEventAttachments,
  useRemoveEventAttachment,
  useUploadEventAttachment,
} from "@/hooks/useCalendar";

/**
 * Files on a calendar entry.
 *
 * 🔴 **The model and the endpoints existed and nothing on the calendar used
 * them.** `EventAttachment` was added for meeting papers, hung on
 * `CompanyEvent` precisely so a calendar entry and a meeting could share it —
 * and then only the meeting record grew a tab. So the API would accept an
 * upload against any calendar entry and there was no way to make one, which is
 * a worse state than not having built it: the capability is there and invisible.
 *
 * **A file needs a row to belong to**, so this is inert until the entry has been
 * saved once. Rather than hide the section and leave somebody hunting for the
 * paperclip, it says so.
 */
export default function EventAttachments({
  eventId,
  readOnly = false,
}: {
  /** `null` while the entry is still being created. */
  eventId: number | null;
  readOnly?: boolean;
}) {
  const { data: files, isPending } = useEventAttachments(eventId);
  const upload = useUploadEventAttachment();
  const remove = useRemoveEventAttachment();
  const input = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (eventId === null) {
    return (
      <Typography variant="caption" color="text.secondary">
        Save the entry first — a file has to belong to something.
      </Typography>
    );
  }

  return (
    <Stack spacing={1.25}>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {isPending ? null : (files ?? []).length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          Nothing attached. An agenda, a map, the slides — whatever people need
          before they turn up.
        </Typography>
      ) : (
        (files ?? []).map((file) => (
          <Stack
            key={file.id}
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              px: 1.25,
              py: 0.75,
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <InsertDriveFileOutlinedIcon fontSize="small" color="action" />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <MuiLink
                href={file.file_url}
                target="_blank"
                rel="noopener"
                variant="body2"
                sx={{ fontWeight: 600 }}
              >
                {file.caption || file.filename}
              </MuiLink>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {file.caption ? `${file.filename} · ` : ""}
                {file.uploaded_by_name ? `added by ${file.uploaded_by_name}` : "added"}
              </Typography>
            </Box>
            {!readOnly ? (
              <Tooltip title="Remove">
                <IconButton
                  size="small"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(
                      { eventId, id: file.id },
                      { onError: (e) => setError(e.message) }
                    )
                  }
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>
        ))
      )}

      {!readOnly ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextField
            size="small"
            fullWidth
            label="What is it (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <Button
            size="small"
            startIcon={<AttachFileIcon />}
            disabled={upload.isPending}
            onClick={() => input.current?.click()}
            sx={{ flexShrink: 0 }}
          >
            {upload.isPending ? "Adding…" : "Attach"}
          </Button>
          <input
            ref={input}
            type="file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared either way: picking the same file twice in a row fires
              // no change event unless the input is reset.
              event.target.value = "";
              if (!file) return;
              upload.mutate(
                { eventId, file, caption: caption.trim() || undefined },
                { onSuccess: () => setCaption(""), onError: (e) => setError(e.message) }
              );
            }}
          />
        </Stack>
      ) : null}
    </Stack>
  );
}
