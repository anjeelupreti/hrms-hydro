/**
 * Design tokens — the single source of every value the interface is built from.
 *
 * Nothing in `app/` or `components/` should contain a raw hex, a magic pixel
 * value, or a hand-picked shadow. If a value is needed and it is not here, the
 * question to ask is which token it *should* be, not what number looks right
 * on this one screen. That rule is what keeps 58 pages looking like one
 * product instead of 58 opinions.
 *
 * Read alongside `docs/development-plan.md` Part 2.
 */

// ---------------------------------------------------------------------------
// Spacing — a 4px base. `theme.spacing(n)` returns n * 4px.
// ---------------------------------------------------------------------------

export const SPACING_UNIT = 4;

/**
 * Named steps for the places a bare number reads badly. These are *multipliers*
 * for `theme.spacing`, not pixel values, so they scale with the base unit.
 */
export const SPACE = {
  none: 0,
  hair: 0.5, //  2px — icon-to-label
  tight: 1, //   4px — inside a chip
  snug: 1.5, //  6px — dense row padding
  base: 2, //    8px — the default gap
  cosy: 3, //   12px — inside a card
  roomy: 4, //  16px — between cards
  section: 6, // 24px — between sections
  page: 8, //   32px — page gutters at desktop
} as const;

// ---------------------------------------------------------------------------
// Radius — four steps. Nothing may be rounder than the element containing it.
// ---------------------------------------------------------------------------

/**
 * `sx={{ borderRadius: n }}` multiplies by `shape.borderRadius`, so the base
 * below is the *unit*, not a default. At 3 the multipliers land on the scale:
 * 1→3, 2→6 (sm), 3→9, 4→12 (xl). It was 12 originally — which turned every
 * `borderRadius: 2` into 24px and left the app mixing thirteen different
 * corner radii — then 4, and now 3, so the multiplier tracks the tightened
 * scale below rather than drifting away from it.
 */
export const RADIUS_UNIT = 3;

/**
 * A shallow scale, deliberately. Past roughly 12px on a card or 22px on a
 * dialog the radius stops reading as a finish and becomes a shape of its own,
 * and every surface looks softer and less exact than it is.
 *
 * Kept as a *scale* — the relationship
 * between a chip and a dialog is still the same, everything is simply less
 * round. `pill` is untouched because a pill is a deliberate form, not a corner:
 * progress bars and status dots are meant to be capsules.
 */
export const RADIUS = {
  xs: 4, //   chips, small buttons
  sm: 6, //   buttons, inputs
  md: 8, //   cards, menus
  lg: 10, //  panels, data grids
  xl: 14, //  dialogs, drawers
  pill: 999,
} as const;

// ---------------------------------------------------------------------------
// Elevation — soft and slightly cool, never MUI's default grey haze.
//
// Dark mode gets its own set: the same shadows on a near-black page are
// invisible, so depth there comes from a lifted surface plus a faint ring
// rather than from a drop shadow doing all the work.
// ---------------------------------------------------------------------------

export const ELEVATION = {
  light: {
    0: "none",
    1: "0 1px 2px rgba(15,23,42,0.05)",
    2: "0 2px 6px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
    3: "0 8px 24px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04)",
    4: "0 20px 48px rgba(15,23,42,0.14), 0 4px 12px rgba(15,23,42,0.06)",
  },
  dark: {
    0: "none",
    1: "0 1px 2px rgba(0,0,0,0.4)",
    2: "0 2px 8px rgba(0,0,0,0.45)",
    3: "0 10px 28px rgba(0,0,0,0.55)",
    4: "0 24px 56px rgba(0,0,0,0.65)",
  },
} as const;

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export const MOTION = {
  duration: {
    instant: 90,
    fast: 150,
    normal: 220,
    slow: 340,
  },
  easing: {
    /** Default for anything that moves between two resting states. */
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    /** Entering the screen — decelerates in. */
    entrance: "cubic-bezier(0.05, 0.7, 0.1, 1)",
    /** Leaving — accelerates out, shorter than it came in. */
    exit: "cubic-bezier(0.3, 0, 0.8, 0.15)",
  },
  /** For `motion/react` springs — selection pills, drag, count-ups. */
  spring: { type: "spring", stiffness: 400, damping: 34 },
} as const;

