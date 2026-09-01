"use client";

import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";

/**
 * A person, shown as a person.
 *
 * **Why not a plain `<Avatar>`.** Without a photo — which is most people, most
 * of the time — MUI renders grey initials on grey, so twenty rows are twenty
 * identical discs and the eye has to read every name anyway. An avatar's whole
 * job is to be recognised before it is read.
 *
 * So the fallback is coloured **from the person's name**: the same name always
 * produces the same hue, which makes a face-less avatar still identifiable at
 * a glance and consistent everywhere that person appears. Two hues 137° apart
 * give the disc a direction rather than a flat fill, so it reads as a surface
 * instead of a swatch.
 *
 * **Why a hash and not a palette index.** A palette assigns by position in a
 * list, so somebody's colour changes when a colleague is added above them.
 * Hashing the name means the colour belongs to the person.
 *
 * The hues are held at a fixed saturation and lightness so no avatar can come
 * out muddy or fluorescent, and white initials stay legible on all of them.
 */

/**
 * A stable number per name, 0–1.
 *
 * djb2 — deterministic across server and client, which matters because a
 * colour computed differently in the two places is a hydration mismatch.
 */
function seedFor(seed: string) {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

/**
 * **Shades of the accent, not a hue per person.** The first version took the
 * hash modulo 360, so a list of people came out as a full rainbow — the exact
 * thing the rest of the theme work was undoing, reintroduced one avatar at a
 * time.
 *
 * A person still needs to be recognisable at a glance, so the hash varies how
 * *strongly* the accent is mixed rather than which colour it is. Ten people in
 * a list stay distinguishable and the column stays obviously one palette.
 */

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export type PresenceState = "online" | "offline" | "unknown";

export default function PersonAvatar({
  name,
  photo,
  size = 40,
  presence = "unknown",
  /** The ring reads as emphasis; leave it off in dense tables. */
  ring = false,
  variant = "filled",
}: {
  name: string;
  photo?: string | null;
  size?: number;
  presence?: PresenceState;
  ring?: boolean;
  /**
   * `outlined` draws the colour as a border and the initials in it, on no
   * fill. Five solid discs in a list read as five buttons and shout louder
   * than the names beside them, which are the actual content; an outline
   * carries the same identity at a fraction of the weight.
   */
  variant?: "filled" | "outlined";
}) {
  const seed = seedFor(name || "?");
  // Strength, not hue. `color-mix` against the theme's own primary keeps every
  // avatar inside the accent's family without this component parsing a colour
  // — the browser mixes, and re-mixes for free when the accent changes.
  //
  // An earlier version rotated hue as well, which meant the initials inside
  // rotated with it and ten people were once again ten colours.
  const strength = 30 + Math.round(seed * 45); // 30–75% of the accent
  // Flat, not a gradient. A per-avatar `linear-gradient` gives every disc on a
  // strip of faces its own highlight and shadow — a dozen tiny glossy buttons
  // competing with the names they belong to. The identity is in the *strength*
  // of the tint, not in the gradient, and a placeholder should not out-decorate
  // the photograph it stands in for.
  const fill = `color-mix(in srgb, var(--mui-palette-primary-main) ${strength}%, white)`;
  const dot = Math.max(9, Math.round(size * 0.28));

  return (
    <Box sx={{ position: "relative", lineHeight: 0, display: "inline-block" }}>
      <Avatar
        src={photo ?? undefined}
        alt={name}
        sx={{
          width: size,
          height: size,
          fontSize: Math.max(11, Math.round(size * 0.36)),
          fontWeight: 650,
          letterSpacing: "0.01em",
          color: "common.white",
          // Only paint the fill when there is no photo — behind an image
          // it would show through a transparent PNG.
          ...(photo
            ? {}
            : variant === "outlined"
              ? {
                  backgroundColor: "transparent",
                  color: `color-mix(in srgb, var(--mui-palette-primary-main) ${strength + 25}%, var(--mui-palette-text-primary))`,
                  border: "1.5px solid",
                  borderColor: `color-mix(in srgb, var(--mui-palette-primary-main) ${strength}%, transparent)`,
                }
              : { backgroundColor: fill }),
          ...(ring
            ? {
                boxShadow: (t) =>
                  // `vars`, like the accent beside it. `t.palette.background.paper` baked
                  // the light `#ffffff`, so the inner ring stayed white and drew a
                  // bright halo around every avatar on a dark card.
                  `0 0 0 2px ${t.vars.palette.background.paper}, 0 0 0 3.5px color-mix(in srgb, ${t.vars.palette.primary.main} 55%, transparent)`,
              }
            : {}),
        }}
      >
        {initialsOf(name)}
      </Avatar>

      {/* Rendered only when presence is actually known. A dot that is always
          green is decoration wearing the costume of data — and this app has a
          real presence service, so guessing is not the only option. */}
      {presence !== "unknown" ? (
        <Tooltip title={presence === "online" ? "Online" : "Offline"}>
          <Box
            aria-label={presence === "online" ? "Online" : "Offline"}
            sx={{
              position: "absolute",
              right: -1,
              bottom: -1,
              width: dot,
              height: dot,
              borderRadius: "50%",
              bgcolor: presence === "online" ? "success.main" : "text.disabled",
              border: "2px solid",
              borderColor: "background.paper",
            }}
          />
        </Tooltip>
      ) : null}
    </Box>
  );
}
