"use client";

import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";

/**
 * The two pieces every archivable list needs, so seven pages do not each
 * invent them.
 *
 * The backend got archiving from one mixin, and the front of it should match:
 * the same two words, the same two icons, the same place on the row. A page
 * that called it "Hide" or put the control in an overflow menu would make one
 * behaviour look like several.
 *
 * **Archive is not delete, and the labels have to carry that** — "File it
 * away" and "Put it back", not "Remove". Deleting an announcement destroys the
 * record that it was ever posted; archiving keeps it and takes it out of the
 * way. Somebody choosing between two icons has one moment to tell them apart.
 */

export function ArchiveTabs({
  archived,
  onChange,
  liveLabel = "Current",
}: {
  archived: boolean;
  onChange: (archived: boolean) => void;
  /** What the live list is called here — "Current", "Open roles", "Checklists". */
  liveLabel?: string;
}) {
  return (
    <Tabs value={archived ? 1 : 0} onChange={(_e, v) => onChange(v === 1)} sx={{ mb: 2 }}>
      <Tab label={liveLabel} />
      <Tab label="Archived" />
    </Tabs>
  );
}

export function ArchiveButton({
  archived,
  onToggle,
  noun = "item",
  size = "small",
}: {
  archived: boolean;
  onToggle: () => void;
  /** Named in the tooltip, so the action says what it acts on. */
  noun?: string;
  size?: "small" | "medium";
}) {
  return (
    <Tooltip title={archived ? `Put this ${noun} back` : `File this ${noun} away`}>
      <IconButton
        size={size}
        aria-label={archived ? `Restore ${noun}` : `Archive ${noun}`}
        onClick={(event) => {
          // These sit on cards and rows that navigate when clicked; filing
          // something away must not also open it.
          event.stopPropagation();
          onToggle();
        }}
      >
        {archived ? <UnarchiveIcon fontSize={size} /> : <ArchiveIcon fontSize={size} />}
      </IconButton>
    </Tooltip>
  );
}
