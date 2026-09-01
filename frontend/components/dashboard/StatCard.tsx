"use client";

import type { ReactNode } from "react";

import StatTile from "@/components/common/StatTile";
import type { ModuleKey, StatusKey } from "@/lib/theme/tokens";

type Props = {
  label: string;
  value: number;
  icon?: ReactNode;
  /** MUI palette key, from before the token system existed. */
  color?: "primary" | "secondary" | "success" | "warning" | "error" | "info";
  hint?: string;
  href?: string;
  onClick?: () => void;
};

/**
 * Compatibility shim over `StatTile`.
 *
 * Maps the MUI-palette `color` prop onto `StatTile`'s tones, so pages written
 * against the older API still get the richer tile without each one being
 * migrated by hand.
 *
 * New code should use `StatTile` directly — it also takes a delta and a trend,
 * which is most of the reason the tile exists.
 */
const TONE: Record<NonNullable<Props["color"]>, ModuleKey | StatusKey> = {
  primary: "dashboard",
  secondary: "accent",
  success: "success",
  warning: "warning",
  error: "danger",
  info: "info",
};

export default function StatCard({ label, value, icon, color = "primary", hint, href, onClick }: Props) {
  return (
    <StatTile
      label={label}
      value={value}
      icon={icon}
      tone={TONE[color]}
      hint={hint}
      href={href}
      onClick={onClick}
    />
  );
}
