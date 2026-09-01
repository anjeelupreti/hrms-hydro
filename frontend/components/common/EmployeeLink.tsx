"use client";

import Link from "next/link";
import Typography from "@mui/material/Typography";

import PersonHoverCard from "@/components/common/PersonHoverCard";
import { employeeHref } from "@/lib/employeeProfile";

/**
 * An employee's name, rendered as a link to their profile with a hover card.
 *
 * The card itself lives in `PersonHoverCard` so that components presenting a
 * person as something other than a bare name — a tile, an avatar, a feed row —
 * get the same card without having to render a name to do it. This is now just
 * the text-shaped caller of it.
 *
 * **A real anchor, not a click handler.** This used to open a cut-down drawer,
 * which meant a name in a grid and a card in the roster led to two different
 * views of the same person, and neither could be bookmarked, opened in a new
 * tab, or pasted into a message. See `lib/employeeProfile.ts`.
 */
export default function EmployeeLink({
  id,
  name,
  variant = "body2",
}: {
  id: number | null | undefined;
  name: string;
  variant?: "body2" | "subtitle1" | "subtitle2" | "inherit";
}) {
  if (id == null) return <span>{name}</span>;

  return (
    <PersonHoverCard employeeId={id} name={name}>
      <Typography
        component={Link}
        href={employeeHref(id)}
        variant={variant}
        color="inherit"
        sx={{
          fontWeight: 600,
          cursor: "pointer",
          textDecoration: "none",
          "&:hover": { textDecoration: "underline" },
        }}
        // Stops a row-click handler from firing underneath — these sit inside
        // grid rows that navigate somewhere else entirely. The anchor still
        // does its own job, so ⌘-click and middle-click are unaffected.
        onClick={(e) => e.stopPropagation()}
      >
        {name}
      </Typography>
    </PersonHoverCard>
  );
}
