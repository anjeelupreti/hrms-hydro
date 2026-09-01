import Grow from "@mui/material/Grow";
import { createTheme, alpha, darken, getContrastRatio, lighten } from "@mui/material/styles";
import type {} from "@mui/x-data-grid/themeAugmentation";

import {
  DATA_PALETTE,
  deriveGradients,
  deriveModuleHues,
  deriveSecondary,
  deriveSeries,
  DENSITY,
  ELEVATION,
  FONT,
  INK,
  MOTION,
  RADIUS,
  RADIUS_UNIT,
  SPACING_UNIT,
  STATUS,
  SURFACE,
  DISPLAY_NUMS,
  TABULAR_NUMS,
  type Density,
} from "./tokens";

/**
 * Theme factory — builds the full light + dark schemes from an accent colour
 * and a density preference. Consumed by `ThemeRegistry`, which reads both from
 * the persisted store so a change applies instantly without a reload.
 *
 * Every value here comes from `tokens.ts`. Adding a literal to this file is
 * almost always a sign the token is missing.
 */

const FALLBACK_ACCENT = "#4f46e5";

/**
 * Derive a lighter tint and darker shade from any hex accent.
 *
 * This once returned `hex + "cc"` / `hex + "dd"` — which is not a lighter or
 * darker shade at all, but the *same* colour at 80%/87% alpha. Every
 * `primary.light` and `primary.dark` in the app therefore rendered
 * semi-transparent over whatever sat behind it, which is what made the
 * interface read as hazy rather than crisp.
 *
 * `contrastText` is computed rather than assumed white, so a pale accent
 * (yellow, lime, cyan) doesn't produce unreadable labels on filled surfaces.
 */
/**
 * The accent, adjusted until it can do both of its jobs in this scheme.
 *
 * **Two values, because a fill and link text pull in opposite directions.** A
 * fill wants to be vivid; text wants 4.5:1 against the page. Served by one
 * value the text requirement always wins, which rules out every hue with high
 * intrinsic luminance — cyan, teal, orange, hot pink. Measured: `#0891b2`
 * reaches 3.41 against the light ground and `#ea580c` only 3.30. Neither is a
 * saturation problem; they are simply light colours, and no amount of chroma
 * fixes that.
 *
 * `deriveSecondary` already took a scheme and set its own lightness. Primary
 * did not, which is the whole bug. Now it does: the *hue and saturation* the
 * user picked are preserved exactly — that is what they chose — and only
 * lightness is moved, far enough to clear the contrast bar on this scheme's
 * ground and no further.
 *
 * The result is that a bright cyan stays a bright cyan and becomes readable,
 * instead of being excluded from the palette for being bright.
 */
function deriveShades(hex: string, scheme: "light" | "dark" = "light") {
  let raw = typeof hex === "string" ? hex.trim() : "";
  try {
    getContrastRatio(raw, "#ffffff"); // throws on anything unparseable
  } catch {
    raw = FALLBACK_ACCENT;
  }

  const ground = scheme === "dark" ? SURFACE.dark.card : SURFACE.light.page;
  // Walk toward the readable end in small steps rather than snapping to a
  // fixed lightness: a hue that already passes is left completely alone, and
  // one that does not is moved the least amount that works.
  let main = raw;
  for (let step = 0; step < 14; step += 1) {
    if (getContrastRatio(main, ground) >= 4.5) break;
    main = scheme === "dark" ? lighten(main, 0.08) : darken(main, 0.08);
  }

  return {
    main,
    light: lighten(main, 0.25),
    dark: darken(main, 0.2),
    // What sits *on* the accent. Derived against the accent itself, because a
    // light accent needs dark text and guessing white is how a button label
    // disappears.
    contrastText: getContrastRatio(main, "#ffffff") >= 3 ? "#ffffff" : "#0f172a",
    /** The untouched pick, for fills and decoration that carry no text. */
    vivid: raw,
  };
}

