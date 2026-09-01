"use client";

import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import NextLink from "next/link";
import type { ReactNode } from "react";

/**
 * A person, as a card.
 *
 * Used in three places — the dashboard's birthday and joiner strips and the
 * employee list's card view — because they are all the same object, and three
 * different ideas of what a person's card looks like is a cost paid by the
 * reader.
 *
 * A light card, deliberately, and with no barcode. Three constraints shape it:
 *
 * * **No near-black body.** A near-black block is the heaviest thing that can
 *   go on a page, and a roster is a *wall* of these — forty of them turn the
 *   employee list into a grid of dark slabs. A card about a person should not
 *   be the loudest object on the screen.
 * * **No barcode.** Drawn from a hash of the employee code, it is to
 *   say it was a picture of a barcode and not a barcode: nothing would scan it,
 *   because the product issues no such code. A graphic that implies a
 *   capability the product does not have is a small lie on every card.
 * * **The size.** Asked for twice.
 *
 * So: a light card with the accent carrying the identity, the photograph as the
 * subject, and the employee code as what it actually is — text. The structure
 * the owner asked for survives; the costume does not.
 */

export type StaffFact = { label: string; value: ReactNode };

export type StaffCardTone =
  /** The everyday card. */
  | "default"
  /**
   * Brighter, for an occasion happening **today**.
   *
   * The owner's rule, and it is a good one: a birthday three weeks out and a
   * birthday this morning are different facts, and colouring them the same
   * means the one you could act on has to be found by reading dates. Only
   * today gets the accent treatment; everyone else gets the ordinary card.
   */
  | "celebrate";

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Bigger, twice over.
 *
 * The strips sit in third-width dashboard columns of about 380px, so 200 fits
 * one whole card and most of a second — which is the right trade now that the
 * cards carry more: two at a readable size beats three cramped ones, and the
 * strip scrolls.
 */
const CARD_WIDTH = 200;

