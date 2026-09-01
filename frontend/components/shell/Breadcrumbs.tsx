"use client";

import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import MuiBreadcrumbs from "@mui/material/Breadcrumbs";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { breadcrumbsFor } from "@/lib/nav";

/**
 * Where you are, derived from the route rather than passed down by each page —
 * so a new page gets a correct trail without doing anything, and no page can
 * claim a position it does not have.
 *
 * Renders nothing at the top level: a single crumb is the page title repeated.
 *
 * `recordLabel` names the last crumb when the route ends in a database id.
 * Without it those render as "Detail", which is honest and useless — every
 * record page in the product ended on the same word. Only the page knows it is
 * showing "CG Digital Project", so only the page can say.
 */
export default function Breadcrumbs({ recordLabel }: { recordLabel?: string } = {}) {
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname, recordLabel);

  if (crumbs.length === 0) return null;

  return (
    <MuiBreadcrumbs
      separator={<NavigateNextIcon sx={{ fontSize: 15 }} />}
      aria-label="Breadcrumb"
      sx={{
        mb: 1,
        "& .MuiBreadcrumbs-separator": { mx: 0.5, color: "text.disabled" },
        "& a": { color: "text.secondary", textDecoration: "none", "&:hover": { color: "text.primary" } },
      }}
    >
      {crumbs.map((crumb) =>
        crumb.href ? (
          <Typography key={crumb.href} component={Link} href={crumb.href} variant="caption">
            {crumb.label}
          </Typography>
        ) : (
          <Typography key={crumb.label} variant="caption" color="text.primary" sx={{ fontWeight: 600 }}>
            {crumb.label}
          </Typography>
        )
      )}
    </MuiBreadcrumbs>
  );
}
