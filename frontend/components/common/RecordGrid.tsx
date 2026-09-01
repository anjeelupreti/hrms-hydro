"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import EmptyState from "@/components/common/EmptyState";
import PersonAvatar from "@/components/common/PersonAvatar";

/**
 * What one record looks like when it is not a table row.
 *
 * Deliberately not "any JSX per card". Every screen inventing its own card
 * produces eight different ideas of where a name sits and what a status chip
 * means, and the cost lands on the person reading them, not the person writing
 * them. So a record declares its *parts* and this decides the arrangement.
 */
export type RecordView<R> = {
  key: (row: R) => string | number;
  title: (row: R) => ReactNode;
  /**
   * The person this record is about, if it is about one.
   *
   * Cards without a face are a wall of text blocks: the eye has nothing to
   * land on and every card looks like every other. Where a record *has* a
   * person — a payslip, an employee, a leave request — that person is the
   * fastest way to recognise the row, which is the whole reason to use cards
   * instead of a table.
   *
   * `photo` is optional; `PersonAvatar` draws initials in a shade of the
   * accent when there is none.
   */
  person?: (row: R) => { name: string; photo?: string | null } | null;
  /** One line under the title — a code, a client, a date. */
  subtitle?: (row: R) => ReactNode;
  /** Top-right. A status chip, usually. */
  badge?: (row: R) => ReactNode;
  /** The two or three numbers this record is judged by. Shown in both views. */
  facts?: (row: R) => { label: string; value: ReactNode }[];
  /**
   * More facts, cards only.
   *
   * A card has a whole surface and a list row has a line, so showing both the
   * same three facts made the card view a worse table — same information,
   * a fifth of the density. These are appended in the card layout and dropped
   * from the list, which is what makes choosing cards worth something.
   */
  cardFacts?: (row: R) => { label: string; value: ReactNode }[];
  /** Bottom row — buttons. Rendered outside the click target. */
  actions?: (row: R) => ReactNode;
  onOpen?: (row: R) => void;
};

/**
 * The same records as cards or as a compact list.
 *
 * Two layouts rather than two components because they differ only in density:
 * a card gives each record its own surface and room for facts, a list packs
 * them so twenty fit on a screen. Sharing the `RecordView` means a screen
 * describes its record once and gets both, and they cannot drift apart.
 *
 * The table view is `DataTable` — genuinely different, since sorting and
 * column choice are its whole point, and forcing it through this shape would
 * lose them.
 */
