"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";

import DeltaBadge from "@/components/common/DeltaBadge";
import { GRADIENT, INK, MODULE_HUE, type ModuleKey } from "@/lib/theme/tokens";

type Figure = {
  label: string;
  /** A node, not a string, so a money figure can arrive already masked. */
  value: ReactNode;
  delta?: { value: number; comparedTo?: string; lowerIsBetter?: boolean };
};

type Props = {
  /** Small line above the headline figure — "Total gross payroll". */
  eyebrow: string;
  /**
   * The number this screen exists for. Already formatted.
   *
   * A node rather than a string: on the portal this headline *is* somebody's
   * net pay, which is the exact figure the privacy mask exists for, and a
   * string prop cannot carry a masked one.
   */
  value: ReactNode;
  caption?: string;
  delta?: { value: number; comparedTo?: string; lowerIsBetter?: boolean };
  /** Up to three supporting figures, shown to the right. */
  figures?: Figure[];
  /** Tints the panel. Use the module's own hue. */
  tone?: ModuleKey;
  actions?: ReactNode;
  /** Status line above everything — "Processing · cut-off 25 Dec". */
  status?: ReactNode;
};

/**
 * One panel per screen, carrying the single number that screen exists for.
 *
 * Four identical stat cards in a row tell you everything is equally important,
 * which means nothing is. This is the deliberate exception: a dark, tinted
 * surface that is unmistakably the most important thing on the page. **One per
 * screen** — a second one cancels the first.
 */
export default function HeroPanel({
  eyebrow,
  value,
  caption,
  delta,
  figures = [],
  tone = "dashboard",
  actions,
  status,
}: Props) {
  const hue = MODULE_HUE[tone];

  return (
    <Box
      sx={(theme) => ({
        position: "relative",
        overflow: "hidden",
        borderRadius: 4, // 16px — a large panel wants the lg step
        p: { xs: 2.5, md: 3.5 },
        mb: 3,
        // 🔒 `theme.vars`, never `theme.palette` — the rule the charts
        // carry too.
        //
        // Under `cssVariables` the palette is emitted as CSS variables, and
        // `theme.palette.*` read inside an `sx` callback resolves against the
        // *default* scheme and bakes a literal. `text.primary` would freeze at
        // the light near-black `#0f172a`, putting the headline figure, the
        // eyebrow and every supporting number near-black on a near-black
        // panel in dark mode — invisible, not merely low contrast.
        color: theme.vars.palette.text.primary,

        // 🔒 **`theme.palette.mode` is a lie under this theme.** It is built
        // with `cssVariables` + `colorSchemes`, so the palette is emitted as CSS
        // variables and `mode` stays whatever it was at creation — it never
        // reports "dark" when the user switches. Anything branching on it
        // silently renders the light arm forever.
        //
        // `applyStyles` is the API that follows the scheme: it emits a rule
        // under the dark selector rather than resolving a value at render.
        backgroundColor: GRADIENT.heroGround.light,
        backgroundImage: `
          radial-gradient(120% 140% at 100% 0%, ${alpha(hue, 0.3)} 0%, transparent 55%),
          radial-gradient(90% 120% at 0% 100%, ${alpha(hue, 0.12)} 0%, transparent 60%)
        `,
        boxShadow: `0 12px 32px ${alpha(INK.light.primary, 0.18)}`,
        ...theme.applyStyles("dark", {
          backgroundColor: GRADIENT.heroGround.dark,
          // The hue carries harder on a dark ground, where it has to lift the
          // panel off the page rather than tint it.
          backgroundImage: `
            radial-gradient(120% 140% at 100% 0%, ${alpha(hue, 0.42)} 0%, transparent 55%),
            radial-gradient(90% 120% at 0% 100%, ${alpha(hue, 0.18)} 0%, transparent 60%)
          `,
          boxShadow: "none",
        }),
      })}
    >
      {/* Faint grid, so a large dark area is not a flat void. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.5,
          // Drawn in the ink colour rather than always-white: a white grid on
          // a light panel is invisible, which is how the "flat void" this
          // exists to prevent came back in light mode.
          // `color-mix` rather than `alpha()`: the ink is a CSS variable now,
          // and `alpha()` needs a literal colour to parse. This is the CSS-side
          // equivalent, and it follows the scheme where a baked literal cannot.
          backgroundImage: (theme) => {
            const ink = `color-mix(in srgb, ${theme.vars.palette.text.primary} 5%, transparent)`;
            return [
              `linear-gradient(${ink} 1px, transparent 1px)`,
              `linear-gradient(90deg, ${ink} 1px, transparent 1px)`,
            ].join(", ");
          },
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 70% at 30% 0%, #000 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 30% 0%, #000 30%, transparent 100%)",
        }}
      />

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={{ xs: 3, md: 4 }}
        sx={{ position: "relative", alignItems: { md: "center" }, justifyContent: "space-between" }}
      >
        <Box sx={{ minWidth: 0 }}>
          {status && <Box sx={{ mb: 1.5 }}>{status}</Box>}

          <Typography
            variant="overline"
            sx={{ color: "text.secondary", display: "block", letterSpacing: "0.1em" }}
          >
            {eyebrow}
          </Typography>

          <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
            <Typography
              className="hrms-display-num"
              sx={{ fontSize: { xs: "2.25rem", md: "2.75rem" }, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.05 }}
            >
              {value}
            </Typography>
            {delta && <DeltaBadge value={delta.value} comparedTo={delta.comparedTo} lowerIsBetter={delta.lowerIsBetter} size="medium" />}
          </Stack>

          {caption && (
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
              {caption}
            </Typography>
          )}

          {actions && <Box sx={{ mt: 2.5 }}>{actions}</Box>}
        </Box>

        {figures.length > 0 && (
          <Stack
            direction="row"
            spacing={0}
            sx={{
              flexShrink: 0,
              borderRadius: 3,
              bgcolor: (theme) =>
                `color-mix(in srgb, ${theme.vars.palette.text.primary} 6%, transparent)`,
              border: "1px solid",
              borderColor: (theme) =>
                `color-mix(in srgb, ${theme.vars.palette.text.primary} 12%, transparent)`,
              overflow: "hidden",
            }}
          >
            {figures.map((f, i) => (
              <Box
                key={f.label}
                sx={{
                  px: { xs: 2, md: 2.75 },
                  py: 1.75,
                  minWidth: 0,
                  borderLeft: i === 0 ? "none" : "1px solid",
                  borderColor: (theme) =>
                `color-mix(in srgb, ${theme.vars.palette.text.primary} 12%, transparent)`,
                }}
              >
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
                  {f.label}
                </Typography>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mt: 0.25 }}>
                  <Typography className="hrms-display-num" sx={{ fontWeight: 700, fontSize: "1.125rem" }}>
                    {f.value}
                  </Typography>
                  {f.delta && <DeltaBadge value={f.delta.value} comparedTo={f.delta.comparedTo} lowerIsBetter={f.delta.lowerIsBetter} />}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