/** Status tints, flattened into CSS custom properties for use from `sx`.
 *
 * Takes the accent now, because the module hues and the chart series are
 * derived from it rather than being fixed lists. Status colours stay literal
 * and always will: green-means-good is not a branding decision, and tinting a
 * failure state toward the house colour is how a red stops reading as an
 * alarm. */
function statusVars(scheme: "light" | "dark", accent: string) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(STATUS[scheme])) {
    out[`--hrms-status-${key}-fg`] = value.fg;
    out[`--hrms-status-${key}-bg`] = value.bg;
    out[`--hrms-status-${key}-border`] = value.border;
    out[`--hrms-status-${key}-solid`] = value.solid;
  }
  for (const [key, value] of Object.entries(deriveModuleHues(accent))) {
    out[`--hrms-module-${key}`] = value;
  }
  // The ramp is re-centred for a dark ground rather than being a second hand-
  // picked list: a step that passes contrast on white is far too dark here.
  deriveSeries(accent, scheme).forEach((colour, i) => {
    out[`--hrms-data-${i + 1}`] = colour;
  });
  // ── The marketing surface ────────────────────────────────────────────
  //
  // The public site runs one tone down the page rather than alternating light
  // and dark chapters, and these resolve that tone per scheme — the same roles
  // `chapterTones` describes.
  //
  // Defined here rather than in the components so the site follows the
  // reader's colour scheme. A near-black inlined into a component is a tone
  // the scheme toggle in the header cannot reach.
  Object.assign(
    out,
    scheme === "dark"
      ? {
          "--marketing-surface": "#0b0d14",
          "--marketing-raised": "rgba(255,255,255,0.02)",
          "--marketing-ink": "#ffffff",
          "--marketing-dim": "rgba(255,255,255,0.62)",
          "--marketing-faint": "rgba(255,255,255,0.38)",
          "--marketing-border": "rgba(255,255,255,0.12)",
          "--marketing-hover": "rgba(255,255,255,0.06)",
          // The ink and surface as raw channels, so every one-off alpha in
          // the marketing components can be written against the scheme
          // instead of being another literal white to find later.
          "--marketing-ink-rgb": "255, 255, 255",
          "--marketing-surface-rgb": "11, 13, 20",
        }
      : {
          // Not pure white: a full-bleed #fff page under a coloured hero reads
          // as unfinished, and the faint warmth keeps the borders visible.
          "--marketing-surface": "#f7f8fb",
          "--marketing-raised": "rgba(15,23,42,0.025)",
          "--marketing-ink": "#0b0d14",
          "--marketing-dim": "rgba(15,23,42,0.66)",
          "--marketing-faint": "rgba(15,23,42,0.45)",
          "--marketing-border": "rgba(15,23,42,0.12)",
          "--marketing-hover": "rgba(15,23,42,0.045)",
          "--marketing-ink-rgb": "15, 23, 42",
          "--marketing-surface-rgb": "247, 248, 251",
        }
  );

  // The decorative gradients too, so a profile cover and the birthday card
  // belong to the same workspace as everything else on the page.
  const gradients = deriveGradients(accent);
  out["--hrms-gradient-profile"] = gradients.profileCover;
  out["--hrms-gradient-celebration"] = gradients.celebration;
  out["--hrms-gradient-brand"] = gradients.brand;
  return out;
}

