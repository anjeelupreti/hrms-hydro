"use client";

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import InputBase from "@mui/material/InputBase";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { visibleGroups, type NavItem } from "@/lib/nav";
import { useMe } from "@/hooks/useMe";
import { useUIStore } from "@/lib/store/ui";
import { MODULE_HUE } from "@/lib/theme/tokens";

/**
 * ⌘K / Ctrl-K navigation.
 *
 * Reads the same model as the sidebar, so anything reachable by clicking is
 * reachable by typing. Matching is over the label, the group and the item's
 * `keywords`, which is why "salary" finds Payroll and "hiring" finds
 * Recruitment — people search for the word they use, not the one we chose.
 */
export default function CommandPalette() {
  const router = useRouter();
  const { data: me } = useMe();
  const open = useUIStore((s) => s.paletteOpen);
  const setOpen = useUIStore((s) => s.setPaletteOpen);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Joined to a string so the memo below has a stable dependency — an array
  // identity changes on every render of `useMe` and would rebuild the list
  // on each keystroke for no reason.
  const permissionKey = (me?.permissions ?? []).join(",");

  const results = useMemo(() => {
    // The palette and the sidebar read the same function, so a route can never
    // be searchable from one and hidden in the other.
    const groups = visibleGroups(permissionKey ? permissionKey.split(",") : []);
    const flat = groups.flatMap((g) => g.items.map((item) => ({ item, group: g.label })));
    const q = query.trim().toLowerCase();
    if (!q) return flat;

    const terms = q.split(/\s+/).filter(Boolean);
    return flat
      .map((entry) => {
        const haystack = [entry.item.label, entry.group, ...(entry.item.keywords ?? [])]
          .join(" ")
          .toLowerCase();
        if (!terms.every((t) => haystack.includes(t))) return null;
        // A label match beats a keyword match, so typing "leave" puts Leave
        // above Onboarding (which merely mentions leavers).
        const rank = entry.item.label.toLowerCase().startsWith(q) ? 0 : haystack.indexOf(q);
        return { ...entry, rank };
      })
      .filter((x): x is { item: NavItem; group: string; rank: number } => x !== null)
      .sort((a, b) => a.rank - b.rank);
  }, [query, permissionKey]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, [setOpen]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  // Global shortcut. Ignored while typing in a field, so ⌘K inside a search box
  // does not hijack what the browser or the page would otherwise do.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && results[cursor]) {
      e.preventDefault();
      go(results[cursor].item.href);
    } else if (e.key === "Escape") {
      close();
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { position: "fixed", top: 88, m: 0, borderRadius: 3 } } }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}
      >
        <SearchIcon fontSize="small" color="disabled" />
        <InputBase
          autoFocus
          fullWidth
          placeholder="Search modules…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Reset the highlight here rather than in an effect keyed on
            // `query` — an effect would cascade a second render on every
            // keystroke to do work the event already knows about.
            setCursor(0);
          }}
          onKeyDown={onInputKeyDown}
          sx={{ fontSize: "0.9375rem" }}
          inputProps={{ "aria-label": "Search modules" }}
        />
        <Kbd>esc</Kbd>
      </Stack>

      <Box ref={listRef} sx={{ maxHeight: 380, overflowY: "auto", py: 1 }}>
        {results.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, py: 3, textAlign: "center" }}>
            Nothing matches “{query}”.
          </Typography>
        ) : (
          results.map((entry, i) => {
            const Icon = entry.item.icon;
            const hue = MODULE_HUE[entry.item.module];
            const selected = i === cursor;
            return (
              <Box
                key={entry.item.href}
                component="button"
                onClick={() => go(entry.item.href)}
                onMouseEnter={() => setCursor(i)}
                sx={{
                  width: "100%",
                  font: "inherit",
                  cursor: "pointer",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 2,
                  py: 1,
                  textAlign: "left",
                  bgcolor: selected ? "action.selected" : "transparent",
                }}
              >
                <Box
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: 1.5,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: alpha(hue, 0.14),
                    color: hue,
                  }}
                >
                  <Icon sx={{ fontSize: 18 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                    {entry.item.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                    {entry.group}
                  </Typography>
                </Box>
                {selected && <ArrowForwardIcon fontSize="small" color="disabled" />}
              </Box>
            );
          })
        )}
      </Box>

      <Stack
        direction="row"
        spacing={2}
        sx={{ px: 2, py: 1, borderTop: "1px solid", borderColor: "divider", color: "text.disabled" }}
      >
        <Hint keys={["↑", "↓"]} label="navigate" />
        <Hint keys={["↵"]} label="open" />
      </Stack>
    </Dialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="kbd"
      sx={{
        px: 0.75,
        py: 0.25,
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.default",
        fontFamily: "inherit",
        fontSize: "0.6875rem",
        color: "text.secondary",
        lineHeight: 1.6,
      }}
    >
      {children}
    </Box>
  );
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
}
