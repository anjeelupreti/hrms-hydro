"use client";

import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import RemoveIcon from "@mui/icons-material/Remove";
import Box from "@mui/material/Box";

type Props = {
  /** Percentage change. `12.4` renders as "+12.4%". */
  value: number;
  /** What the change is measured against — read by screen readers. */
  comparedTo?: string;
  /**
   * When true, a fall is the good outcome (late arrivals, overdue tickets,
   * attrition). Without this, "-16% late arrivals" would render red for an
   * improvement, which is worse than showing no colour at all.
   */
  lowerIsBetter?: boolean;
  size?: "small" | "medium";
};

/**
 * The change beside a number.
 *
 * A figure on its own says what is; a figure with a delta says what is
 * happening. It is the cheapest way to make a dashboard tile worth reading,
 * and it is why the reference tiles carry five pieces of information where
 * ours carried two.
 */
export default function DeltaBadge({ value, comparedTo, lowerIsBetter = false, size = "small" }: Props) {
  const flat = Math.abs(value) < 0.05;
  const rising = value > 0;
  const good = flat ? null : lowerIsBetter ? !rising : rising;

  const tone = good === null ? "neutral" : good ? "success" : "danger";
  const Icon = flat ? RemoveIcon : rising ? ArrowUpwardIcon : ArrowDownwardIcon;

  const label = flat
    ? "No change"
    : `${rising ? "Up" : "Down"} ${Math.abs(value).toFixed(1)} percent${comparedTo ? ` compared to ${comparedTo}` : ""}`;

  return (
    <Box
      component="span"
      role="img"
      aria-label={label}
      title={comparedTo ? `vs ${comparedTo}` : undefined}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.25,
        px: size === "small" ? 0.625 : 0.875,
        py: size === "small" ? 0.125 : 0.375,
        borderRadius: 99,
        fontSize: size === "small" ? "0.6875rem" : "0.75rem",
        fontWeight: 700,
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        color: `var(--hrms-status-${tone}-fg)`,
        bgcolor: `var(--hrms-status-${tone}-bg)`,
        border: "1px solid",
        borderColor: `var(--hrms-status-${tone}-border)`,
      }}
      className="hrms-num"
    >
      <Icon sx={{ fontSize: size === "small" ? 12 : 14 }} aria-hidden />
      {flat ? "0%" : `${rising ? "+" : "−"}${Math.abs(value).toFixed(1)}%`}
    </Box>
  );
}