export function buildTheme(accentColor: string, density: Density = "comfortable") {
  const pLight = deriveShades(accentColor, "light");
  const pDark = deriveShades(accentColor, "dark");
  const d = DENSITY[density];

  return createTheme({
    cssVariables: { colorSchemeSelector: "class" },
    spacing: SPACING_UNIT,
    // The multiplier unit for `sx={{ borderRadius: n }}` — see RADIUS_UNIT.
    shape: { borderRadius: RADIUS_UNIT },

    // Exposed on the theme so components can read density without importing
    // the store — `theme.hrms.density.rowHeight` rather than a prop drill.
    hrms: {
      density,
      ...d,
      radius: RADIUS,
      status: STATUS,
      // Derived per accent, so `theme.hrms.module.payroll` and the chart
      // series follow the company's colour instead of contradicting it.
      module: deriveModuleHues(accentColor),
      data: {
        ...DATA_PALETTE,
        categorical: deriveSeries(accentColor, "light"),
        categoricalDark: deriveSeries(accentColor, "dark"),
      },
      motion: MOTION,
    },

    colorSchemes: {
      light: {
        palette: {
          primary: { main: pLight.main, light: pLight.light, dark: pLight.dark, contrastText: pLight.contrastText },
          // Derived, not fixed. This was a hardcoded orange, so every chip and
          // avatar painted with `secondary.light` came out orange whatever accent
          // the system had chosen.
          secondary: deriveSecondary(accentColor, "light"),
          // Lighter shade / darker shade — see the note on the dark scheme
          // below. Here the pale `.bg` genuinely is lighter and `.fg` genuinely
          // is darker, so this pair was accidentally right; it is spelled out
          // the same way so the next edit does not reintroduce the confusion.
          success: { main: STATUS.light.success.solid, light: STATUS.light.success.bg, dark: STATUS.light.success.fg },
          warning: { main: STATUS.light.warning.solid, light: STATUS.light.warning.bg, dark: STATUS.light.warning.fg },
          error: { main: STATUS.light.danger.solid, light: STATUS.light.danger.bg, dark: STATUS.light.danger.fg },
          info: { main: STATUS.light.info.solid, light: STATUS.light.info.bg, dark: STATUS.light.info.fg },
          text: { primary: INK.light.primary, secondary: INK.light.secondary, disabled: INK.light.disabled },
          background: { default: SURFACE.light.page, paper: SURFACE.light.card },
          divider: SURFACE.light.border,
        },
      },
      dark: {
        palette: {
          primary: { main: pDark.main, light: pDark.light, dark: pDark.dark, contrastText: pDark.contrastText },
          secondary: deriveSecondary(accentColor, "dark"),
          // 🔒 **`light` and `dark` mean *a lighter shade* and *a darker shade*
          // — not "the light-theme value" and "the dark-theme value".**
          //
          // They were filled with `.bg` and `.fg`, which reads naturally and is
          // wrong: `.bg` in the dark set is a 14%-opacity wash, so
          // `palette.warning.light` was very nearly transparent. Every MUI
          // component that reaches for the lighter shade in dark mode — the
          // standard `Alert` above all — rendered its text in that wash. The
          // setup banner, which is the first thing a new workspace is told,
          // was unreadable dark-on-dark because of it.
          //
          // `.fg` is the *lifted* step (it exists to be legible on a dark
          // ground) so it is the correct `light`; the light scheme's `fg` is
          // the darker step and serves as `dark`.
          success: { main: STATUS.dark.success.solid, light: STATUS.dark.success.fg, dark: STATUS.light.success.fg },
          warning: { main: STATUS.dark.warning.solid, light: STATUS.dark.warning.fg, dark: STATUS.light.warning.fg },
          error: { main: STATUS.dark.danger.solid, light: STATUS.dark.danger.fg, dark: STATUS.light.danger.fg },
          info: { main: STATUS.dark.info.solid, light: STATUS.dark.info.fg, dark: STATUS.light.info.fg },
          text: { primary: INK.dark.primary, secondary: INK.dark.secondary, disabled: INK.dark.disabled },
          // paper sits *above* default. These were both #09090b, so every card
          // dissolved into the page and dark mode read as one flat sheet.
          background: { default: SURFACE.dark.page, paper: SURFACE.dark.card },
          divider: SURFACE.dark.border,
        },
      },
    },

    typography: {
      fontFamily: FONT.sans,
      h1: { fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1 },
      h2: { fontWeight: 800, letterSpacing: "-0.032em", lineHeight: 1.15 },
      h3: { fontWeight: 700, letterSpacing: "-0.028em", lineHeight: 1.2 },
      h4: { fontWeight: 700, letterSpacing: "-0.022em", fontSize: "1.6rem", lineHeight: 1.25 },
      h5: { fontWeight: 700, letterSpacing: "-0.016em", fontSize: "1.25rem", lineHeight: 1.3 },
      h6: { fontWeight: 700, letterSpacing: "-0.01em", fontSize: "1.0625rem", lineHeight: 1.35 },
      subtitle1: { fontWeight: 600, fontSize: "0.9375rem", lineHeight: 1.45 },
      subtitle2: { fontWeight: 600, fontSize: "0.8125rem", lineHeight: 1.45 },
      body1: { fontSize: "0.9375rem", lineHeight: 1.55 },
      body2: { fontSize: "0.8437rem", lineHeight: 1.5 },
      caption: { fontSize: "0.75rem", lineHeight: 1.4 },
      // Mono, matching the public site's chapter labels. `overline` is what
      // the system uses for section eyebrows ("SIGNERS", "CYCLES"), so
      // giving it the same face is what makes a settings panel and a landing
      // chapter read as the same product.
      overline: {
        fontFamily: FONT.mono,
        fontWeight: 700,
        fontSize: "0.6875rem",
        letterSpacing: "0.12em",
        lineHeight: 1.3,
      },
      button: { fontWeight: 600, textTransform: "none" as const, letterSpacing: 0 },
    },

    components: {
      MuiCssBaseline: {
        styleOverrides: (themeParam) => ({
          ":root": statusVars("light", accentColor),
          // The class selector matches `cssVariables.colorSchemeSelector`.
          ".dark, [data-mui-color-scheme='dark']": statusVars("dark", accentColor),

          // Plus Jakarta Sans is a soft-contrast geometric face; without
          // grayscale smoothing it renders muddy at body sizes on high-DPI
          // screens. optimizeLegibility is deliberately not set — it enables
          // kerning tables that make small UI text wobble.
          "html, body": {
            WebkitFontSmoothing: "antialiased",
            MozOsxFontSmoothing: "grayscale",
            textSizeAdjust: "100%",
          },
          // Any element that renders an amount. Applied by class so a plain
          // <span> in a table cell can opt in without a wrapper component.
          ".hrms-num": TABULAR_NUMS,
          // A headline figure. Proportional, because tabular digits are for
          // columns that line up and make a lone large number look gappy.
          ".hrms-display-num": DISPLAY_NUMS,

          // Scrollbars: present when you need them, gone when you don't.
          //
          // A permanent 10px grey track down every scrollable panel is a lot
          // of furniture for something that is only useful while scrolling —
          // and it drew a hard vertical rule beside every card. These are
          // thin, track-less, and only show a thumb on hover or while the
          // area is actually scrolling.
          "*": {
            scrollbarWidth: "thin",
            scrollbarColor: "transparent transparent",
          },
          "*:hover, *:focus-within": {
            scrollbarColor: `color-mix(in srgb, ${themeParam.vars.palette.text.disabled} 55%, transparent) transparent`,
          },
          "*::-webkit-scrollbar": { width: 8, height: 8 },
          "*::-webkit-scrollbar-track": { background: "transparent" },
          "*::-webkit-scrollbar-thumb": {
            backgroundColor: "transparent",
            borderRadius: RADIUS.pill,
            border: "2px solid transparent",
            backgroundClip: "content-box",
            transition: `background-color ${MOTION.duration.fast}ms ${MOTION.easing.standard}`,
          },
          "*:hover::-webkit-scrollbar-thumb, *:focus-within::-webkit-scrollbar-thumb": {
            backgroundColor: `color-mix(in srgb, ${themeParam.vars.palette.text.disabled} 55%, transparent)`,
          },
          "*::-webkit-scrollbar-thumb:hover": {
            backgroundColor: `color-mix(in srgb, ${themeParam.vars.palette.text.secondary} 70%, transparent)`,
          },
          "*::-webkit-scrollbar-corner": { background: "transparent" },

          // Payslips, reports and certificates get printed. Without this the
          // sidebar, top bar, chat launcher and appearance tab all print too,
          // and dark mode prints a black page.
          "@media print": {
            "nav, header, .no-print, .MuiFab-root, .MuiDrawer-root, .MuiTooltip-popper": {
              display: "none !important",
            },
            main: { margin: "0 !important", padding: "0 !important" },
            body: { background: "#fff !important", color: "#000 !important" },
            // Force the light palette: a printer has no dark mode, and dark
            // surfaces come out as either solid ink or nothing at all.
            ":root": { colorScheme: "light" },
            ".MuiPaper-root, .MuiCard-root": {
              boxShadow: "none !important",
              border: "1px solid #ddd !important",
              breakInside: "avoid",
            },
            "table, .MuiTableContainer-root": { breakInside: "auto" },
            "tr, .MuiTableRow-root": { breakInside: "avoid", breakAfter: "auto" },
            thead: { display: "table-header-group" },
            // A URL after every link is noise on an internal document.
            "a[href]::after": { content: '""' },
            "@page": { margin: "14mm" },
          },
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": {
              animationDuration: "0.001ms !important",
              animationIterationCount: "1 !important",
              transitionDuration: "0.001ms !important",
              scrollBehavior: "auto !important",
            },
          },

          "@keyframes pulse-ring": {
            "0%": { transform: "scale(1)", opacity: 0.6 },
            "70%": { transform: "scale(1.6)", opacity: 0 },
            "100%": { transform: "scale(1.6)", opacity: 0 },
          },
          "@keyframes shimmer": {
            "0%": { backgroundPosition: "-200% 0" },
            "100%": { backgroundPosition: "200% 0" },
          },
          // Focus is never invisible. Applies to anything focused by keyboard,
          // including elements that opted out of MUI's own focus styling.
          "*:focus-visible": {
            outline: `2px solid ${themeParam.vars.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
      },

      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },

      MuiCard: {
        defaultProps: { variant: "outlined" },
        styleOverrides: {
          // Matches the public site's card treatment: a translucent fill over
          // the page rather than an opaque block, a hairline border, and the
          // larger corner. The system read as flat next to the landing page
          // because every card was a solid slab of `paper` on a `default`
          // ground — two greys with nothing between them.
          root: ({ theme }) => ({
            borderRadius: RADIUS.lg,
            borderColor: theme.vars.palette.divider,
            backgroundColor: `color-mix(in srgb, ${theme.vars.palette.background.paper} 72%, transparent)`,
            backdropFilter: "blur(10px)",
            boxShadow: "none",
            transition: `border-color ${MOTION.duration.fast}ms ${MOTION.easing.standard}, box-shadow ${MOTION.duration.fast}ms ${MOTION.easing.standard}`,
            // A primary tint on hover says "interactive". A hard grey
            // border (text.secondary) reads as an error state instead.
            "&:hover": { borderColor: `rgba(${theme.vars.palette.primary.mainChannel} / 0.45)` },
          }),
        },
      },
      MuiCardContent: { styleOverrides: { root: { padding: d.cardPadding, "&:last-child": { paddingBottom: d.cardPadding } } } },

      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          // **Redesigned 19 Aug.** These were Material's default silhouette —
          // an 8px rectangle, flat fill, no press state — which is what makes
          // a product look like a framework demo rather than a product.
          //
          // Three changes, none of them decoration:
          //
          // *Shape.* 10px reads as deliberate where 8 reads as the default and
          // a pill reads as a toy. Paired with more horizontal room, so a
          // button is a considered block rather than text with a box drawn
          // round it.
          //
          // *Depth.* A filled button gets a hairline top highlight and a
          // shadow tinted with its own colour rather than grey. That is how a
          // real surface catches light, and it is why a flat rectangle looks
          // printed on rather than sitting on the page.
          //
          // *Response.* It moves 1px on press. Every physical control does,
          // and its absence is the thing people call "unresponsive" without
          // being able to name it.
          root: {
            borderRadius: RADIUS.md,
            paddingInline: 20,
            minHeight: d.controlHeight,
            textTransform: "none",
            fontWeight: 650,
            letterSpacing: "-0.005em",
            transition: "transform .12s ease, box-shadow .2s ease, background-color .2s ease, border-color .2s ease",
            "&:active": { transform: "translateY(1px)" },
            "&.Mui-disabled": { transform: "none" },
            "&.MuiButton-containedPrimary": {
              // A real gradient in the accent itself, not a white sheen laid
              // over a flat fill. Both stops are mixed from
              // `--mui-palette-primary-main`, so choosing a different accent
              // moves the whole button rather than leaving it a colour that no
              // longer belongs to the theme.
              backgroundImage:
                "linear-gradient(135deg," +
                " color-mix(in srgb, var(--mui-palette-primary-main) 82%, white) 0%," +
                " var(--mui-palette-primary-main) 48%," +
                " color-mix(in srgb, var(--mui-palette-primary-main) 82%, black) 100%)",
              boxShadow:
                "0 1px 0 0 rgba(255,255,255,0.14) inset, 0 2px 8px -2px color-mix(in srgb, var(--mui-palette-primary-main) 55%, transparent)",
            },
            "&.MuiButton-containedPrimary:hover": {
              backgroundImage:
                "linear-gradient(135deg," +
                " color-mix(in srgb, var(--mui-palette-primary-main) 72%, white) 0%," +
                " var(--mui-palette-primary-main) 52%," +
                " color-mix(in srgb, var(--mui-palette-primary-main) 88%, black) 100%)",
              boxShadow:
                "0 1px 0 0 rgba(255,255,255,0.2) inset, 0 6px 18px -4px color-mix(in srgb, var(--mui-palette-primary-main) 65%, transparent)",
            },
            "&.MuiButton-containedPrimary:active": {
              boxShadow:
                "0 1px 0 0 rgba(255,255,255,0.1) inset, 0 1px 4px -1px color-mix(in srgb, var(--mui-palette-primary-main) 50%, transparent)",
            },
            // Outlined is the app's "quiet" button: neutral rather than
            // primary-coloured. Scoped to primary/inherit ONLY, because an
            // unscoped rule overrides the `color` prop — and then
            // `<Button variant="outlined" color="error">Reject</Button>`
            // looks identical to Approve.
            "&.MuiButton-outlinedPrimary, &.MuiButton-outlinedInherit": {
              borderColor: "var(--mui-palette-divider)",
              color: "var(--mui-palette-text-primary)",
              "&:hover": { backgroundColor: "var(--mui-palette-action-hover)" },
            },
          },
          sizeSmall: { borderRadius: RADIUS.sm, minHeight: d.controlHeight - 8, paddingInline: 14 },
          sizeLarge: { borderRadius: RADIUS.lg, paddingInline: 28, minHeight: d.controlHeight + 10 },
        },
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: RADIUS.sm } } },

      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, borderRadius: RADIUS.xs },
          sizeSmall: { height: 22, fontSize: "0.75rem" },
        },
      },

      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: RADIUS.sm,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: theme.vars.palette.divider },
          }),
          // Small inputs are what toolbars and filters use, so this is the size
          // that has to follow density. 22px is the line box; the remainder of
          // the control height is split above and below it.
          //
          // **The inner element's own vertical padding is zeroed, or this adds
          // to it rather than replacing it.** MUI pads `.MuiOutlinedInput-input`
          // as well as the root, and by different amounts in different
          // components — so the same `size="small"` field measured 57px as a
          // search box, 39px as a picker and 32px in the chat panel. Three
          // heights for one control, in rows meant to line up. Setting the
          // height here and letting the child keep its padding was the bug;
          // the root now owns the whole of it.
          //
          // `:not(textarea)` because a multiline field is sized by its rows,
          // not by `controlHeight`, and zeroing its padding crowds the text
          // against the border.
          sizeSmall: {
            paddingBlock: Math.max(4, (d.controlHeight - 22) / 2),
            "& .MuiInputBase-input:not(textarea)": { paddingBlock: 0 },
            // Autocomplete and Select re-pad their own inner element, and both
            // are used as filters beside a plain field.
            "& .MuiAutocomplete-input": { paddingBlock: 0 },
            "& .MuiSelect-select": { paddingBlock: 0, minHeight: 22 },
          },
        },
      },

      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: {
          tooltip: { fontSize: "0.75rem", fontWeight: 500, padding: "6px 10px", borderRadius: RADIUS.xs },
        },
      },

      MuiMenu: {
        styleOverrides: {
          paper: ({ theme }) => ({
            borderRadius: RADIUS.md,
            border: `1px solid ${theme.vars.palette.divider}`,
            boxShadow: ELEVATION.light[3],
            marginTop: 6,
          }),
        },
      },

      MuiDialog: {
        defaultProps: { slots: { transition: Grow }, transitionDuration: { enter: MOTION.duration.normal, exit: MOTION.duration.fast } },
        styleOverrides: { paper: { borderRadius: RADIUS.xl } },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontWeight: 700 } } },

      MuiBackdrop: {
        styleOverrides: {
          root: {
            backgroundColor: alpha("#0b1120", 0.45),
            backdropFilter: "blur(3px)",
            "&.MuiBackdrop-invisible": { backgroundColor: "transparent", backdropFilter: "none" },
          },
        },
      },

      MuiTableContainer: {
        styleOverrides: {
          // Long tables scroll under their own header rather than losing it.
          root: { "& thead th": { position: "sticky", top: 0, zIndex: 2 } },
        },
      },

      MuiTableCell: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderColor: theme.vars.palette.divider,
            paddingBlock: d.cellPaddingY,
            paddingInline: d.cellPaddingX,
          }),
          head: ({ theme }) => ({
            fontWeight: 700,
            fontSize: "0.75rem",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: theme.vars.palette.text.secondary,
            backgroundColor: theme.vars.palette.background.default,
            paddingBlock: d.cellPaddingY - 2,
            whiteSpace: "nowrap",
          }),
          // Right-aligned cells are money or counts; give them tabular figures
          // automatically so nobody has to remember.
          alignRight: TABULAR_NUMS,
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: ({ theme }) => ({
            "&:hover": { backgroundColor: theme.vars.palette.action.hover },
          }),
        },
      },

      MuiListItemButton: { styleOverrides: { root: { borderRadius: RADIUS.sm, paddingBlock: d.listItemPaddingY } } },

      MuiAppBar: {
        defaultProps: { elevation: 0, color: "inherit" },
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: `rgba(${theme.vars.palette.background.paperChannel} / 0.85)`,
            backdropFilter: "blur(10px)",
            borderBottom: `1px solid ${theme.vars.palette.divider}`,
            color: theme.vars.palette.text.primary,
          }),
        },
      },

      MuiDataGrid: {
        // Set here rather than in the DataTable wrapper so grids that have not
        // been migrated yet still follow the density preference.
        defaultProps: { rowHeight: d.rowHeight, columnHeaderHeight: d.headerHeight },
        styleOverrides: {
          root: ({ theme }) => ({
            border: `1px solid ${theme.vars.palette.divider}`,
            borderRadius: RADIUS.lg,
            backgroundColor: theme.vars.palette.background.paper,
            "--DataGrid-rowBorderColor": theme.vars.palette.divider,
          }),
          columnHeaders: ({ theme }) => ({ backgroundColor: theme.vars.palette.background.default }),
          columnHeaderTitle: ({ theme }) => ({
            fontWeight: 700,
            fontSize: "0.75rem",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: theme.vars.palette.text.secondary,
          }),
          cell: ({ theme }) => ({ borderColor: theme.vars.palette.divider }),
          "cell--textRight": TABULAR_NUMS,
          row: ({ theme }) => ({ "&:hover": { backgroundColor: theme.vars.palette.action.hover } }),
          footerContainer: ({ theme }) => ({ borderColor: theme.vars.palette.divider }),
          columnSeparator: { color: "transparent" },
        },
      },

      MuiAlert: { styleOverrides: { root: { borderRadius: RADIUS.md } } },
      MuiAvatar: { styleOverrides: { root: { fontWeight: 700 } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: RADIUS.pill, height: 8 } } },
      MuiSkeleton: { defaultProps: { animation: "wave" } },
    },
  });
}

/** Backward-compatible static export for server components that can't read the store. */
export const theme = buildTheme(FALLBACK_ACCENT);
