"use client";

import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";

import {
  useAddLetterAttachment,
  useRemoveLetterAttachment,
  type LetterAttachment,
} from "@/hooks/useCorrespondence";

/**
 * The files on a letter, either direction.
 *
 * **A file needs a row to belong to,** so this is inert until the letter has
 * been saved once — which is also why saving and sending are two buttons on
 * the outgoing form. Rather than hide the section and leave somebody wondering
 * where the paperclip went, it says so.
 */
export default function LetterAttachments({
  direction,
  letterId,
  attachments,
  readOnly,
}: {
  direction: "outgoing" | "incoming";
  letterId: number | null;
  attachments: LetterAttachment[];
  readOnly?: boolean;
}) {
  const add = useAddLetterAttachment(direction);
  const remove = useRemoveLetterAttachment(direction);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2">Attachments</Typography>
        <Typography variant="caption" color="text.secondary">
          {attachments.length === 0 ? "none" : `${attachments.length}`}
        </Typography>
      </Stack>

      {letterId === null ? (
        <Typography variant="caption" color="text.secondary">
          Save the letter first — a file has to belong to something.
        </Typography>
      ) : null}

      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {attachments.map((file) => (
        <Stack
          key={file.id}
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            px: 1,
            py: 0.5,
            borderRadius: 1.5,
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <InsertDriveFileOutlinedIcon fontSize="small" color="action" />
          <Link
            href={file.file_url}
            target="_blank"
            rel="noopener"
            variant="body2"
            sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {file.filename}
          </Link>
          {!readOnly && letterId !== null ? (
            <Tooltip title="Remove">
              <IconButton
                size="small"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(
                    { id: letterId, attachmentId: file.id },
                    { onError: (e) => setError(e.message) }
                  )
                }
              >
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      ))}

      {!readOnly ? (
        <div>
          <Button
            size="small"
            startIcon={<AttachFileIcon />}
            disabled={letterId === null || add.isPending}
            onClick={() => input.current?.click()}
          >
            {add.isPending ? "Attaching…" : "Attach a file"}
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
              if (!file || letterId === null) return;
              add.mutate({ id: letterId, file }, { onError: (e) => setError(e.message) });
            }}
          />
        </div>
      ) : null}
    </Stack>
  );
}
