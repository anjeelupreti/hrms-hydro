"use client";

import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useState } from "react";

export type Period = "today" | "week" | "month" | "quarter" | "year" | "all";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
];

type Props = {
  value: Period;
  onChange: (period: Period) => void;
  /** Trim the list where a period makes no sense — payroll has no "today". */
  options?: Period[];
  size?: "small" | "medium";
};

/**
 * The period a card or page is scoped to.
 *
 * Deliberately per-card, not only per-page: the reference gets a lot of value
 * from letting one card be re-scoped without disturbing the rest of the screen,
 * and it costs nothing to allow.
 *
 * **Phase 2 note:** the labels here are Gregorian-relative. Once the calendar
 * layer lands this must offer Nepali fiscal periods (Shrawan, Q1 2083/84) and
 * read the company's lead calendar. The `Period` union is the seam — widen it
 * there rather than adding a second component.
 */
export default function PeriodSelector({ value, onChange, options, size = "small" }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const list = options ? PERIODS.filter((p) => options.includes(p.value)) : PERIODS;
  const current = PERIODS.find((p) => p.value === value);

  return (
    <>
      <Button
        size={size}
        onClick={(e) => setAnchor(e.currentTarget)}
        startIcon={<CalendarMonthIcon />}
        endIcon={<ExpandMoreIcon />}
        sx={{ color: "text.secondary", borderColor: "divider", whiteSpace: "nowrap" }}
        variant="outlined"
        aria-haspopup="listbox"
      >
        {current?.label ?? "Period"}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {list.map((p) => (
          <MenuItem
            key={p.value}
            selected={p.value === value}
            onClick={() => {
              onChange(p.value);
              setAnchor(null);
            }}
          >
            {p.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