// ---------------------------------------------------------------------------
// Surfaces — page → card → raised → overlay.
//
// The step between `page` and `card` is the one that matters most: when they
// were equal (both #09090b) every card dissolved into the background and dark
// mode read as one flat sheet.
// ---------------------------------------------------------------------------

export const SURFACE = {
  light: {
    page: "#f5f6fa",
    card: "#ffffff",
    raised: "#ffffff",
    overlay: "#ffffff",
    sunken: "#eef0f6",
    border: "#e4e7f0",
    borderStrong: "#cfd4e2",
  },
  dark: {
    page: "#08080b",
    card: "#131318",
    raised: "#1a1a21",
    overlay: "#1c1c24",
    sunken: "#0d0d11",
    border: "rgba(255,255,255,0.09)",
    borderStrong: "rgba(255,255,255,0.18)",
  },
} as const;

export const INK = {
  light: { primary: "#0f172a", secondary: "#5b6478", disabled: "#98a1b3" },
  dark: { primary: "#f5f6f8", secondary: "#a1a7b5", disabled: "#6b7280" },
} as const;

// ---------------------------------------------------------------------------
// Status — every state needs three values, not one.
//
// `fg` is text/icon, `bg` is the tinted fill behind it, `border` is the
// hairline. A counter tile, a chip, a table cell and a timeline block all
// draw from the same triplet, which is what makes a board readable at a
// glance instead of a grey row.
// ---------------------------------------------------------------------------

export type StatusKey = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

export const STATUS = {
  light: {
    success: { fg: "#15803d", bg: "#e7f8ee", border: "#b6e7ca", solid: "#16a34a" },
    warning: { fg: "#b45309", bg: "#fef4e2", border: "#f6dba5", solid: "#e08700" },
    danger: { fg: "#b91c1c", bg: "#fdeceb", border: "#f6c3c0", solid: "#dc2626" },
    info: { fg: "#0369a1", bg: "#e7f4fd", border: "#b5ddf6", solid: "#0284c7" },
    neutral: { fg: "#4b5468", bg: "#f0f2f7", border: "#dde1eb", solid: "#64748b" },
    accent: { fg: "#6d28d9", bg: "#f2ecfe", border: "#d9c8fb", solid: "#7c3aed" },
  },
  dark: {
    success: { fg: "#5ee497", bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.30)", solid: "#22c55e" },
    warning: { fg: "#fbbf24", bg: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.30)", solid: "#f59e0b" },
    danger: { fg: "#fb7185", bg: "rgba(239,68,68,0.14)", border: "rgba(239,68,68,0.32)", solid: "#ef4444" },
    info: { fg: "#5cc3f7", bg: "rgba(14,165,233,0.14)", border: "rgba(14,165,233,0.30)", solid: "#0ea5e9" },
    neutral: { fg: "#aab2c2", bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.26)", solid: "#94a3b8" },
    accent: { fg: "#c4a6fd", bg: "rgba(139,92,246,0.16)", border: "rgba(139,92,246,0.32)", solid: "#8b5cf6" },
  },
} as const;

// ---------------------------------------------------------------------------
// Module hues — a fixed identity per area of the product.
//
// Deliberately independent of the accent: the accent is the company preference
// and may be any hue, so navigation and module iconography cannot depend on
// it. These give the sidebar and icon tiles their colour without touching the
// one job the accent has (primary action, active state).
// ---------------------------------------------------------------------------

export const MODULE_HUE = {
  dashboard: "#6366f1",
  employees: "#0ea5e9",
  attendance: "#14b8a6",
  leave: "#f59e0b",
  payroll: "#22c55e",
  recruitment: "#ec4899",
  performance: "#8b5cf6",
  training: "#06b6d4",
  assets: "#f97316",
  helpdesk: "#ef4444",
  documents: "#64748b",
  crm: "#3b82f6",
  projects: "#2563eb",
  collaboration: "#a855f7",
  settings: "#78716c",
} as const;

export type ModuleKey = keyof typeof MODULE_HUE;

// ---------------------------------------------------------------------------
// Domain hues — states that are neither a module nor a generic status.
//
// These were duplicated as raw hex in the attendance page, the attendance
// calendar grid and the calendar page, which is how three surfaces end up
// disagreeing about what "late" looks like. Solid mid-tones, chosen to hold
// up on both light and dark surfaces without a per-scheme variant.
// ---------------------------------------------------------------------------

