import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The accents on offer.
 *
 * **Vivid, because `deriveShades` separates the fill from the ink.** A single
 * accent value cannot serve as both a button fill and link text: text needs
 * 4.5:1 against the page, so any hue with high intrinsic luminance is
 * unofferable — cyan measures 3.41 against the light ground, tangerine 3.30.
 * Chroma cannot fix that; they are light colours.
 *
 * `deriveShades` adjusts lightness per scheme and keeps the hue and saturation
 * as picked, so a bright accent stays bright and becomes readable rather than
 * being left out for being bright.
 *
 * Grouped by family so the picker reads as a palette rather than a bag of
 * swatches — and so two greens sit next to each other instead of either side
 * of a pink.
 */
export const ACCENT_PRESETS = [
  // Blues and violets — the default family.
  { name: "Indigo", value: "#4f46e5" },
  { name: "Electric", value: "#4338ca" },
  { name: "Cobalt", value: "#1d4ed8" },
  { name: "Azure", value: "#0ea5e9" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Teal", value: "#14b8a6" },

  // Greens.
  { name: "Emerald", value: "#10b981" },
  { name: "Jade", value: "#00a86b" },
  { name: "Lime", value: "#84cc16" },

  // Warms.
  { name: "Amber", value: "#f59e0b" },
  { name: "Tangerine", value: "#f97316" },
  { name: "Coral", value: "#fb7185" },
  { name: "Crimson", value: "#e11d48" },

  // Purples and pinks.
  { name: "Violet", value: "#8b5cf6" },
  { name: "Plum", value: "#a855f7" },
  { name: "Magenta", value: "#d946ef" },
  { name: "Hot pink", value: "#ec4899" },

  // The quiet one. Somebody running payroll all day may not want a colour at
  // all, and taking that option away is not a favour.
  { name: "Slate", value: "#64748b" },
] as const;

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].value;

/**
 * Row height and padding across tables, lists and controls. `compact` is for
 * someone working a payroll month in one sitting who wants more rows per
 * screen. Read by `buildTheme` — see `lib/theme/tokens.ts`.
 */
export type Density = "comfortable" | "compact";

/**
 * How the desktop sidebar behaves.
 *
 *   default — full width, always open
 *   compact — icon rail, always collapsed
 *   hover   — icon rail that expands under the pointer *without* pushing the
 *             page, so nothing reflows mid-read
 *
 * This lives here rather than in the UI store because it is an appearance
 * preference that must survive a reload, and because two sources of truth for
 * "is the sidebar collapsed" is how they drift apart.
 */
export type SidebarMode = "default" | "compact" | "hover" | "detached";

export const SIDEBAR_MODES: { value: SidebarMode; label: string; hint: string }[] = [
  { value: "default", label: "Default", hint: "Full sidebar, always open" },
  { value: "compact", label: "Compact", hint: "Icon rail, more room for content" },
  { value: "hover", label: "Hover", hint: "Icon rail that opens on hover" },
  // Full width like Default — the difference is that it floats. The other
  // three all sit flush against the window edge; this one is inset with a
  // rounded card and the page ground visible around it, which is a different
  // *look* rather than a different amount of room.
  { value: "detached", label: "Detached", hint: "Floating panel, inset from the edges" },
];

export const DENSITY_OPTIONS: { value: Density; label: string; hint: string }[] = [
  { value: "comfortable", label: "Comfortable", hint: "Roomier rows" },
  { value: "compact", label: "Compact", hint: "More rows per screen" },
];

type ThemeState = {
  accentColor: string;
  density: Density;
  sidebarMode: SidebarMode;
  /**
   * Whether the appearance tab is stuck to the right edge of every page.
   *
   * Whether the appearance edge-tab is shown. Persisted, because "I closed
   * this" that comes back on the next page load is not a dismiss.
   *
   * Safe to hide: everything behind it is also in Settings → Appearance,
   * including `sidebarMode`, which the topbar popover does not carry.
   */
  showAppearanceTab: boolean;
  tintedTopBar: boolean;
  setAccentColor: (color: string) => void;
  setDensity: (density: Density) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  setShowAppearanceTab: (show: boolean) => void;
  setTintedTopBar: (tinted: boolean) => void;
  reset: () => void;
};

const DEFAULTS = {
  accentColor: DEFAULT_ACCENT,
  density: "comfortable" as Density,
  sidebarMode: "default" as SidebarMode,
  showAppearanceTab: true,
  tintedTopBar: false,
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setAccentColor: (color) => set({ accentColor: color }),
      setDensity: (density) => set({ density }),
      setSidebarMode: (sidebarMode) => set({ sidebarMode }),
      setShowAppearanceTab: (showAppearanceTab: boolean) => set({ showAppearanceTab }),
      setTintedTopBar: (tintedTopBar) => set({ tintedTopBar }),
      reset: () => set(DEFAULTS),
    }),
    {
      name: "hrms-theme-accent",
      // Bumped when the shape grew from accent-only. Persisted values are
      // merged over the defaults rather than discarded, so nobody loses the
      // accent they had already chosen.
      version: 1,
      migrate: (persisted) => ({ ...DEFAULTS, ...(persisted as Partial<ThemeState>) }),
    }
  )
);
