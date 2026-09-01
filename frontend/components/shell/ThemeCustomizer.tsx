"use client";

import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ComputerIcon from "@mui/icons-material/Computer";
import DarkModeIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeIcon from "@mui/icons-material/LightModeOutlined";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import TuneIcon from "@mui/icons-material/Tune";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, useColorScheme } from "@mui/material/styles";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import {
  ACCENT_PRESETS,
  DENSITY_OPTIONS,
  SIDEBAR_MODES,
  useThemeStore,
  type Density,
  type SidebarMode,
} from "@/lib/store/theme";

/**
 * The floating appearance panel.
 *
 * Every appearance preference in one place: colour mode, accent, sidebar
 * behaviour, density and top-bar treatment. Each writes straight to the
 * persisted store, so a change applies instantly and survives a reload —
 * there is no Save button because there is nothing to save.
 *
 * The launcher is an **edge tab, not a circular FAB**: the chat launcher owns
 * the bottom-right circle, and two floating circles in one corner compete for
 * the same click.
 */
export default function ThemeCustomizer() {
  const [open, setOpen] = useState(false);
  const showAppearanceTab = useThemeStore((state) => state.showAppearanceTab);
  const setShowAppearanceTab = useThemeStore((state) => state.setShowAppearanceTab);

  /**
   * Hydration guard. `useColorScheme` resolves only on the client, so rendering
   * its value on the server pass would mismatch. `useSyncExternalStore` is the
   * SSR-safe way to ask "am I on the client yet" — no effect, no extra render,
   * and no lint rule broken by setting state from one.
   */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const { mode, setMode } = useColorScheme();
  const accentColor = useThemeStore((s) => s.accentColor);
  const setAccentColor = useThemeStore((s) => s.setAccentColor);
  const sidebarMode = useThemeStore((s) => s.sidebarMode);
  const setSidebarMode = useThemeStore((s) => s.setSidebarMode);
  const density = useThemeStore((s) => s.density);
  const setDensity = useThemeStore((s) => s.setDensity);
  const tintedTopBar = useThemeStore((s) => s.tintedTopBar);
  const setTintedTopBar = useThemeStore((s) => s.setTintedTopBar);
  const reset = useThemeStore((s) => s.reset);

  return (
    <>
      {/* A dismiss, because this is pinned to the middle of the right edge of
          every page, over the content. Hiding it strands nothing — everything
          behind it is in Settings → Appearance, including `sidebarMode`, which
          the topbar popover does not carry.

          Right-click rather than a second visible × : the tab is 38px wide and
          a close affordance inside it would be a 12px target sitting on the
          thing it closes. The tooltip says so, and Settings → Appearance can
          bring it back. */}
      {!showAppearanceTab ? null : (
      <Tooltip title="Appearance · right-click to hide" placement="left">
        <Box
          component="button"
          onClick={() => setOpen(true)}
          onContextMenu={(e: React.MouseEvent) => {
            e.preventDefault();
            setShowAppearanceTab(false);
          }}
          aria-label="Open appearance settings"
          className="no-print"
          sx={{
            position: "fixed",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: (t) => t.zIndex.drawer - 1,
            width: 38,
            height: 46,
            border: "none",
            cursor: "pointer",
            display: { xs: "none", sm: "flex" },
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "10px 0 0 10px",
            bgcolor: "primary.main",
            color: "primary.contrastText",
            boxShadow: (t) => `0 4px 16px ${alpha(t.palette.common.black, 0.2)}`,
            transition: (t) => `width ${t.hrms.motion.duration.fast}ms ${t.hrms.motion.easing.standard}`,
            "&:hover": { width: 44 },
          }}
        >
          <TuneIcon fontSize="small" />
        </Box>
      </Tooltip>
      )}

      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 336 } } } }}
      >
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            px: 2.5,
            py: 2,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Appearance
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Saved to this browser as you change it
            </Typography>
          </Box>
          <IconButton onClick={() => setOpen(false)} size="small" aria-label="Close appearance settings">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack spacing={3.5} sx={{ p: 2.5, overflowY: "auto", flex: 1 }}>
          <Section title="Colour mode">
            <Stack direction="row" spacing={1}>
              <Choice selected={mounted && mode === "light"} onClick={() => setMode("light")} icon={<LightModeIcon fontSize="small" />} label="Light" />
              <Choice selected={mounted && mode === "dark"} onClick={() => setMode("dark")} icon={<DarkModeIcon fontSize="small" />} label="Dark" />
              <Choice selected={mounted && mode === "system"} onClick={() => setMode("system")} icon={<ComputerIcon fontSize="small" />} label="System" />
            </Stack>
          </Section>

          <Section title="Accent" hint="Used for primary actions and active states.">
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              {ACCENT_PRESETS.map((preset) => {
                const active = accentColor === preset.value;
                return (
                  <Tooltip key={preset.value} title={preset.name} arrow>
                    <Box
                      component="button"
                      onClick={() => setAccentColor(preset.value)}
                      aria-label={`Accent colour ${preset.name}`}
                      aria-pressed={active}
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        border: "none",
                        bgcolor: preset.value,
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        outline: active ? `2px solid ${preset.value}` : "2px solid transparent",
                        outlineOffset: 2,
                        transition: (t) => `transform ${t.hrms.motion.duration.fast}ms ${t.hrms.motion.easing.standard}`,
                        "&:hover": { transform: "scale(1.12)" },
                      }}
                    >
                      {active && <CheckIcon sx={{ fontSize: 15, color: "common.white" }} />}
                    </Box>
                  </Tooltip>
                );
              })}
            </Stack>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mt: 1.5 }}>
              <Box
                component="input"
                type="color"
                value={accentColor}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAccentColor(e.target.value)}
                aria-label="Custom accent colour"
                sx={{
                  width: 32,
                  height: 32,
                  p: 0,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  bgcolor: "transparent",
                  cursor: "pointer",
                }}
              />
              <Typography variant="caption" color="text.secondary">
                Or pick any colour — shades and label contrast are derived from it.
              </Typography>
            </Stack>
          </Section>

          <Section title="Sidebar">
            <Stack spacing={1}>
              {SIDEBAR_MODES.map((o) => (
                <Option
                  key={o.value}
                  selected={sidebarMode === o.value}
                  onClick={() => setSidebarMode(o.value as SidebarMode)}
                  label={o.label}
                  hint={o.hint}
                />
              ))}
            </Stack>
          </Section>

          <Section title="Density" hint="Row height across tables and lists.">
            <Stack spacing={1}>
              {DENSITY_OPTIONS.map((o) => (
                <Option
                  key={o.value}
                  selected={density === o.value}
                  onClick={() => setDensity(o.value as Density)}
                  label={o.label}
                  hint={o.hint}
                />
              ))}
            </Stack>
          </Section>

          <Section title="Top bar">
            <Stack spacing={1}>
              <Option selected={!tintedTopBar} onClick={() => setTintedTopBar(false)} label="Neutral" hint="Matches the page surface" />
              <Option selected={tintedTopBar} onClick={() => setTintedTopBar(true)} label="Tinted" hint="Washed with your accent colour" />
            </Stack>
          </Section>
        </Stack>

        <Divider />
        <Box sx={{ p: 2.5 }}>
          <Button
            fullWidth
            startIcon={<RestartAltIcon />}
            onClick={() => {
              reset();
              setMode("light");
            }}
          >
            Reset to defaults
          </Button>
        </Box>
      </Drawer>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="overline" sx={{ display: "block", color: "text.secondary" }}>
        {title}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.25 }}>
          {hint}
        </Typography>
      )}
      <Box sx={{ mt: hint ? 0 : 1.25 }}>{children}</Box>
    </Box>
  );
}

function Choice({ selected, onClick, icon, label }: { selected: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      aria-pressed={selected}
      sx={{
        flex: 1,
        font: "inherit",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.5,
        py: 1.25,
        borderRadius: 2,
        border: "1px solid",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: (t) => (selected ? alpha(t.palette.primary.main, 0.08) : "transparent"),
        color: selected ? "primary.main" : "text.secondary",
        fontWeight: 600,
        fontSize: "0.75rem",
        "&:hover": { borderColor: "primary.main" },
      }}
    >
      {icon}
      {label}
    </Box>
  );
}

function Option({ selected, onClick, label, hint }: { selected: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      aria-pressed={selected}
      sx={{
        width: "100%",
        font: "inherit",
        cursor: "pointer",
        textAlign: "left",
        px: 1.5,
        py: 1.25,
        borderRadius: 2,
        border: "1px solid",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: (t) => (selected ? alpha(t.palette.primary.main, 0.08) : "transparent"),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        "&:hover": { borderColor: "primary.main" },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: selected ? "primary.main" : "text.primary" }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      </Box>
      {selected && <CheckIcon fontSize="small" color="primary" />}
    </Box>
  );
}