export const ATTENDANCE_HUE = {
  present: "#22c55e",
  late: "#f59e0b",
  absent: "#ef4444",
  half_day: "#94a3b8",
  on_leave: "#3b82f6",
  holiday: "#8b5cf6",
} as const;

/**
 * Decorative gradients — profile covers, celebration cards, the hero ground.
 *
 * Same reasoning as the hues above: the profile cover gradient was copy-pasted
 * into four files, so changing it meant finding all four. `heroGround` is the
 * dark base a HeroPanel washes its module hue over; it stays dark in both
 * schemes because on a light page the contrast is what makes it the focal
 * point, and on a dark page a light panel would glare.
 */
export const GRADIENT = {
  profileCover: "linear-gradient(120deg, #4f46e5, #7c3aed 60%, #f97316)",
  celebration: "linear-gradient(135deg, #7c3aed, #ec4899)",
  brand: "linear-gradient(120deg, #4f46e5, #7c3aed)",
  // Follows the colour scheme. A dark ground in both schemes reads as a black
  // slab ignoring the theme on a light page — and the panel does not need it:
  // its focal weight comes from the module hue washed across it and from its
  // elevation, neither of which fights the page.
  heroGround: { light: "#eef0f6", dark: "#0c0c11" },
} as const;

export const EVENT_HUE = {
  meeting: "#4f46e5",
  interview: "#0891b2",
  announcement: "#f59e0b",
  holiday: "#8b5cf6",
  leave: "#3b82f6",
  other: "#64748b",
} as const;

// ---------------------------------------------------------------------------
// Data visualisation
//
// Categorical order matters: the first four must stay distinguishable in
// greyscale and to the most common colour-vision deficiencies, because that is
// what most charts actually use. Colour is never the only carrier of meaning —
// every series also needs a label, a shape, or a direct annotation.
// ---------------------------------------------------------------------------

// Every hex below is the output of the dataviz validator, not a choice of
// taste. The previous set failed four of its six checks: #e0b000 sat outside
// the lightness band, #7a869a was so low-chroma it read as grey, and
// slate↔cyan were ΔE 4.0 apart under deuteranopia and only 10.2 apart under
// *normal* vision — two series nobody could reliably tell apart.
//
// The ORDER is part of the data, not decoration. Adjacent slots are what the
// checker separates, so green sits away from pink (red-green CVD collapses
// that pair to ΔE 1.1). Assign in this order and never cycle: a ninth series
// folds into "Other" or becomes small multiples.
//
// Dark is *stepped*, not flipped. Its band is L 0.48–0.67, narrower and
// darker than light's — only the blue needed lifting, because #1d4ed8 hit
// 2.6:1 against a dark surface.
export const DATA_PALETTE = {
  categorical: [
    "#1d4ed8", // blue
    "#ea580c", // orange
    "#7c3aed", // violet
    "#059669", // green
    "#a16207", // amber
    "#db2777", // pink
    "#0891b2", // cyan
    "#4d7c0f", // olive
  ],
  /** Same hues, re-stepped for a dark surface. */
  categoricalDark: [
    "#3b82f6", // blue — lifted; the light step failed contrast here
    "#ea580c",
    "#7c3aed",
    "#059669",
    "#a16207",
    "#db2777",
    "#0891b2",
    "#4d7c0f",
  ],
  /** Low → high of a single measure. */
  sequential: ["#e8effd", "#c2d6fb", "#94b6f7", "#6693f2", "#4070e0", "#2b50b4"],
  /** Below target ← neutral → above target. */
  diverging: ["#c2412f", "#e08466", "#f0c3b2", "#e6e8ec", "#a9cfc2", "#5fa88f", "#1f7a5c"],
} as const;

// ---------------------------------------------------------------------------
// Density — row height and padding, switchable per user.
//
// `compact` is for someone working a payroll month in one sitting who wants
// more rows per screen; `comfortable` is the default. The numbers are chosen
// so compact fits ~40% more rows in the same viewport.
// ---------------------------------------------------------------------------

export type Density = "comfortable" | "compact";

