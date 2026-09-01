"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";

/**
 * Choosing which part of a cover photo the banner actually shows.
 *
 * The banner is roughly 13:1, and almost no photograph survives that crop
 * centred — a portrait uploaded as a cover shows its geometric middle, which on
 * a selfie is the nose and mouth. This is how the visible band is chosen, and
 * `Employee.cover_position` is where it is stored.
 *
 * **The preview is the real thing, at the real ratio.** A square cropper with a
 * rectangle drawn on it makes somebody translate between two shapes in their
 * head. This is the banner, the size it will be, with the photo moving inside
 * it — so what you see is what the page will show, and there is nothing to
 * translate.
 *
 * **Vertical only, deliberately.** `background-size: cover` already fits the
 * width of a 13:1 strip for any normal photo, so horizontal movement does
 * nothing for the overwhelming majority of images and a control that sometimes
 * does nothing is worse than one that does less. The axis that matters — where
 * in a tall photo the strip sits — is the one exposed.
 */
export default function CoverPositioner({
  image,
  value,
  onChange,
}: {
  image: string;
  /** CSS `object-position`, e.g. `"50% 30%"`. */
  value: string;
  onChange: (next: string) => void;
}) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Only the vertical half is editable; the horizontal stays centred.
  const y = Number.parseFloat(value?.split(" ")[1] ?? "50") || 50;

  const setFromPointer = (clientY: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.height === 0) return;
    // Dragging *down* should reveal more of the *top* of the photo, the way
    // moving a print behind a window does. Hence the inversion.
    const ratio = (clientY - box.top) / box.height;
    const next = Math.min(100, Math.max(0, Math.round(ratio * 100)));
    onChange(`50% ${next}%`);
  };

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.75 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          What the banner shows
        </Typography>
        <Button size="small" onClick={() => onChange("50% 50%")} sx={{ minWidth: 0, px: 1 }}>
          Reset
        </Button>
      </Stack>

      <Box
        ref={frame}
        onPointerDown={(e) => {
          setDragging(true);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setFromPointer(e.clientY);
        }}
        onPointerMove={(e) => {
          if (dragging) setFromPointer(e.clientY);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        role="slider"
        aria-label="Vertical position of the cover photo"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(y)}
        tabIndex={0}
        // Keyboard parity: a drag-only control is unusable without a mouse, and
        // this is the only way to set the value.
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") { e.preventDefault(); onChange(`50% ${Math.max(0, y - 2)}%`); }
          if (e.key === "ArrowDown") { e.preventDefault(); onChange(`50% ${Math.min(100, y + 2)}%`); }
        }}
        sx={{
          position: "relative",
          width: "100%",
          // The banner's real proportions, so the preview is not a promise the
          // page then breaks.
          aspectRatio: "13 / 2",
          borderRadius: 2,
          overflow: "hidden",
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          border: "1px solid",
          borderColor: "divider",
          backgroundImage: `url(${image})`,
          backgroundSize: "cover",
          backgroundPosition: `50% ${y}%`,
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            opacity: dragging ? 0 : 1,
            transition: "opacity .15s",
            bgcolor: "rgba(0,0,0,.28)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: ".02em",
          }}
        >
          Drag to choose what shows
        </Box>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
        This is the banner at its real shape — a wide strip. Tall photos only ever show a
        slice of themselves here, so pick the slice.
      </Typography>
    </Box>
  );
}
