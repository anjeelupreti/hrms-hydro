"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
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
