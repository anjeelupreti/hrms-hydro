"use client";

import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import MenuIcon from "@mui/icons-material/Menu";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import PersonIcon from "@mui/icons-material/Person";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";

import NotificationBell from "@/components/notifications/NotificationBell";
import ColorModeToggle from "@/components/shell/ColorModeToggle";
import { useMe } from "@/hooks/useMe";
import { PRODUCT_NAME, PRODUCT_SHORT } from "@/lib/product";
import { useUIStore } from "@/lib/store/ui";
import { useMyProfile } from "@/hooks/useProfile";

/**
 * Slim sticky top bar shown only on xs/sm screens (hidden md+).
 * Provides logo, notification bell, and avatar/account menu on mobile.
 */
export default function MobileTopBar() {
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);
  const router = useRouter();
  const { data: me } = useMe();
  const { data: profile } = useMyProfile(Boolean(me?.employee_id));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const initials = (profile?.full_name || me?.username || "?").slice(0, 2).toUpperCase();

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
        display: { xs: "flex", md: "none" },
        alignItems: "center",
        px: 2,
        height: 56,
        bgcolor: "background.paper",
        borderBottom: "1px solid",
        borderColor: "divider",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Opens the sidebar as a drawer. This is what replaced FloatingNav —
          mobile now navigates from the same component and the same route list
          as desktop, instead of a second one that drifted. */}
      <IconButton
        onClick={() => setMobileNavOpen(true)}
        edge="start"
        aria-label="Open navigation"
        sx={{ mr: 1 }}
      >
        <MenuIcon />
      </IconButton>

      {/* Logo */}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: 1 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: 1.5,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          {PRODUCT_SHORT.charAt(0)}
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }} color="primary.main">
          {PRODUCT_NAME}
        </Typography>
      </Stack>

      {/* Right actions */}
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        <ColorModeToggle />
        <NotificationBell />
        <IconButton
          size="small"
          onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
          sx={{ p: 0.5 }}
        >
          <Avatar
            src={profile?.photo ?? undefined}
            sx={{ width: 30, height: 30, fontSize: 12, bgcolor: "secondary.main" }}
          >
            {initials}
          </Avatar>
        </IconButton>
      </Stack>

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
          <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
          My Profile
        </MenuItem>
        <MenuItem component={Link} href="/settings" onClick={() => setAnchor(null)}>
          <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
          Settings
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleLogout}>
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          Log out
        </MenuItem>
      </Menu>
    </Box>
  );
}
