"use client";

import Box from "@mui/material/Box";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import ChatWidget from "@/components/chat/ChatWidget";
import GlobalDrawer from "@/components/modals/GlobalDrawer";
import AppSidebar, { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from "@/components/shell/AppSidebar";
import PresenceBeat from "@/components/attendance/PresenceBeat";
import CommandPalette from "@/components/shell/CommandPalette";
import FirstPasswordGate from "@/components/shell/FirstPasswordGate";
import MobileTopBar from "@/components/shell/MobileTopBar";
import PageTransition from "@/components/shell/PageTransition";
import RouteGuard from "@/components/shell/RouteGuard";
import RouteHold from "@/components/shell/RouteHold";
import SetupInvitation from "@/components/shell/SetupInvitation";
import ThemeCustomizer from "@/components/shell/ThemeCustomizer";
import TopBar from "@/components/shell/TopBar";
import { useThemeStore } from "@/lib/store/theme";

// Routes that are not the signed-in app.
const NO_SHELL_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/careers",
  // Two allowlists decide "is this page public": `proxy.ts` lets the request
  // through without a session, and this decides whether the app chrome wraps
  // it. A route added to the first and not the second shows somebody with no
  // account a signed-in sidebar, a topbar and a spinner that never resolves,
  // because the shell calls endpoints they cannot reach.
  //
  // The lists are separate for a real reason (one is auth, one is layout), and
  // the coupling between them is invisible from either file. Cross-referenced
  // here and in `proxy.ts` so the next public page changes both.
  "/offer",
];

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const sidebarMode = useThemeStore((s) => s.sidebarMode);
  const hideShell = pathname === "/" || NO_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (hideShell) return <>{children}</>;

  // "hover" reserves the rail width permanently — the sidebar expands *over*
  // the content rather than shoving it, so nothing reflows while you read.
  //
  // "detached" is full width like the default, plus the gap it floats in on
  // both sides. Every mode that is not a collapsed rail needs its own width;
  // treating them alike puts the content underneath the sidebar.
  const sidebarWidth =
    sidebarMode === "default"
      ? SIDEBAR_WIDTH
      : sidebarMode === "detached"
        ? SIDEBAR_WIDTH + 24
        : SIDEBAR_COLLAPSED_WIDTH;

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default", position: "relative" }}>
      {/* The same 56px grid the public site uses, at a whisper.
          The system read as a different product partly because it had no
          ground at all — a flat fill behind flat cards. This is the cheapest
          cue that both surfaces belong to each other, and it costs no request
          and no element in the accessibility tree. */}
      <Box
        aria-hidden
        className="no-print"
        sx={(t) => ({
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          backgroundImage: `linear-gradient(${t.vars.palette.divider} 1px, transparent 1px), linear-gradient(90deg, ${t.vars.palette.divider} 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
          opacity: 0.35,
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 100%)",
        })}
      />
      {/* The only primary navigation: a rail on desktop, a drawer on mobile.
          It replaced FloatingNav (a second route list that drifted from this
          one) and RightAvatarRail (a third surface whose one real job —
          starting a DM — the chat widget already does). */}
      <AppSidebar />

      <Box
        component="main"
        sx={{
          ml: { xs: 0, md: `${sidebarWidth}px` },
          display: "flex",
          flexDirection: "column",
          minHeight: "100dvh",
          // Above the grid, which is fixed at z-index 0.
          position: "relative",
          zIndex: 1,
          transition: (t) => `margin-left ${t.hrms.motion.duration.normal}ms ${t.hrms.motion.easing.standard}`,
        }}
      >
        <TopBar />
        <MobileTopBar />
        {/* Inside the shell so the chrome stays put while a redirect resolves —
            blanking the whole window would read as a crash. */}
        <RouteGuard>
          <PageTransition>{children}</PageTransition>
        </RouteGuard>
      </Box>

      {/* One launcher, bottom-right. Nothing sits beside it: a second
          floating control in the same corner competes with this one. */}
      <ChatWidget />

      {/* Appearance panel — an edge tab, deliberately not a second FAB. */}
      <ThemeCustomizer />

      <CommandPalette />
      {/* Records that the clock is still running, so closing the tab ends the
          session where the person actually stopped. See `PresenceBeat`. */}
      <PresenceBeat />
      <GlobalDrawer />

      {/* Renders nothing unless the signed-in account is still using a password
          the system generated and mailed. Mounted here rather than per page so
          there is no route that forgets it. */}
      <FirstPasswordGate />

      {/* Asks a new workspace to finish setting itself up. Mounted after the
          password gate so the two never stack: changing a mailed password is
          owed *before* anything else, and this one can wait a moment longer. */}
      <SetupInvitation />

      {/* Frosts the shell while a page's first data is on its way. Last in the
          tree so it lies over the chrome it is blurring, and inside the shell
          so the sidebar and top bar stay visible through it — a navigation
          should look like this system changing subject, not like the window
          being emptied. */}
      <RouteHold />
    </Box>
  );
}