export const DENSITY = {
  comfortable: {
    rowHeight: 52,
    headerHeight: 48,
    cellPaddingY: 12,
    cellPaddingX: 16,
    listItemPaddingY: 10,
    controlHeight: 40,
    cardPadding: 20,
    pageGutterX: 4, // spacing multiplier → 16px
    pageGutterY: 3.5,
  },
  compact: {
    rowHeight: 38,
    headerHeight: 38,
    cellPaddingY: 6,
    cellPaddingX: 12,
    listItemPaddingY: 5,
    controlHeight: 34,
    cardPadding: 14,
    pageGutterX: 3, // spacing multiplier → 12px
    pageGutterY: 2.5,
  },
} as const;

// ---------------------------------------------------------------------------
// Typography scale
//
// One place where every size, weight, line-height and tracking is decided.
// `mono` exists for anything that names a real system part (a component code,
// an employee code, a device serial) and for money, which uses tabular
// figures so columns of numbers line up on the decimal.
// ---------------------------------------------------------------------------

export const FONT = {
  sans: "var(--font-sans), Inter, Roboto, Helvetica, Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

/** Applied to any element rendering an amount, so digits are equal-width. */
export const TABULAR_NUMS = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1',
} as const;

/**
 * A large standalone figure — a hero number, a stat tile, a donut centre.
 *
 * **Deliberately *not* tabular.** Equal-width digits exist so that numbers
 * stacked in a column line up; on a single 2.75rem figure they do the opposite
 * of their job, because the `1` is padded to the width of an `8` and `121`
 * comes out visibly loose and gappy. Every one of these was wearing
 * `.hrms-num`, which is the right class for a table cell and the wrong one for
 * a headline.
 *
 * Proportional figures for display, tabular for anything that aligns
 * vertically. The two are separate classes because the distinction is about
 * *where the number sits*, not how big it is, and a size threshold would get it
 * wrong in both directions.
 */
export const DISPLAY_NUMS = {
  fontVariantNumeric: "proportional-nums",
  fontFeatureSettings: '"tnum" 0',
} as const;

// ---------------------------------------------------------------------------
// Derived palettes — everything coloured, from the one colour the user chose.
//
// **The problem this fixes.** `buildTheme` derived `primary.light/dark` from
// the chosen accent and stopped there. `DATA_PALETTE.categorical` was eight
// fixed hues and `MODULE_HUE` was fourteen more, both written as literals and
// imported directly, so they never saw the accent at all. The system set to
// Emerald still got blue-and-orange charts and a violet Performance module:
// three colour systems on one screen, none of them related, and an accent
// picker that visibly did nothing outside buttons and links.
//
// **The rule.** Where several colours are needed, use shades of the chosen one
// rather than unrelated hues.
//
// **The tradeoff, stated rather than hidden.** Steps of a single hue are
// harder to tell apart than distinct hues — that is a real cost, not a
// quibble. It is mitigated by moving lightness *and* saturation together, and
// by ordering the series so adjacent entries alternate light and dark instead
// of walking a smooth ramp where neighbours look identical. Past about six
// series a chart should be aggregating rather than adding colours, and
// `SERIES_HONEST_LIMIT` records that so nobody quietly relies on eight.
// ---------------------------------------------------------------------------

type Hsl = { h: number; s: number; l: number };

