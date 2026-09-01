"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";

import IconDisc from "@/components/common/IconDisc";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import { moduleFor } from "@/lib/nav";
import { roleLabel, useMe } from "@/hooks/useMe";

type Props = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  /**
   * Which module this page belongs to — "PAYROLL", "PEOPLE".
   *
   * Part of the orientation band. Falls back to the breadcrumb trail's own
   * grouping when omitted, but pass it: a page that cannot say which module it
   * is in usually means the nav model is missing it.
   */
  module?: string;
  /** Whose view this is — "HR ADMIN", "MANAGER". Omit for everyone-pages. */
  role?: string;
  /** Suppress today's date where it is meaningless (settings, directories). */
  hideDate?: boolean;
  /**
   * What to call the record in the breadcrumb, when the route ends in an id.
   *
   * Without it the trail ends on "Detail" — honest, and useless, because every
   * record page in the product ends on the same word. Only the page knows it
   * is showing "CG Digital Project".
   */
  recordLabel?: string;
};

/**
 * One page header for the whole app: an icon tile with title and subtitle on
 * the left, page actions on the right. Every page uses it rather than its own
 * `<Typography variant="h4">`, so no two headers sit at different heights.
 *
 * The notification bell lives in the global TopBar, not here.
 */
/** The date never changes under us mid-session, so there is nothing to watch. */
function subscribeToNothing() {
  return () => {};
}

/** Cached: `getSnapshot` must return a stable reference or React loops. */
let todayCache: string | null = null;
function getToday() {
  if (todayCache === null) {
    todayCache = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }
  return todayCache;
}

export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  module: moduleName,
  role,
  hideDate = false,
  recordLabel,
}: Props) {
  // Client-only. Formatting a date during SSR and again in the browser is the
  // classic hydration mismatch — the server may be on a different day, or a
  // different locale, from the person reading.
  //
  // `useSyncExternalStore` rather than setState-in-an-effect: the effect form
  // schedules a second render on every mount and trips
  // react-hooks/set-state-in-effect. Same pattern as the theme customiser and
  // the DataTable column store.
  const today = useSyncExternalStore(subscribeToNothing, getToday, () => null);

  // Derived from the nav model unless the caller overrides, so a route that
  // moves groups updates its own header.
  const pathname = usePathname();
  const { data: me } = useMe();
  const resolvedModule = moduleName ?? moduleFor(pathname);
  // Only shown for roles that mean something in the orientation band. An
  // employee already knows they are one; the band is there to say *which hat
  // you are wearing* when you could be wearing more than one.
  const resolvedRole =
    role ?? (me && me.role !== "employee" ? roleLabel(me.role) : undefined);

  const band = [hideDate ? null : today, resolvedModule, resolvedRole].filter(Boolean) as string[];

  return (
    <Box component="header" sx={{ mb: 3 }}>
      <Breadcrumbs recordLabel={recordLabel} />

      {/* Orientation band: where you are, whose view this is, and when.
          This is the piece that made the difference between our screens and a
          polished one — every page there opens by telling you where you stand
          before it shows you anything. A dot separator rather than a row of
          chips: it is context, not controls. */}
      {band.length > 0 && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, mb: 0.75 }}
        >
          {band.map((part, i) => (
            <Stack key={part} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              {i > 0 && (
                <Box aria-hidden sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: "text.disabled" }} />
              )}
              <Typography variant="overline" sx={{ color: "text.secondary" }}>
                {part}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
      {/*
        The title wins. It is what tells somebody which page they are on, so it
        holds a floor width and the actions wrap beneath it. With `flexShrink: 0`
        on the actions and `minWidth: 0` on the title, a page carrying six of
        them squeezes its heading to "Pa…" down a column of single letters and
        still pushes the last button off the right edge.
      */}
      <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{
        justifyContent: "space-between",
        alignItems: { sm: "center" },
        flexWrap: "wrap",
        rowGap: 1.5,
      }}
    >
      <Stack
        direction="row"
        spacing={1.75}
        sx={{ alignItems: "center", minWidth: { sm: 220 }, flex: "1 1 auto" }}
      >
        {/* `solid` — this is the screen's identity mark, and there is exactly
            one of them. See `IconDisc` for the rule the three variants follow. */}
        {icon && <IconDisc variant="solid" size={44} sx={{ display: { xs: "none", sm: "flex" } }}>{icon}</IconDisc>}
        {icon && <IconDisc variant="solid" size={36} sx={{ display: { xs: "flex", sm: "none" } }}>{icon}</IconDisc>}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1" sx={{ lineHeight: 1.15 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
      </Stack>

      {actions && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            alignItems: "center",
            flexWrap: "wrap",
            // Wraps under the title rather than crushing it. `flexShrink: 0`
            // here was what stopped a crowded header from ever giving way.
            justifyContent: { sm: "flex-end" },
          }}
        >
          {actions}
        </Stack>
      )}
      </Stack>
    </Box>
  );
}
