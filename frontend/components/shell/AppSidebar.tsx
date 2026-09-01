"use client";

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import PersonAvatar from "@/components/common/PersonAvatar";
import InboxIcons from "@/components/shell/InboxIcons";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { activeItem, visibleGroups, type NavItem } from "@/lib/nav";
import { useMe } from "@/hooks/useMe";
import { useMyProfile } from "@/hooks/useProfile";
import { useThemeStore } from "@/lib/store/theme";
import { useUIStore } from "@/lib/store/ui";

export const SIDEBAR_WIDTH = 256;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

/**
 * The single primary navigation.
 *
 * The only navigation surface: grouped sections on desktop, and the same
 * component as a drawer on mobile. Several competing surfaces — a floating
 * nav, an avatar rail, a quick-actions launcher — each end up with their own
 * idea of where things live.
 *
 * Every route comes from `lib/nav.ts`, so the palette and the breadcrumbs
 * cannot disagree with it.
 */
/** What each role is called to the person holding it. Four now, not two. */
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  hr_admin: "HR Admin",
  hr_officer: "HR Officer",
  employee: "Employee",
};

export default function AppSidebar() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const { data: profile } = useMyProfile(Boolean(me?.employee_id));
  const permissions = me?.permissions ?? [];
  // The company mailbox is a settings surface, not everybody's inbox.
  

  const sidebarMode = useThemeStore((s) => s.sidebarMode);
  const setSidebarMode = useThemeStore((s) => s.setSidebarMode);
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);

  const [hovered, setHovered] = useState(false);

  // Built from what this person may actually do. Before this, one flag hid one
  // item and every other row was shown to everybody — so an employee's menu was
  // mostly links to 403 walls, and the product read as broken rather than
  // secure.
  const groups = visibleGroups(permissions);
  const current = activeItem(pathname);

  // In hover mode the rail expands under the pointer. The layout keeps
  // reserving the narrow width (see AppShellLayout), so the page never reflows.
  const collapsed = sidebarMode === "compact" || (sidebarMode === "hover" && !hovered);
  // Floats inset from the window edges instead of sitting flush against them.
  // Full width like Default — this is a different *look*, not a different
  // amount of room, which is why it does not touch `collapsed`.
  const detached = sidebarMode === "detached";

  const displayName = profile?.full_name || me?.username || "—";

  const content = (
    <Stack sx={{ height: "100%", overflowX: "hidden" }}>
      {/* Who you are signed in as. Not an account menu — profile, settings and
          sign-out live in the top-right avatar, and having two doors to the
          same room is how people stop trusting either. */}
      {/* A row: face, name and role beside it, inbox icons at the end — about
          60px. Stacked into a centred column the same three facts and two
          controls take ~160px, which on a 900px laptop is a fifth of the rail
          spent telling you who you are. Collapsed mode keeps the centred
          avatar, because in a 64px rail a row has nowhere to go. */}
      <Box sx={{ px: collapsed ? 0 : 1, pt: 1.5, pb: 1.25 }}>
        <Stack
          direction={collapsed ? "column" : "row"}
          spacing={collapsed ? 1 : 1.25}
          sx={{
            alignItems: "center",
            textAlign: collapsed ? "center" : "left",
            py: collapsed ? 0 : 0.75,
            px: collapsed ? 1 : 1,
            borderRadius: 2.5,
            border: collapsed ? "none" : "1px solid",
            borderColor: "divider",
            bgcolor: collapsed ? "transparent" : "background.default",
          }}
        >
          <Box sx={{ position: "relative", lineHeight: 0, flexShrink: 0 }}>
            {/* No presence dot on your own avatar: the answer is always
                "online", so the dot would be decoration rather than data.
                `PersonAvatar` draws one wherever presence is a real question,
                from the counts `chat/presence.py` keeps in Redis. */}
            <PersonAvatar
              name={displayName}
              photo={profile?.photo}
              size={collapsed ? 34 : 36}
              ring
            />
          </Box>
          {!collapsed && (
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
                {displayName}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ display: "block", lineHeight: 1.3 }}
              >
                {ROLE_LABELS[me?.role ?? "employee"] ?? "Employee"}
              </Typography>
            </Box>
          )}

          {/* Messages and the company mailbox sit under the profile, not in
              the top bar. Both are things that *arrive*, and beside your own
              name an unread count reads as yours — where the top bar is seven
              small controls to hunt through.

              Icons in the identity block, not nav rows: the rail is for
              navigation, so collapsed mode drops them rather than stacking
              them in. */}
          <InboxIcons collapsed={collapsed} />
        </Stack>
      </Box>

      {/* Groups */}
      <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden", pb: 2, borderTop: "1px solid", borderColor: "divider", pt: 1.5 }}>
        {groups.map((group) => (
          <Box key={group.id} sx={{ mb: 1.5 }}>
            {!collapsed ? (
              <Typography
                variant="overline"
                sx={{ display: "block", px: 1.5, mb: 0.5, color: "text.disabled", fontSize: "0.625rem" }}
              >
                {group.label}
              </Typography>
            ) : (
              <Divider sx={{ mx: 1.5, mb: 1 }} />
            )}
            <Stack spacing={0.25}>
              {group.items.map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  active={current?.href === item.href}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              ))}
            </Stack>
          </Box>
        ))}
      </Box>

    </Stack>
  );

  return (
    <>
      {/* Desktop */}
      <Box
        component="nav"
        onMouseEnter={sidebarMode === "hover" ? () => setHovered(true) : undefined}
        onMouseLeave={sidebarMode === "hover" ? () => setHovered(false) : undefined}
        sx={{
          position: "fixed",
          // Inset on all four sides when detached, so the page ground shows
          // around it and it reads as a panel laid on the page rather than as
          // part of the frame.
          top: detached ? 12 : 0,
          left: detached ? 12 : 0,
          bottom: detached ? 12 : 0,
          zIndex: (t) => t.zIndex.appBar + 1,
          width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
          px: collapsed ? 1 : 1.5,
          bgcolor: "background.paper",
          // Flush against the window, one rule on the right divides it from
          // the content. Floating, there is no shared edge to divide — so the
          // border goes all the way round and the corners are rounded.
          border: detached ? "1px solid" : "none",
          borderRight: "1px solid",
          borderRadius: detached ? 3 : 0,
          borderColor: "divider",
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          transition: (t) =>
            `width ${t.hrms.motion.duration.normal}ms ${t.hrms.motion.easing.standard}, padding ${t.hrms.motion.duration.normal}ms ${t.hrms.motion.easing.standard}`,
          // Hover mode floats over the content, so it needs its own shadow to
          // read as a layer rather than as the page shifting.
          // Hover mode floats *over* the content and needs the shadow to read
          // as a layer; detached floats *beside* it and needs a softer one to
          // read as lifted rather than as a modal.
          boxShadow: sidebarMode === "hover" && hovered ? 4 : detached ? 2 : 0,
        }}
      >
        {content}

        <Tooltip title={collapsed ? "Expand sidebar" : "Collapse sidebar"} placement="right">
          <ButtonBase
            onClick={() => setSidebarMode(collapsed ? "default" : "compact")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            sx={{
              position: "absolute",
              top: 26,
              right: -11,
              width: 22,
              height: 22,
              borderRadius: "50%",
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
              color: "text.secondary",
              boxShadow: 1,
              zIndex: 1,
              "&:hover": { bgcolor: "action.hover", color: "text.primary" },
            }}
          >
            <ChevronLeftIcon
              sx={{
                fontSize: 15,
                transition: (t) => `transform ${t.hrms.motion.duration.normal}ms ${t.hrms.motion.easing.standard}`,
                transform: collapsed ? "rotate(180deg)" : "none",
              }}
            />
          </ButtonBase>
        </Tooltip>
      </Box>

      {/* Mobile — the same component, as a drawer. This is what replaced the
          separate FloatingNav, which kept its own copy of the route list. */}
      <Drawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, px: 1.5 } } }}
        sx={{ display: { xs: "block", md: "none" } }}
      >
        {content}
      </Drawer>
    </>
  );
}

