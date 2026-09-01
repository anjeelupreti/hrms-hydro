"use client";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { motion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";

import AnimatedNumber from "@/components/dashboard/AnimatedNumber";
import DeltaBadge from "@/components/common/DeltaBadge";
import Sparkline from "@/components/common/Sparkline";
import { MODULE_HUE, type ModuleKey, type StatusKey } from "@/lib/theme/tokens";

type Props = {
  label: string;
  /** Numbers count up; strings (money, ratios like "8.4 / 9") render as given. */
  value: number | string;
  icon?: ReactNode;
  /** Colours the icon tile and the sparkline. Module hue, or a status tone. */
  tone?: ModuleKey | StatusKey;
  /** Percentage change against the previous period. */
  delta?: { value: number; comparedTo?: string; lowerIsBetter?: boolean };
  /** Oldest → newest. Rendered as an inline sparkline. */
  trend?: number[];
  /** One short line under the value — "42% of staff", "Latest March 2026". */
  hint?: string;
  href?: string;
  onClick?: () => void;
  loading?: boolean;
  /** Paints the whole tile in the tone, for boards where each counter is a status. */
  filled?: boolean;
};

const STATUS_KEYS = ["success", "warning", "danger", "info", "neutral", "accent"] as const;

function isStatus(tone: string): tone is StatusKey {
  return (STATUS_KEYS as readonly string[]).includes(tone);
}

/**
 * The dashboard tile: icon, value, label, and — where the data supports them
 * — a delta against the previous period and a trend sparkline.
 *
 * The delta and the trend are the point. A row of bare counters says every
 * figure matters equally, which tells the reader nothing about where to look;
 * a figure that carries its own direction does. Status tinting serves the same
 * end, so a board of counters reads at a glance rather than as a grey row.
 */
export default function StatTile({
  label,
  value,
  icon,
  tone = "dashboard",
  delta,
  trend,
  hint,
  href,
  onClick,
  loading = false,
  filled = false,
}: Props) {
  const status = isStatus(tone);
  // Two forms, because they are consumed differently. `hue` may be a CSS custom
  // property, which is fine anywhere CSS resolves it (color, background) but
  // *not* inside MUI's `alpha()` — that parses the string in JS and throws on
  // `var(…)`. Anything needing transparency uses `hueSoft`, which is a real
  // colour on both branches.
  const hue = status ? `var(--hrms-status-${tone}-solid)` : MODULE_HUE[tone as ModuleKey];
  const hueSoft = status
    ? `var(--hrms-status-${tone}-border)`
    : alpha(MODULE_HUE[tone as ModuleKey], 0.5);
  const interactive = Boolean(href || onClick);

  const body = (
    <Card
      sx={(theme) => ({
        height: "100%",
        p: theme.hrms.cardPadding / 8,
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        position: "relative",
        overflow: "hidden",
        ...(filled && status
          ? {
              bgcolor: `var(--hrms-status-${tone}-bg)`,
              borderColor: `var(--hrms-status-${tone}-border)`,
            }
          : {}),
      })}
    >
      {/* A small mono label, then the number as the hero. The icon is a mark
          within the label line, sized to the text — at slab size it outweighs
          the figure it labels, and a row of them reads as a toolbar. */}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
        {icon && (
          <Box
            aria-hidden
            sx={{
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              color: hue,
              "& svg": { fontSize: 15 },
            }}
          >
            {icon}
          </Box>
        )}
        <Typography
          variant="overline"
          sx={{ color: "text.secondary", minWidth: 0, display: "block" }}
          noWrap
          title={label}
        >
          {label}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end", justifyContent: "space-between" }}>
        <Box sx={{ minWidth: 0 }}>
          {loading ? (
            <Skeleton variant="text" width={72} sx={{ fontSize: "1.9rem" }} />
          ) : (
            <Typography
              className="hrms-display-num"
              sx={{
                fontSize: { xs: "1.9rem", md: "2.15rem" },
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.035em",
              }}
            >
              {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
            </Typography>
          )}
          {(hint || delta) && (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mt: 0.75, flexWrap: "wrap" }}>
              {delta && !loading && (
                <DeltaBadge value={delta.value} comparedTo={delta.comparedTo} lowerIsBetter={delta.lowerIsBetter} />
              )}
              {hint && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {hint}
                </Typography>
              )}
            </Stack>
          )}
        </Box>

        {trend && trend.length > 1 && !loading && (
          <Box sx={{ color: hue, flexShrink: 0, pb: 0.5 }}>
            <Sparkline data={trend} label={`${label} trend`} />
          </Box>
        )}
      </Stack>
    </Card>
  );

  if (!interactive) return body;

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      style={{ height: "100%" }}
    >
      <ButtonBase
        component={href ? Link : "button"}
        href={href as string}
        onClick={onClick}
        sx={{
          width: "100%",
          height: "100%",
          display: "block",
          textAlign: "left",
          borderRadius: 3, // matches the Card it wraps
          "&:hover .MuiCard-root": { borderColor: hueSoft },
        }}
      >
        {body}
      </ButtonBase>
    </motion.div>
  );
}
