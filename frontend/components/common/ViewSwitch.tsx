"use client";

import GridViewIcon from "@mui/icons-material/GridView";
import TableRowsIcon from "@mui/icons-material/TableRows";
import ViewListIcon from "@mui/icons-material/ViewList";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import { useCallback } from "react";

import { useStoredPreference } from "@/hooks/useStoredPreference";

export type ViewMode = "cards" | "list" | "table";

const MODES: { value: ViewMode; label: string; hint: string; icon: typeof GridViewIcon }[] = [
  { value: "cards", label: "Cards", hint: "One card per row — good for scanning a few things", icon: GridViewIcon },
  { value: "list", label: "List", hint: "Compact rows — good for reading many at once", icon: ViewListIcon },
  { value: "table", label: "Table", hint: "Every column, sortable — good for comparing", icon: TableRowsIcon },
];

/**
 * Cards, list or table — and the choice sticks.
 *
 * **Why it is remembered per screen rather than globally.** The right view is a
 * property of the work, not of the person: somebody who wants payroll as a
 * dense sortable table still wants the client desk as cards, because one is
 * being compared and the other is being triaged. A single global preference
 * makes half their screens wrong whichever way they set it.
 *
 * **Why `localStorage` and not the server.** This is a display preference with
 * no consequences — a wrong value costs one click, and storing it server-side
 * means a write on every toggle and a round trip before the first render, so
 * the list would visibly reflow after it loaded. It is deliberately *not* in
 * the URL either: a shared link should carry the filter, which is about which
 * rows, not the chrome, which is about taste.
 */
export function useViewMode(storageKey: string, fallback: ViewMode = "table") {
  // A stored string is only a view mode if it is one of the three. Anything
  // else — an old format, a hand-edited key — is rejected and the screen's own
  // fallback stands, rather than rendering a mode no branch handles.
  const parse = useCallback(
    (raw: string): ViewMode | null =>
      raw === "cards" || raw === "list" || raw === "table" ? raw : null,
    []
  );
  const [mode, setMode] = useStoredPreference<ViewMode>(`view:${storageKey}`, fallback, parse);

  return { mode, setMode };
}

export default function ViewSwitch({
  value,
  onChange,
  /** Drop a mode a screen genuinely cannot render. */
  modes = ["cards", "list", "table"],
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  modes?: ViewMode[];
}) {
  const shown = MODES.filter((m) => modes.includes(m.value));
  if (shown.length < 2) return null;

  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      // `null` arrives when the active button is clicked again. Ignoring it
      // keeps a view always selected — a list with no view is nothing.
      onChange={(_, next: ViewMode | null) => next && onChange(next)}
      aria-label="View"
    >
      {shown.map(({ value: mode, label, hint, icon: Icon }) => (
        <Tooltip key={mode} title={hint}>
          <ToggleButton value={mode} aria-label={label} sx={{ px: 1.25 }}>
            <Icon fontSize="small" />
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}