function NavRow({
  item,
  collapsed,
  active,
  badgeCount = 0,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  /** Unread count on a nav row. Nothing sets one today — Mail was the only
   *  badged entry and it moved to the top bar — but the row still supports it,
   *  and the next thing that arrives in a *place* rather than an inbox will
   *  want it. */
  badgeCount?: number;
  onNavigate: () => void;
}) {
  // The accent, not the fourteen `MODULE_HUE` colours. Navigation coloured per
  // module reads as decoration rather than structure, whatever the argument for
  // keeping it independent of the company preference.
  //
  // The trade is real and worth stating: the system whose accent is close to
  // grey gets a quieter active state than a module hue would have given it.
  // One coherent palette is worth that. Module hues still identify *content* —
  // page-header tiles, chart series — where being distinct is the job.
  const hue = "var(--mui-palette-primary-main)";
  const Icon = item.icon;

  return (
    <Tooltip title={collapsed ? item.label : ""} placement="right" arrow>
      <ButtonBase
        component={Link}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        sx={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          justifyContent: collapsed ? "center" : "flex-start",
          px: collapsed ? 0 : 1.25,
          py: 0.875,
          borderRadius: 2,
          // **The current page has to be obvious at a glance.** It was
          // `action.selected` — a two-percent grey — plus a 3px bar, which is
          // a hint rather than a statement: on a list of twenty rows you had to
          // hunt for it. Now the row is a filled pill in the module's own hue
          // and the label takes that hue too, so the eye lands on it without
          // reading anything.
          color: active ? hue : "text.secondary",
          fontWeight: active ? 700 : 500,
          bgcolor: active
            ? `color-mix(in srgb, ${hue} 14%, transparent)`
            : "transparent",
          position: "relative",
          transition: (t) => `background-color ${t.hrms.motion.duration.fast}ms ${t.hrms.motion.easing.standard}`,
          "&:hover": { bgcolor: "action.hover", color: "text.primary" },
          // The marker takes the accent too, so the whole row is one colour.
          "&::before": active
            ? {
                content: '""',
                position: "absolute",
                left: collapsed ? 4 : 0,
                top: "50%",
                transform: "translateY(-50%)",
                width: 3,
                height: 18,
                borderRadius: 99,
                bgcolor: hue,
              }
            : undefined,
        }}
      >
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: 1.5,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // Solid, not tinted. The icon tile is the strongest signal
            // available in a row this size, and a second faint wash beside a
            // faint pill reads as one indistinct smudge.
            bgcolor: active ? hue : "transparent",
            color: active ? "#fff" : "inherit",
          }}
        >
          {/* Collapsed to a rail there is no label to carry the count, so the
              badge rides the icon instead. */}
          <Badge
            variant={collapsed ? "dot" : "standard"}
            badgeContent={collapsed ? undefined : 0}
            invisible={badgeCount === 0}
            color="error"
            overlap="circular"
          >
            <Icon sx={{ fontSize: 19 }} />
          </Badge>
        </Box>
        {!collapsed && (
          <>
            <Typography variant="body2" sx={{ fontWeight: "inherit", flex: 1 }} noWrap>
              {item.label}
            </Typography>
            {badgeCount > 0 && (
              <Box
                sx={{
                  minWidth: 20,
                  height: 20,
                  px: 0.5,
                  borderRadius: 99,
                  bgcolor: "error.main",
                  color: "error.contrastText",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {badgeCount > 99 ? "99+" : badgeCount}
              </Box>
            )}
          </>
        )}
      </ButtonBase>
    </Tooltip>
  );
}