export default function StaffCard({
  name,
  photo,
  role,
  code,
  facts = [],
  maxFacts = 3,
  tone = "default",
  badge,
  width,
  href,
  onOpen,
}: {
  name: string;
  photo?: string | null;
  /** The post. Shown as the chip under the name. */
  role?: string | null;
  /** Employee code — shown as text in the footer, where it is legible. */
  code?: string | null;
  /** Up to three `label · value` rows. More than three and the card is a form. */
  facts?: StaffFact[];
  /**
   * How many facts the card will show.
   *
   * Three suits the dashboard's scrolling strips, which are narrow and are
   * scanned rather than read. A full-width roster card has room for more, and
   * capping it there made the card view show *less* than the table beside it —
   * which is the one thing a card view has no excuse for.
   */
  maxFacts?: number;
  tone?: StaffCardTone;
  /** Top-right of the header — "Today", "in 6d", a status. */
  badge?: ReactNode;
  /** Fixed width for a scrolling strip; omit to fill a grid cell. */
  width?: number;
  /**
   * Where the card goes. **Prefer this over `onOpen`.**
   *
   * The whole card becomes a real anchor, so middle-click, ⌘-click and "copy
   * link address" all work — none of which a click handler gives you, and all
   * of which people expect from a row that navigates. `onOpen` stays for the
   * cases where there is no address to link to.
   */
  href?: string;
  onOpen?: () => void;
}) {
  const celebrate = tone === "celebrate";
  const rows = facts.slice(0, maxFacts);
  const interactive = Boolean(href || onOpen);

  return (
    <Box
      // An anchor where there is an address, a button where there is only a
      // handler, and a plain div otherwise. `NextLink` rather than a bare `a`
      // so the navigation is client-side like every other link in the app.
      component={href ? NextLink : onOpen ? "button" : "div"}
      href={href as string}
      onClick={onOpen}
      sx={{
        width: width ?? "100%",
        flexShrink: 0,
        p: 0,
        font: "inherit",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 3,
        border: "1px solid",
        // The accent is carried by the border and the header on a celebrate
        // card, rather than by filling the whole thing.
        borderColor: celebrate ? "primary.main" : "divider",
        bgcolor: "background.paper",
        cursor: interactive ? "pointer" : "default",
        // An anchor brings its own colour and underline; the card supplies its
        // own, so both are cleared rather than left to fight the theme.
        color: "inherit",
        textDecoration: "none",
        transition: "transform .2s, box-shadow .2s, border-color .2s",
        "&:hover": interactive
          ? { transform: "translateY(-3px)", boxShadow: 4, borderColor: "primary.main" }
          : undefined,
      }}
    >
      {/* ── Header: a band of accent, and the photograph on the seam ───── */}
      <Box
        sx={{
          position: "relative",
          height: 76,
          flexShrink: 0,
          background: (t: Theme) =>
            celebrate
              ? // Today's birthday: the full accent, which is the one card on
                // the page that should catch the eye.
                `linear-gradient(135deg, ${t.vars.palette.primary.main}, ${t.vars.palette.primary.light})`
              : // Everyone else: a wash, so a roster of forty reads as a set of
                // cards rather than as forty coloured banners.
                `linear-gradient(135deg, color-mix(in srgb, ${t.vars.palette.primary.main} 20%, transparent), color-mix(in srgb, ${t.vars.palette.primary.main} 7%, transparent))`,
        }}
      >
        {badge ? <Box sx={{ position: "absolute", top: 8, right: 8 }}>{badge}</Box> : null}
      </Box>

      <Box sx={{ display: "flex", justifyContent: "center", mt: "-40px", zIndex: 1 }}>
        <Avatar
          src={photo ?? undefined}
          sx={{
            width: 80,
            height: 80,
            fontSize: 26,
            fontWeight: 700,
            border: "4px solid",
            borderColor: "background.paper",
            boxShadow: 2,
          }}
        >
          {initials(name)}
        </Avatar>
      </Box>

      {/* ── Body: on the page's own surface, not on a black slab ──────── */}
      <Stack sx={{ flexGrow: 1, px: 1.75, pt: 1.25, pb: 1.5, alignItems: "center", textAlign: "center" }}>
        <Typography
          sx={{ fontWeight: 800, fontSize: 15.5, lineHeight: 1.25, width: "100%" }}
          noWrap
          title={name}
        >
          {name}
        </Typography>

        {role ? (
          <Box
            sx={{
              mt: 0.75,
              maxWidth: "100%",
              px: 1,
              py: 0.3,
              borderRadius: 1,
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: "primary.main",
              bgcolor: (t: Theme) =>
                `color-mix(in srgb, ${t.vars.palette.primary.main} 12%, transparent)`,
              border: "1px solid",
              borderColor: (t: Theme) =>
                `color-mix(in srgb, ${t.vars.palette.primary.main} 26%, transparent)`,
            }}
            title={role}
          >
            {role}
          </Box>
        ) : null}

        {rows.length > 0 ? (
          <Stack
            spacing={0.5}
            sx={{
              mt: 1.5,
              width: "100%",
              pt: 1.25,
              borderTop: "1px solid",
              borderColor: "divider",
            }}
          >
            {rows.map((fact) => (
              <Stack
                key={fact.label}
                direction="row"
                spacing={0.75}
                sx={{ minWidth: 0, justifyContent: "space-between" }}
              >
                <Typography
                  sx={{ fontSize: 10.5, fontWeight: 700, color: "text.disabled", flexShrink: 0 }}
                >
                  {fact.label}
                </Typography>
                <Typography
                  sx={{ fontSize: 11.5, fontWeight: 600, minWidth: 0, color: "text.primary" }}
                  noWrap
                >
                  {fact.value}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : null}

        {/* The code as text. It was a hashed barcode, which nothing could scan
            — the product issues no such code — so it was a picture claiming a
            capability that does not exist. As text it is at least useful: it is
            what tells two colleagues of the same name apart. */}
        {code ? (
          <Typography
            sx={{
              mt: "auto",
              pt: 1.25,
              fontSize: 10,
              letterSpacing: ".1em",
              fontWeight: 700,
              color: "text.disabled",
            }}
          >
            {code}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

export { CARD_WIDTH as STAFF_CARD_WIDTH };
