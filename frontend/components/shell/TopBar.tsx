"use client";

import NotificationsIcon from "@mui/icons-material/Notifications";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import PersonIcon from "@mui/icons-material/Person";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";

import PersonAvatar from "@/components/common/PersonAvatar";
import AmountPrivacyToggle from "@/components/shell/AmountPrivacyToggle";
import ColorModeToggle from "@/components/shell/ColorModeToggle";
import { PRODUCT_NAME } from "@/lib/product";

import LiveTrace from "@/components/attendance/LiveTrace";
import { useMyTodayAttendance } from "@/hooks/useAttendance";
import LocaleStrip from "@/components/shell/LocaleStrip";
import CampaignIcon from "@mui/icons-material/Campaign";
import IconButton from "@mui/material/IconButton";
import NotificationBell from "@/components/notifications/NotificationBell";
import { useThemeStore } from "@/lib/store/theme";
import { useCompanyProfile } from "@/hooks/useOrganization";
import { useMe } from "@/hooks/useMe";
import { useUIStore } from "@/lib/store/ui";
import { useMyProfile } from "@/hooks/useProfile";

export const TOPBAR_HEIGHT = 64;

export default function TopBar() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: profile } = useMyProfile(Boolean(me?.employee_id));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { data: todayAttendance } = useMyTodayAttendance();
  const clockedIn = Boolean(todayAttendance?.is_clocked_in);
  const setPaletteOpen = useUIStore((s) => s.setPaletteOpen);
  const { data: company } = useCompanyProfile();
  const tintedTopBar = useThemeStore((s) => s.tintedTopBar);

  async function handleLogout() {
    setAnchor(null);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <Box
      component="header"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 1100,
        height: TOPBAR_HEIGHT,
        minHeight: TOPBAR_HEIGHT,
        px: { xs: 2, md: 3 },
        display: { xs: "none", md: "flex" },
        alignItems: "center",
        gap: 1,
        // `theme.vars.*`, never `theme.palette.*`. With cssVariables enabled,
        // reading `theme.palette` in an sx callback resolves against the
        // *default* scheme and bakes a literal — which is why this bar stayed
        // white in dark mode while every string token around it followed.
        bgcolor: (t) =>
          tintedTopBar
            ? `color-mix(in srgb, ${t.vars.palette.primary.main} 7%, ${t.vars.palette.background.paper})`
            : t.vars.palette.background.paper,
        borderBottom: "1px solid",
        borderColor: "divider",
        transition: (t) => `background-color ${t.hrms.motion.duration.normal}ms ${t.hrms.motion.easing.standard}`,
      }}
    >
      {/* Whose workspace this is, then the product. On a multi-company system
          the company name is the more useful half — it is what tells you that
          you are in Acme and not Globex. The sidebar's own collapse control
          stays in the sidebar. */}
      <Box
        component={Link}
        href="/dashboard"
        sx={{ display: "flex", alignItems: "center", gap: 1.25, textDecoration: "none", minWidth: 0, mr: 2 }}
      >
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: 1.5,
            flexShrink: 0,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          {(company?.name ?? " ").slice(0, 1).toUpperCase()}
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", minWidth: 0 }}>
          {/* The name arrives client-side, so hold its space with a skeleton
              rather than a dash — a placeholder that looks like a value is
              worse than one that looks like loading. */}
          {company ? (
            <Typography variant="subtitle1" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }} noWrap>
              {company.name}
            </Typography>
          ) : (
            <Skeleton variant="text" width={104} sx={{ fontSize: "1rem" }} />
          )}
          <Typography variant="body2" sx={{ color: "text.disabled" }}>
            |
          </Typography>
          {/* Keeps the "company | product" pattern — the company name is still
              the half that tells you which workspace you are in. */}
          <Typography variant="body2" sx={{ fontWeight: 700, color: "text.secondary" }} noWrap>
            {PRODUCT_NAME}
          </Typography>
        </Stack>
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* Not an input: it opens the ⌘K palette. A search field that only
          searched employees, sitting above every page, promised more than it
          did — this goes everywhere and says so. */}
      <Stack
        component="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search (Ctrl K)"
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          width: { md: 200, lg: 260 },
          px: 1.5,
          py: 0.75,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 999,
          bgcolor: "action.hover",
          cursor: "pointer",
          font: "inherit",
          color: "text.secondary",
          transition: (t) => `border-color ${t.hrms.motion.duration.fast}ms ${t.hrms.motion.easing.standard}`,
          "&:hover": { borderColor: "text.disabled" },
        }}
      >
        <SearchIcon fontSize="small" />
        <Typography variant="body2" sx={{ flex: 1, textAlign: "left" }}>
          Search…
        </Typography>
        <Box
          component="kbd"
          sx={{
            px: 0.75,
            py: 0.125,
            borderRadius: 1,
            border: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            fontFamily: "inherit",
            fontSize: "0.6875rem",
          }}
        >
          Ctrl K
        </Box>
      </Stack>

      {/* The trace follows you off the attendance page. Knowing the clock is
          still running matters most when you are somewhere else and have
          forgotten — which is exactly where the clock widget cannot help. */}
      {clockedIn ? (
        <Tooltip title="Clocked in">
          <Box
            sx={{
              color: "success.main",
              lineHeight: 0,
              mr: 0.5,
              display: { xs: "none", sm: "block" },
            }}
          >
            <LiveTrace width={64} height={22} />
          </Box>
        </Tooltip>
      ) : null}

      {/* Weather, date and time — English and Nepali. Sits after search and
          before the controls, and hides itself on a narrow window so it never
          competes with the search target. */}
      <LocaleStrip />

      {/* Beside the colour-mode toggle because it is the same kind of thing:
          a per-viewer display preference belonging to the person and the
          device. Without it the "hide amounts" default was permanent — see
          `AmountPrivacyToggle`. */}
      {/* **Posting a notice is a quick action, not a page you navigate to.**
          The things people most need to broadcast — the lift is out, the road
          is closed, the server is down at four — are the ones they will not
          go looking for a page to write. It sits beside the bell because that
          is where the other "tell somebody something" controls are. */}
      <Tooltip title="Post an announcement">
        <IconButton component={Link} href="/announcements?compose=1" size="small">
          <CampaignIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <AmountPrivacyToggle />
      <ColorModeToggle />
      {/* No messages or mailbox here: they live in the sidebar under the
          profile card. One home, not two — a duplicated inbox is how a count
          ends up disagreeing with itself. See `InboxIcons`. */}
      <NotificationBell />

      <Tooltip title="Account">
        <Box
          component="button"
          onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
          sx={{ border: 0, bgcolor: "transparent", p: 0.5, cursor: "pointer", borderRadius: 999 }}
        >
          {/* The same avatar every other screen draws for this person. It was
              a bare `Avatar` on `secondary.main`, so the one face shown on
              every page was the only one not following the shared rules. */}
          <PersonAvatar
            name={profile?.full_name || me?.username || "?"}
            photo={profile?.photo}
            size={34}
          />
        </Box>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2" noWrap>
            {profile?.full_name || me?.username}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {me?.email}
          </Typography>
        </Box>
        <Divider />
        <MenuItem component={Link} href="/profile" onClick={() => setAnchor(null)}>
          <ListItemIcon>
            <PersonIcon fontSize="small" />
          </ListItemIcon>
          My Profile
        </MenuItem>
        <MenuItem component={Link} href="/notifications" onClick={() => setAnchor(null)}>
          <ListItemIcon>
            <NotificationsIcon fontSize="small" />
          </ListItemIcon>
          Notifications
        </MenuItem>
        <MenuItem component={Link} href="/settings" onClick={() => setAnchor(null)}>
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          Settings
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Log out
        </MenuItem>
      </Menu>
    </Box>
  );
}