export default function RecordGrid<R>({
  rows,
  view,
  variant,
  loading = false,
  empty,
  filtered = false,
}: {
  rows: R[];
  view: RecordView<R>;
  variant: "cards" | "list";
  loading?: boolean;
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  filtered?: boolean;
}) {
  if (loading) {
    return (
      <Box
        sx={
          variant === "cards"
            ? { display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" } }
            : { display: "flex", flexDirection: "column", gap: 1 }
        }
      >
        {Array.from({ length: variant === "cards" ? 6 : 8 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={variant === "cards" ? 132 : 56} />
        ))}
      </Box>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={empty?.title ?? (filtered ? "Nothing matches" : "Nothing here yet")}
        description={
          empty?.description ??
          (filtered ? "Try a different search or clear the filters." : undefined)
        }
        action={empty?.action}
      />
    );
  }

  if (variant === "list") {
    return (
      <Card variant="outlined">
        <Stack divider={<Divider />}>
          {rows.map((row) => (
            <Box
              key={view.key(row)}
              onClick={view.onOpen ? () => view.onOpen?.(row) : undefined}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                px: 2,
                py: 1.25,
                cursor: view.onOpen ? "pointer" : "default",
                "&:hover": view.onOpen ? { bgcolor: "action.hover" } : undefined,
              }}
            >
              {view.person?.(row) ? (
                <PersonAvatar
                  name={view.person(row)!.name}
                  photo={view.person(row)!.photo}
                  size={32}
                  variant="outlined"
                />
              ) : null}

              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                  {view.title(row)}
                </Typography>
                {view.subtitle ? (
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {view.subtitle(row)}
                  </Typography>
                ) : null}
              </Box>

              {/* Facts collapse away before the title does: on a narrow screen
                  knowing *which* record this is matters more than its numbers. */}
              <Stack direction="row" spacing={3} sx={{ display: { xs: "none", md: "flex" } }}>
                {(view.facts?.(row) ?? []).map((fact) => (
                  <Box key={fact.label} sx={{ textAlign: "right" }}>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {fact.label}
                    </Typography>
                    <Typography variant="body2">{fact.value}</Typography>
                  </Box>
                ))}
              </Stack>

              {view.badge ? <Box>{view.badge(row)}</Box> : null}
              {view.actions ? (
                <Box onClick={(e) => e.stopPropagation()}>{view.actions(row)}</Box>
              ) : null}
            </Box>
          ))}
        </Stack>
      </Card>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" },
      }}
    >
      {rows.map((row) => {
        const facts = [...(view.facts?.(row) ?? []), ...(view.cardFacts?.(row) ?? [])];
        const person = view.person?.(row) ?? null;
        const body = (
          <CardContent sx={{ height: "100%" }}>
            {/*
              **When a card is about a person, the face leads it.**

              A 40px avatar beside the name, at the same weight as everything
              else, makes a grid of employees read as a grid of text blocks —
              and a table already beats that on density. The only reason to
              spend a card's space on a person is recognition, and recognition
              is the photo.

              Cards for records that are not about a person keep the ordinary
              arrangement, because there is nothing to lead with.
            */}
            {person ? (
              <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <PersonAvatar name={person.name} photo={person.photo} size={64} ring />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", justifyContent: "space-between" }}
                  >
                    <Typography
                      variant="subtitle1"
                      sx={{ fontWeight: 700, letterSpacing: "-0.01em", minWidth: 0 }}
                      noWrap
                    >
                      {view.title(row)}
                    </Typography>
                    {view.badge ? <Box sx={{ flexShrink: 0 }}>{view.badge(row)}</Box> : null}
                  </Stack>
                  {view.subtitle ? (
                    <Typography variant="body2" color="text.secondary" noWrap component="div">
                      {view.subtitle(row)}
                    </Typography>
                  ) : null}
                </Box>
              </Stack>
            ) : (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }} noWrap>
                    {view.title(row)}
                  </Typography>
                  {view.subtitle ? (
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {view.subtitle(row)}
                    </Typography>
                  ) : null}
                </Box>
                {view.badge ? view.badge(row) : null}
              </Stack>
            )}

            {facts.length ? (
              // **A grid, not a flex row.** Side by side with a 16px gap, a
              // long value ran straight into the next label — "Engineering"
              // and "QA Engineer" read as one phrase. Equal columns keep each
              // label above its own value and give the pair a hard edge.
              <Box
                sx={{
                  mt: 2,
                  pt: 1.5,
                  borderTop: "1px solid",
                  borderColor: "divider",
                  display: "grid",
                  gridTemplateColumns: `repeat(${Math.min(facts.length, 3)}, minmax(0, 1fr))`,
                  gap: 1.5,
                }}
              >
                {facts.map((fact) => (
                  <Box key={fact.label} sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      component="div"
                      sx={{ textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}
                    >
                      {fact.label}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap title={typeof fact.value === "string" ? fact.value : undefined}>
                      {fact.value}
                    </Typography>
                  </Box>
                ))}
              </Box>
            ) : null}
          </CardContent>
        );

        return (
          <Card key={view.key(row)} variant="outlined" sx={{ display: "flex", flexDirection: "column" }}>
            {view.onOpen ? (
              <CardActionArea onClick={() => view.onOpen?.(row)} sx={{ flex: 1 }}>
                {body}
              </CardActionArea>
            ) : (
              body
            )}
            {view.actions ? (
              <Box sx={{ px: 2, pb: 1.5, pt: 0 }}>{view.actions(row)}</Box>
            ) : null}
          </Card>
        );
      })}
    </Box>
  );
}
