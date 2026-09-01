import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import type { Metadata } from "next";
import { Noto_Sans_Devanagari, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";

import AppShellLayout from "@/components/shell/AppShellLayout";
import GlobalToaster from "@/components/common/GlobalToaster";
import QueryProvider from "@/lib/query/QueryProvider";
import ThemeRegistry from "@/lib/theme/ThemeRegistry";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

/**
 * Devanagari, for Nepali text.
 *
 * Plus Jakarta Sans has no Devanagari coverage, so Nepali fell through to
 * whatever the OS happened to have — Mangal on Windows, something else on a
 * Mac, and on a machine with no Devanagari face at all, boxes. A product that
 * shows the Nepali date on every page cannot leave that to chance.
 *
 * `next/font/google` self-hosts the file at build time, so this adds no runtime
 * request to Google and no third party sees our users' page loads. Loaded as a
 * separate variable rather than merged into the body font: it is applied only
 * to the elements that actually hold Nepali text, so Latin copy keeps its
 * intended face and the extra file is never in the critical path for it.
 */
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-devanagari",
  display: "swap",
});

export const metadata: Metadata = {
  // The system title. Company name is added by the top bar, not here —
  // this string is also what a bookmark and a browser tab show.
  title: "DeerX HRMS",
  description: "HR, payroll and attendance for growing teams.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${devanagari.variable}`} suppressHydrationWarning>
      <body>
        {/* Sets the color-scheme class before paint — no flash of the wrong theme */}
        {/* `system`, not `light`.
            **Someone whose machine is set to dark was shown light**, every
            time, until they found the toggle — the product simply did not ask.
            `system` follows the OS on a first visit and an explicit choice
            still wins and still persists, so the only behaviour that changes is
            the one nobody had chosen.

            This script must stay in the document head: it sets the class
            before first paint, and without it a dark-mode user gets a white
            flash on every navigation. */}
        <InitColorSchemeScript attribute="class" defaultMode="system" />
        <ThemeRegistry>
          <QueryProvider>
            <AppShellLayout>{children}</AppShellLayout>
            <GlobalToaster />
          </QueryProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
}
