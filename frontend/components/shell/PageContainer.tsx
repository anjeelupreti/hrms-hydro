"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

/**
 * Standard page wrapper.
 *
 * The content spans whatever room the sidebar leaves it — no capped measure
 * and no `mx: auto`. Capping and centring puts empty margins either side of a
 * data table that would happily use the space, which reads as padded rather
 * than roomy. The sidebar's width is the only horizontal space the app
 * reserves, and it reflows live when the rail collapses.
 *
 * Full-height pages (chat, mail) opt out and manage their own layout.
 *
 * Gutters come from the density tokens rather than fixed values: switching to
 * compact has to reclaim the page margins too, otherwise the rows get tighter
 * while the frame around them stays the same and the screen reads no denser.
 */
export default function PageContainer({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={(theme) => ({
        px: { xs: 2, sm: theme.hrms.pageGutterX - 1, md: theme.hrms.pageGutterX },
        py: { xs: 2, sm: theme.hrms.pageGutterY },
        // Clears the chat launcher on mobile, where it sits over the content.
        pb: { xs: 10, sm: 8 },
        width: "100%",
      })}
    >
      {children}
    </Box>
  );
}
