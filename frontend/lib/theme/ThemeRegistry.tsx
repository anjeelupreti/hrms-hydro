"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import { ThemeProvider } from "@mui/material/styles";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { buildTheme } from "./theme";
import { useThemeStore } from "@/lib/store/theme";

/**
 * Dynamic ThemeRegistry — reads the user's accent colour from the persist
 * store and rebuilds the MUI theme on every change, giving instant live
 * updates without a page reload.
 */
function DynamicThemeProvider({ children }: { children: ReactNode }) {
  const accentColor = useThemeStore((s) => s.accentColor);
  const density = useThemeStore((s) => s.density);
  const theme = useMemo(() => buildTheme(accentColor, density), [accentColor, density]);

  // `defaultMode` must match `InitColorSchemeScript` in `app/layout.tsx`. If the
  // two disagree, the first client render flips the scheme the script had
  // already applied — a visible flash rather than a subtle bug.
  return (
    <ThemeProvider theme={theme} defaultMode="system">
      <CssBaseline />
      {/* **The legacy Nepali faces.**

          Preeti and its siblings are not Unicode: they are ASCII fonts whose
          glyphs look Devanagari, which is why text typed on a Preeti keyboard
          reads as Latin nonsense in any other face. They are also licensed
          products and cannot be bundled — so each is declared `local()` first,
          which covers the Nepali office machines that already have them, and
          `url()` second, so an organisation holding a licence can drop the file
          into `public/fonts` and have every user get it. See the README there.

          A missing file is not an error: `swap` means the browser falls back
          without blocking, and the editor's font menu says plainly which faces
          it could not find rather than leaving somebody to wonder why their
          typing looks wrong. */}
      <GlobalStyles
        styles={{
          "@font-face": [
            {
              fontFamily: "Preeti",
              src: 'local("Preeti"), url("/fonts/preeti.ttf") format("truetype")',
              fontDisplay: "swap",
            },
            {
              fontFamily: "Kalimati",
              src: 'local("Kalimati"), url("/fonts/kalimati.ttf") format("truetype")',
              fontDisplay: "swap",
            },
            {
              fontFamily: "Sagarmatha",
              src: 'local("Sagarmatha"), url("/fonts/sagarmatha.ttf") format("truetype")',
              fontDisplay: "swap",
            },
          ],
        }}
      />
      {children}
    </ThemeProvider>
  );
}

export default function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ key: "mui" }}>
      <DynamicThemeProvider>{children}</DynamicThemeProvider>
    </AppRouterCacheProvider>
  );
}
