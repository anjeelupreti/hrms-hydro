"use client";

import Box from "@mui/material/Box";
import { useEffect, useRef, useState } from "react";

/**
 * A run of years you can grab and drag, instead of a dropdown.
 *
 * **Why not a select.** Years are a short ordered run, which is the one shape a
 * dropdown is worst at: comparing two means opening the menu, finding a row and
 * clicking — once per year, with the open list covering the very figures being
 * compared.
 *
 * So they sit on a rail: drag it, throw the wheel at it, or arrow along it, and
 * the labels stay visible the whole time.
 *
 * **Dragging and clicking have to coexist.** A rail you can drag is also a row
 * of buttons, and naive handling makes every drag end in an accidental
 * selection. A pointer that has moved more than a few pixels is a drag and
 * suppresses the click; anything less is a tap. Three pixels is the threshold
 * because a real click on a trackpad is rarely still.
 */
export default function YearScrubber({
  years,
  value,
  onChange,
  /** How each year is written — `2083/84`, say. */
  format = (year) => String(year),
  ariaLabel = "Year",
}: {
  years: number[];
  value: number;
  onChange: (year: number) => void;
  format?: (year: number) => string;
  ariaLabel?: string;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: 0 });
  const [grabbing, setGrabbing] = useState(false);

  // Bring the selection into view when it changes from outside — arrow keys,
  // or a year restored from a saved filter.
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>(`[data-year="${value}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [value]);

  function onPointerDown(e: React.PointerEvent) {
    if (!rail.current) return;
    drag.current = { active: true, startX: e.clientX, startScroll: rail.current.scrollLeft, moved: 0 };
    setGrabbing(true);
    // Keeps the drag alive when the pointer leaves the rail, which is most
    // drags — people overshoot.
    rail.current.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current.active || !rail.current) return;
    const dx = e.clientX - drag.current.startX;
    drag.current.moved = Math.max(drag.current.moved, Math.abs(dx));
    rail.current.scrollLeft = drag.current.startScroll - dx;
  }

  function endDrag(e: React.PointerEvent) {
    if (rail.current?.hasPointerCapture(e.pointerId)) {
      rail.current.releasePointerCapture(e.pointerId);
    }
    drag.current.active = false;
    setGrabbing(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const index = years.indexOf(value);
    if (index < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(years[Math.min(years.length - 1, index + 1)]);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(years[Math.max(0, index - 1)]);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(years[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(years[years.length - 1]);
    }
  }

  return (
    <Box
      ref={rail}
      role="radiogroup"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      sx={{
        display: "flex",
        gap: 0.5,
        maxWidth: { xs: "100%", sm: 320 },
        overflowX: "auto",
        cursor: grabbing ? "grabbing" : "grab",
        p: 0.5,
        borderRadius: "10px",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        // The rail is the control; its scrollbar would be a second one.
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
        "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        // Horizontal drag must not also scroll the page on a touch screen.
        touchAction: "pan-y",
      }}
    >
      {years.map((year) => {
        const selected = year === value;
        return (
          <Box
            key={year}
            component="button"
            type="button"
            role="radio"
            aria-checked={selected}
            data-year={year}
            onClick={() => {
              // A drag that ended over a year should not select it.
              if (drag.current.moved > 3) return;
              onChange(year);
            }}
            sx={{
              font: "inherit",
              border: "none",
              cursor: "inherit",
              flexShrink: 0,
              px: 1.5,
              py: 0.75,
              borderRadius: "7px",
              fontSize: "0.85rem",
              fontWeight: selected ? 700 : 500,
              whiteSpace: "nowrap",
              color: selected ? "primary.contrastText" : "text.secondary",
              bgcolor: selected ? "primary.main" : "transparent",
              transition: "background-color .18s, color .18s",
              "&:hover": selected ? undefined : { bgcolor: "action.hover", color: "text.primary" },
              // Text selection turns a drag into a highlight sweep.
              userSelect: "none",
            }}
          >
            {format(year)}
          </Box>
        );
      })}
    </Box>
  );
}
