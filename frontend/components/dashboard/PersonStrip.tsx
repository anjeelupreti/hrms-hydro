"use client";

import GridViewIcon from "@mui/icons-material/GridView";

import { compactCard } from "@/lib/theme/cards";
import ViewListIcon from "@mui/icons-material/ViewList";
import CakeIcon from "@mui/icons-material/Cake";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import CardEmpty from "@/components/dashboard/CardEmpty";
import PersonAvatar from "@/components/common/PersonAvatar";
import StaffCard, { STAFF_CARD_WIDTH } from "@/components/common/StaffCard";
import { useState } from "react";

/**
 * People, as cards you scan across or rows you read down — the reader chooses.
 *
 * **Why both, rather than picking one.** A list is denser and better for "how
 * many" and "who is next". Cards carry a face, and for *people* that is often
 * the fastest way to recognise somebody — a birthday list of five names is
 * something you read; five faces is something you glance at. Neither is right
 * for every card on the page, so the choice belongs to whoever is looking.
 *
 * **One component for three cards.** Upcoming leave, birthdays and recently
 * joined were three separate list implementations with three slightly different
 * row layouts. Sharing the shell means the toggle exists once, the empty state
 * reads the same way three times, and a fix to the card lands everywhere —
 * which is the opposite of how the Books page ended up duplicating a
 * revenue table.
 *
 * **The choice is remembered per card, not globally.** Somebody may well want
 * faces for birthdays and a list for leave; a single shared preference would
 * force one answer on both. Kept in component state rather than persisted —
 * this is a glance-level preference, and a stored one is a setting nobody asked
 * for.
 */

export type StripPerson = {
  id: number | string;
  name: string;
  photo?: string | null;
  /** The line under the name — role, department, whatever identifies them. */
  detail?: string | null;
  /** The thing this card is actually about: a date, a countdown, a status. */
  badge?: string | null;
  /** Draws the badge as the accent rather than plain — for "today". */
  highlight?: boolean;
  /** The employee code — the badge's identity line and its barcode seed. */
  code?: string | null;
  /** A second fact for the badge's rows: department, leave type, joined date. */
  extra?: { label: string; value: string } | null;
};

/**
 * What kind of card this is.
 *
 * Birthdays, upcoming leave and new joiners are three different pieces of
 * news — a celebration, an absence to plan around, and somebody to welcome —
 * so they are three variants rather than one card used three times. Sameness
 * here is not consistency; it is the design declining to say anything.
 *
 * Each variant keeps the same geometry so the strips still line up, and changes
 * what the card is *made of*.
 */
export type StripVariant = "birthday" | "leave" | "joiner";

/** Owned by `StaffCard`, so the strip and the card cannot disagree about it. */
const CARD_WIDTH = STAFF_CARD_WIDTH;

/**
 * One person, as an ID badge.
 *
 * The card itself is `StaffCard`, shared with the employee list, so this only
 * decides what a *birthday* badge says versus a *joiner* badge. A bespoke card
 * here would be a statistic with a face on it — an avatar, a name and a chip in
 * a box the same shape as every count on the page.
 *
 * **Only today is bright.** `highlight` is set by the dashboard for the people
 * whose birthday is actually today; three weeks out gets the ordinary badge.
 * That is the owner's rule and it is the right one — a card you could act on
 * this morning should not have to be found by reading dates.
 */
function IdCard({
  person,
  variant,
  onOpen,
}: {
  person: StripPerson;
  variant: StripVariant;
  onOpen?: (id: StripPerson["id"]) => void;
}) {
  const birthday = variant === "birthday";

  // The role is the chip, so it is not repeated as a row. What is left is
  // whatever the strip's subject actually is — a date, a leave type — plus the
  // code, which is the one line that tells two colleagues of the same name
  // apart.
  const facts: { label: string; value: string }[] = [];
  if (person.extra) facts.push(person.extra);
  if (person.badge) {
    facts.push({
      label: birthday ? "Birthday" : variant === "joiner" ? "Joined" : "From",
      value: person.badge,
    });
  }

  return (
    <StaffCard
      width={CARD_WIDTH}
      name={person.name}
      photo={person.photo}
      role={person.detail ?? null}
      code={person.code ?? null}
      facts={facts}
      tone={birthday && person.highlight ? "celebrate" : "default"}
      badge={
        person.badge ? (
          <Box
            sx={{
              px: 0.85,
              py: 0.3,
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              gap: 0.4,
              bgcolor: person.highlight ? "primary.main" : "background.paper",
              color: person.highlight ? "primary.contrastText" : "text.secondary",
              border: "1px solid",
              borderColor: person.highlight ? "transparent" : "divider",
            }}
          >
            {birthday ? <CakeIcon sx={{ fontSize: 12 }} /> : null}
            {person.badge}
          </Box>
        ) : null
      }
      onOpen={onOpen ? () => onOpen(person.id) : undefined}
    />
  );
}

