"use client";

import MoreVertIcon from "@mui/icons-material/MoreVert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  /** Right-hand controls — usually a PeriodSelector, sometimes a link. */
  action?: ReactNode;
  /** Renders an overflow button when provided. */
  onMenu?: (anchor: HTMLElement) => void;
  children: ReactNode;
  /** Turn off the body padding for tables and charts that manage their own. */
  disableGutters?: boolean;
};

/**
 * A titled card with a header row.
 *
 * The header is the point. It is where a card's own period selector lives, so
 * one card can be re-scoped without disturbing the rest of the screen — and it
 * is one header, so a row of cards shares a height and a baseline. Hand-rolled
 * `<Typography variant="subtitle1">` and ad-hoc spacing is why no two line up.
 */
export default function SectionCard({
  title,
  subtitle,
  action,
  onMenu,
  children,
  disableGutters = false,
}: Props) {
  return (
    <Card sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          px: 2.5,
          py: 1.75,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexShrink: 0 }}>
          {action}
          {onMenu && (
            <IconButton size="small" onClick={(e) => onMenu(e.currentTarget)} aria-label={`${title} options`}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      </Stack>
      <Box sx={{ flex: 1, p: disableGutters ? 0 : 2.5, minWidth: 0 }}>{children}</Box>
    </Card>
  );
}