function hexToHsl(hex: string): Hsl {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hsl({ h, s, l }: Hsl): string {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return `hsl(${((h % 360) + 360) % 360} ${clamp(s, 0, 100).toFixed(1)}% ${clamp(l, 0, 100).toFixed(1)}%)`;
}

/**
 * WCAG relative luminance of an HSL triple, and the contrast between two.
 *
 * Needed because a lightness band cannot be judged in the abstract: the same
 * 50% lightness is a mid indigo and a bright amber, and only one of them can be
 * seen on a near-black chart. Measuring is the only way a derived palette can
 * be correct for an accent nobody has picked yet.
 */
function relativeLuminance({ h, s, l }: Hsl): number {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const channel = (n: number) =>
    lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(channel(0)) + 0.7152 * lin(channel(8)) + 0.0722 * lin(channel(4));
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 1.4.11: a graphical object carrying meaning needs 3:1. A chart series
 *  is exactly that — if two bars cannot be told from the background, the chart
 *  is decoration. */
const GRAPHIC_CONTRAST = 3;

/**
 * Nudge a colour's lightness until it clears the threshold against its ground.
 *
 * Walks *away* from the background: lighter on a dark scheme, darker on a
 * light one. Gives up at the end of the range rather than looping, because a
 * fully saturated yellow on white cannot reach 3:1 at any lightness and
 * returning the best available beats returning nothing.
 */
function withContrast(colour: Hsl, groundLuminance: number, goLighter: boolean): Hsl {
  let out = colour;
  for (let i = 0; i < 60; i += 1) {
    if (contrast(relativeLuminance(out), groundLuminance) >= GRAPHIC_CONTRAST) return out;
    const next = out.l + (goLighter ? 1 : -1);
    if (next > 96 || next < 6) return out;
    out = { ...out, l: next };
  }
  return out;
}

/** The grounds a series is actually drawn on — paper white, and the near-black
 *  the dark scheme uses. Kept here so the check and the surface cannot drift. */
const GROUND = {
  light: relativeLuminance({ h: 0, s: 0, l: 100 }),
  dark: relativeLuminance({ h: 0, s: 0, l: 7 }),
};

/** Beyond this, add a colour and you have added confusion — aggregate instead. */
export const SERIES_HONEST_LIMIT = 6;

/**
 * Categorical chart series, as shades of the accent.
 *
 * Lightness alternates high/low rather than stepping smoothly, so neighbouring
 * series in a legend are the pair most easily told apart. Saturation falls as
 * lightness rises, which keeps the pale steps from going chalky and the dark
 * ones from going muddy.
 */
export const SERIES_COUNT = 8;

export function deriveSeries(accent: string, scheme: "light" | "dark"): string[] {
  const base = hexToHsl(accent);

  // **A band, not an open-ended ramp.** The first version stepped outward from
  // a centre by a growing offset, which is fine for four series and then walks
  // off the end: series six landed at 8% lightness and series eight at 0% —
  // black, whatever hue was chosen. Distributing across a fixed usable band
  // cannot do that however many series are asked for.
  //
  // The band differs by scheme because the constraint does: on white the pale
  // end stops being visible, on near-black the dark end does.
  const [lo, hi] = scheme === "dark" ? [40, 78] : [26, 70];

  const steps = Array.from(
    { length: SERIES_COUNT },
    (_, i) => lo + ((hi - lo) * i) / (SERIES_COUNT - 1)
  );

  // Read out from alternating ends rather than in order, so series 1 and 2 —
  // the pair a two-series chart uses, and the pair sitting adjacent in every
  // legend — are the furthest apart rather than one step apart.
  const order: number[] = [];
  for (let i = 0; i < Math.ceil(SERIES_COUNT / 2); i += 1) {
    order.push(i);
    const mirror = SERIES_COUNT - 1 - i;
    if (mirror !== i) order.push(mirror);
  }

  return order.map((index, position) => {
    const candidate = {
      h: base.h,
      // Saturation eases off along the sequence so the pale end does not go
      // chalky and the dark end does not go muddy — both failure modes of a
      // single-hue ramp.
      s: Math.max(28, base.s - position * 4),
      l: steps[index],
    };
    // **Measured, not assumed.** A band picked by eye is only right for the
    // accent it was picked against: reading the served variables showed three
    // dark-scheme steps at 1.72:1, 2.01:1 and 2.45:1 on near-black, all below
    // the 3:1 a chart mark needs. And a band that works for indigo still fails
    // for amber, whose luminance at the same lightness is far higher. So each
    // step is pushed away from its own ground until it clears the threshold.
    return hsl(
      withContrast(candidate, scheme === "dark" ? GROUND.dark : GROUND.light, scheme === "dark")
    );
  });
}

/**
 * Module accents, as shades of the same colour.
 *
 * Fourteen modules cannot be fourteen readable steps of one hue, so this
 * spreads them across lightness *and* a deliberately narrow ±18° of hue —
 * wide enough to separate Payroll from Leave at a glance, narrow enough that
 * the sidebar still reads as one palette rather than a paint chart.
 */
export function deriveModuleHues(accent: string): Record<ModuleKey, string> {
  const base = hexToHsl(accent);
  const keys = Object.keys(MODULE_HUE) as ModuleKey[];
  const out = {} as Record<ModuleKey, string>;
  keys.forEach((key, i) => {
    const spread = keys.length > 1 ? i / (keys.length - 1) : 0; // 0 → 1
    out[key] = hsl({
      h: base.h + (spread - 0.5) * 36,
      s: Math.max(24, base.s - 10 + Math.sin(spread * Math.PI) * 14),
      l: 42 + Math.sin(spread * Math.PI * 2) * 12,
    });
  });
  return out;
}

/**
 * The secondary role, and the decorative gradients, as shades of the accent.
 *
 * **Why these were the last things still disagreeing.** `secondary` was
 * `#f97316` — a fixed orange — so every avatar and chip painted with
 * `secondary.light` came out orange on an indigo workspace, on an emerald one,
 * on all of them. The dashboard's birthday and leave widgets are the visible
 * case: five people, five identical orange discs, next to a violet-to-pink
 * celebration gradient, on a page whose accent is neither.
 *
 * Secondary is offset by 42° rather than being a second lightness of the
 * primary. It has to be *distinguishable* from primary — that is the whole
 * point of a second role — while still reading as chosen alongside it. Far
 * enough to separate, near enough to belong; a full complement at 180° would
 * be the "multiple colours" this is meant to end.
 */
export function deriveSecondary(accent: string, scheme: "light" | "dark") {
  const base = hexToHsl(accent);
  const h = base.h + 42;
  const s = Math.max(45, Math.min(85, base.s));
  const l = scheme === "dark" ? 62 : 48;
  return {
    main: hsl({ h, s, l }),
    light: hsl({ h, s: s - 8, l: l + 14 }),
    dark: hsl({ h, s: s + 4, l: l - 16 }),
    // Chosen against the mid step rather than assumed: a light accent needs
    // dark text on it, and guessing white here is how a chip label vanishes.
    contrastText:
      contrast(relativeLuminance({ h, s, l }), GROUND.light) >= 4.5 ? "#ffffff" : "#0f172a",
  };
}

/**
 * Decorative gradients, built from the accent and its secondary.
 *
 * The gradient travels in lightness and saturation, with the hue barely
 * moving. A fixed hue rotation is not a fixed *relationship*: +48° from indigo
 * stays inside purple and reads as one colour with depth, while +48° from amber
 * lands in green and puts three colour families in one band.
 *
 * A
 * gradient makes a surface feel lit; it does not have to change colour to do
 * that, and one that does is only safe for the accent it was eyeballed against.
 * 14° is wide enough to keep the band from looking flat and narrow enough that
 * no starting hue can cross into a neighbouring family.
 */
export function deriveGradients(accent: string) {
  const base = hexToHsl(accent);
  const at = (dh: number, ds: number, dl: number) =>
    hsl({ h: base.h + dh, s: base.s + ds, l: base.l + dl });
  return {
    profileCover: `linear-gradient(120deg, ${at(-6, 4, -8)}, ${at(4, 0, 2)} 60%, ${at(14, -6, 12)})`,
    celebration: `linear-gradient(135deg, ${at(-4, 6, -6)}, ${at(12, -4, 10)})`,
    brand: `linear-gradient(120deg, ${at(0, 2, -2)}, ${at(10, -2, 8)})`,
    heroGround: GRADIENT.heroGround,
  };
}

/**
 * A colour at partial opacity, safe on a CSS variable.
 *
 * **Why not MUI's `alpha`.** `alpha` is a JavaScript function that parses a
 * colour string and rebuilds it — it needs the actual channels, and
 * `var(--hrms-data-1)` is not a colour until the *browser* resolves it. Passing
 * one throws "Unsupported var(--…) color", and every style built from it is
 * dropped: the stat cards lost their border, gradient and
 * shadow in one go.
 *
 * `color-mix` is the CSS-level equivalent and is resolved where the variable
 * is. It takes hex just as happily, so this is safe wherever `alpha` was and
 * there is no need to know which kind of value arrived — which is the whole
 * point, because a token can change from a hex to a variable and every call
 * site would otherwise have to be revisited.
 */
export function tint(color: string, amount: number): string {
  const percent = Math.round(Math.min(Math.max(amount, 0), 1) * 100);
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}