function Row({ person, onOpen }: { person: StripPerson; onOpen?: (id: StripPerson["id"]) => void }) {
  return (
    <Stack
      component={onOpen ? "button" : "div"}
      onClick={onOpen ? () => onOpen(person.id) : undefined}
      direction="row"
      spacing={1.25}
      sx={{
        alignItems: "center",
        width: "100%",
        font: "inherit",
        textAlign: "left",
        border: "none",
        bgcolor: "transparent",
        cursor: onOpen ? "pointer" : "default",
        px: 1,
        py: 0.85,
        borderRadius: 1.5,
        "&:hover": onOpen ? { bgcolor: "action.hover" } : {},
      }}
    >
      {/* `PersonAvatar` already derives initials and a shade of the accent from
          the name — a local `initials()` here was a second implementation of
          something the shared component does. */}
      <PersonAvatar name={person.name} photo={person.photo} size={32} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>
          {person.name}
        </Typography>
        {person.detail ? (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            {person.detail}
          </Typography>
        ) : null}
      </Box>
      {person.badge ? (
        <Typography
          variant="caption"
          sx={{
            flexShrink: 0,
            fontWeight: 700,
            color: person.highlight ? "primary.main" : "text.secondary",
          }}
        >
          {person.badge}
        </Typography>
      ) : null}
    </Stack>
  );
}

export default function PersonStrip({
  title,
  subtitle,
  people,
  empty,
  variant = "leave",
  defaultView = "cards",
  onOpen,
  action,
}: {
  title: string;
  subtitle?: string;
  people: StripPerson[];
  empty: string;
  /** What this strip is about — see `StripVariant`. Defaults to the plainest. */
  variant?: StripVariant;
  defaultView?: "cards" | "list";
  onOpen?: (id: StripPerson["id"]) => void;
  action?: React.ReactNode;
}) {
  const [view, setView] = useState<"cards" | "list">(defaultView);

  return (
    <Card sx={compactCard}>
      <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between", mb: 1.5 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
            {action}
            {/* Only worth offering when there is more than one person — a
                toggle over a single row is a control with nothing to do. */}
            {people.length > 1 ? (
              <ToggleButtonGroup
                exclusive
                size="small"
                value={view}
                onChange={(_, v) => v && setView(v)}
                sx={{ "& .MuiToggleButton-root": { px: 0.85, py: 0.35, border: "none" } }}
              >
                <ToggleButton value="cards" aria-label="Show as cards">
                  <GridViewIcon sx={{ fontSize: 16 }} />
                </ToggleButton>
                <ToggleButton value="list" aria-label="Show as a list">
                  <ViewListIcon sx={{ fontSize: 16 }} />
                </ToggleButton>
              </ToggleButtonGroup>
            ) : null}
          </Stack>
        </Stack>

        {people.length === 0 ? (
          <CardEmpty>{empty}</CardEmpty>
        ) : view === "cards" ? (
          <Stack
            direction="row"
            spacing={1.25}
            sx={{
              // Scrolls sideways rather than wrapping: a wrapped second row of
              // cards changes the card's height and drags the whole grid row
              // with it, which is what made this page ragged in the first place.
              overflowX: "auto",
              pb: 1,
              scrollbarWidth: "thin",
              "&::-webkit-scrollbar": { height: 6 },
              "&::-webkit-scrollbar-thumb": { borderRadius: 3, background: "rgba(0,0,0,.18)" },

              // A card sliced down the middle at the container edge reads as
              // a rendering fault rather than as a carousel, and a thin
              // scrollbar most browsers hide until you touch it is not an
              // affordance.
              //
              // Snapping means a swipe always lands on a whole card, and the
              // fade says there is more without spending a pixel of layout on
              // saying so.
              scrollSnapType: "x mandatory",
              "& > *": { scrollSnapAlign: "start" },
              maskImage: "linear-gradient(to right, #000 calc(100% - 28px), transparent)",
            }}
          >
            {people.map((person) => (
              <IdCard key={person.id} person={person} variant={variant} onOpen={onOpen} />
            ))}
          </Stack>
        ) : (
          <Stack spacing={0.25}>
            {people.map((person) => (
              <Row key={person.id} person={person} onOpen={onOpen} />
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
