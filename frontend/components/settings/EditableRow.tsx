"use client";

import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState, type ReactNode } from "react";

/**
 * A settings row you can actually correct.
 *
 * Rename in place, for the settings lists — departments, job titles, holidays.
 * With only create and delete a typo can be fixed only by removing the row,
 * which the server rightly refuses while anybody is attached to it, and which
 * would sever every link if it did not.
 *
 * Every one of these is a `ModelViewSet`, so `PATCH` is already there; this is
 * the control that uses it.
 *
 * **Edit in place, not in a dialog.** Renaming one field is not worth a modal,
 * a form and two more clicks; the row becomes the field. Escape abandons,
 * Enter commits, and the original is restored on cancel so a half-typed
 * correction cannot be mistaken for a save.
 */
export default function EditableRow({
  value,
  secondary,
  onSave,
  onRemove,
  removeHint,
  canManage,
  saving = false,
  placeholder,
}: {
  value: string;
  /** A code or a parent name, shown as a chip beside the value. */
  secondary?: ReactNode;
  onSave: (next: string) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  /** Why removal might be refused — worth saying before the click, not after. */
  removeHint?: string;
  canManage: boolean;
  saving?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function begin() {
    // Seeded from the current value each time, so an abandoned edit does not
    // reappear the next time the row is opened.
    setDraft(value);
    setEditing(true);
  }

  async function commit() {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      return;
    }
    await onSave(next);
    setEditing(false);
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", py: 1, borderTop: "1px solid", borderColor: "divider" }}
    >
      {editing ? (
        <>
          <TextField
            size="small"
            fullWidth
            autoFocus
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <IconButton size="small" onClick={commit} disabled={saving} aria-label="Save">
            <CheckIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => setEditing(false)} aria-label="Cancel">
            <CloseIcon fontSize="small" />
          </IconButton>
        </>
      ) : (
        <>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
            {value}
          </Typography>
          {typeof secondary === "string" ? (
            <Chip size="small" variant="outlined" label={secondary} />
          ) : (
            secondary
          )}
          {canManage ? (
            <>
              <Tooltip title="Rename">
                <IconButton size="small" onClick={begin} aria-label={`Rename ${value}`}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {onRemove ? (
                <Tooltip title={removeHint ?? "Remove"}>
                  <span>
                    <IconButton size="small" onClick={onRemove} aria-label={`Remove ${value}`}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Stack>
  );
}
