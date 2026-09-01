"use client";

import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import type { PortalSummary } from "@/hooks/usePortal";

/**
 * The employee's own ID card, at the top of their workspace.
 *
 * **The system should open by saying who you are.** The page led with a
 * payslip figure and a row of counters — true, but the same shape as every
 * other screen in the product. An ID card is the one object on this page that
 * belongs to *the person* rather than to the company's record of them, and it
 * is the thing they would recognise if it were printed and hung round a neck.
 *
 * **Portrait, with a lanyard slot and a signature band**, because those are
 * what make a rectangle read as a badge rather than as another panel. The card
 * carries only what a real one does: photo, name, position, code, department,
 * joined. Everything else on this page is a metric; this is an identity.
 *
 * **The accent gradient, not a fixed colour.** A card painted a chosen violet
 * would be the one element on the page ignoring the company's own accent —
 * the exact defect the theme's `deriveGradients` exists to prevent.
 */

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{ fontSize: 9, letterSpacing: ".08em", color: "text.disabled", fontWeight: 700 }}
      >
        {label.toUpperCase()}
      </Typography>
      <Typography sx={{ fontSize: 12.5, fontWeight: 650 }} noWrap title={value}>
        {value}
      </Typography>
    </Box>
  );
}

export default function StaffIdCard({
  me,
  photo,
}: {
  me: PortalSummary["me"];
  photo?: string | null;
}) {
  const joined = new Date(me.date_joined).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <Box
      sx={{
        width: 268,
        flexShrink: 0,
        borderRadius: 3.5,
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        boxShadow: 2,
      }}
    >
      {/* The lanyard slot. Two millimetres of detail that does most of the work
          of saying "badge" — without it this is a panel with a photo in it. */}
      <Box
        sx={{
          background: "var(--hrms-gradient-celebration)",
          pt: 1.25,
          pb: 4.5,
          position: "relative",
        }}
      >
        <Box
          sx={{
            width: 54,
            height: 7,
            mx: "auto",
            borderRadius: 999,
            bgcolor: "rgba(0,0,0,.28)",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,.4)",
          }}
        />
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ position: "absolute", top: 10, right: 12, alignItems: "center" }}
        >
          <BadgeOutlinedIcon sx={{ fontSize: 14, color: "rgba(255,255,255,.85)" }} />
          <Typography sx={{ fontSize: 9.5, fontWeight: 800, color: "rgba(255,255,255,.85)", letterSpacing: ".08em" }}>
            STAFF ID
          </Typography>
        </Stack>
      </Box>

      <Box sx={{ px: 2.25, pb: 2.25, mt: -4.5, textAlign: "center" }}>
        <Avatar
          src={photo ?? undefined}
          sx={{
            width: 76,
            height: 76,
            mx: "auto",
            fontSize: 26,
            fontWeight: 700,
            border: "4px solid",
            borderColor: "background.paper",
            boxShadow: 1,
          }}
        >
          {initials(me.name)}
        </Avatar>

        <Typography sx={{ fontWeight: 800, fontSize: 16, mt: 1, lineHeight: 1.25 }} noWrap>
          {me.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
          {me.designation ?? "—"}
        </Typography>

        {me.on_probation ? (
          <Chip size="small" label="On probation" color="warning" sx={{ mt: 1, height: 20, fontSize: 10.5 }} />
        ) : null}

        {/* The facts a badge carries, two to a row. Left-aligned inside a
            centred card because a label/value pair read as a column is a form,
            and a badge is not a form. */}
        <Box
          sx={{
            mt: 2,
            pt: 1.75,
            borderTop: "1px dashed",
            borderColor: "divider",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 1.5,
            textAlign: "left",
          }}
        >
          <Line label="ID" value={me.employee_code} />
          <Line label="Department" value={me.department ?? "—"} />
          <Line label="Joined" value={joined} />
          <Line
            label="Service"
            value={
              me.tenure_years > 0
                ? `${me.tenure_years} yr${me.tenure_years > 1 ? "s" : ""}`
                : `${me.tenure_days} days`
            }
          />
        </Box>

        {/* A signature strip. Decorative, and deliberately not pretending to
            hold a real signature — there is no signature on file and drawing a
            fake one would be a small lie on an identity document. */}
        <Box
          sx={{
            mt: 2,
            height: 26,
            borderRadius: 1,
            bgcolor: "action.hover",
            display: "flex",
            alignItems: "center",
            px: 1,
          }}
        >
          <Typography sx={{ fontSize: 9, letterSpacing: ".1em", color: "text.disabled", fontWeight: 700 }}>
            {me.email}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
