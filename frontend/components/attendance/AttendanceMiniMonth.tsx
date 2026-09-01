"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { DaySummary } from "@/hooks/useAttendance";

/**
 * This month's attendance, at the size of a corner.
 *
 * **Filled means you were here, an outline means you were not.** Two marks, no
 * legend needed, and the month reads as a shape rather than as thirty facts —
 * a run of outlines is a week off, a scattering of them is something else, and
 * neither is visible in a list of dates.
 *
 * **A day nobody logged is not an absence.** A weekend, a holiday, a date that
 * has not happened yet — none of those are "you did not come in", and drawing
 * them as outlines would put a month of accusations on the screen every first
 * of the month. They are drawn as bare numbers: present, placed, unmarked.
 *
 * **Late is filled too, and marked.** Somebody late was at work; the ring says
 * so without demoting them to absent, which is the distinction the dashboard
 * chart also refuses to blur.
 */

type Mark = "present" | "late" | "absent" | "half" | "none";

function markFor(status: string | null | undefined): Mark {
  switch (status) {
    case "present":
      return "present";
    case "late":
      return "late";
    case "absent":
      return "absent";
    case "half_day":
      return "half";
    default:
      return "none";
  }
}

export default function AttendanceMiniMonth({
  days,
  month,
  size = "compact",
}: {
  /** Any span; only the days of `month` are drawn. */
  days: DaySummary[];
  /** Any date inside the month to show. Defaults to today. */
  month?: Date;
  /**
   * `compact` is the corner-of-a-card original. `full` is the same month given
   * room to be read rather than glanced at — bigger cells, named weekdays, and
   * a legend, because at that size the marks stop being self-evident.
   */
  size?: "compact" | "full";
}) {
  const full = size === "full";
  const anchor = month ?? new Date();
  const year = anchor.getFullYear();
  const monthIndex = anchor.getMonth();

  const first = new Date(year, monthIndex, 1);
  const total = new Date(year, monthIndex + 1, 0).getDate();
  // Monday-first: a working week starts on Monday here, and a grid that starts
  // on Sunday puts the weekend either side of the days people care about.
  const offset = (first.getDay() + 6) % 7;

  const byDate = new Map(days.map((d) => [d.date, d]));
  const today = new Date();
  const isThisMonth = today.getFullYear() === year && today.getMonth() === monthIndex;

  return (
    <Box>
      {/* Capped to match the grid below, or the day names spread wider than the
          days they label. */}
      <Stack direction="row" sx={{ mb: full ? 1 : 0.5, maxWidth: full ? 392 : undefined }}>
        {(full
          ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
          : ["M", "T", "W", "T", "F", "S", "S"]
        ).map((label, i) => (
          <Typography
            key={i}
            variant="caption"
            sx={{
              flex: 1,
              textAlign: "center",
              color: "text.disabled",
              fontSize: full ? 11 : 10,
              fontWeight: full ? 600 : 400,
            }}
          >
            {label}
          </Typography>
        ))}
      </Stack>

      {/* A square cell in a 7-column grid has no size of its own — in a
          half-page column that is ~90px a day, so a month runs to about 630px
          of mostly empty circles. `aspectRatio: 1` does exactly what it is
          asked; something has to say how wide a day should be.

          Capped and left-aligned rather than stretched: a calendar is read as a
          block, and a block that grows with its container stops being one. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: full ? 0.75 : 0.25,
          maxWidth: full ? 392 : undefined,
        }}
      >
        {Array.from({ length: offset }).map((_, i) => (
          <Box key={`pad-${i}`} />
        ))}

        {Array.from({ length: total }, (_, i) => {
          const day = i + 1;
          const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const record = byDate.get(iso);
          const mark = markFor(record?.status);
          const isToday = isThisMonth && today.getDate() === day;
          const future = isThisMonth && day > today.getDate();

          const filled = mark === "present" || mark === "late" || mark === "half";

          return (
            <Tooltip
              key={day}
              title={
                mark === "none"
                  ? future
                    ? ""
                    : "Nothing logged"
                  : `${iso} — ${mark === "half" ? "half day" : mark}`
              }
              disableHoverListener={mark === "none" && future}
            >
              <Box
                sx={{
                  aspectRatio: "1",
                  display: "grid",
                  placeItems: "center",
                  fontSize: full ? 13 : 10,
                  borderRadius: "50%",
                  fontWeight: isToday ? 800 : 500,
                  // Today is ringed whatever its state, so "where am I in the
                  // month" survives a day with nothing logged yet.
                  outline: isToday ? "1.5px solid" : "none",
                  outlineColor: "text.primary",
                  outlineOffset: 1,
                  ...(filled
                    ? {
                        bgcolor:
                          mark === "late"
                            ? "var(--hrms-status-warning-solid)"
                            : mark === "half"
                              ? (t: import("@mui/material/styles").Theme) =>
                                  `color-mix(in srgb, ${t.vars.palette.primary.main} 55%, transparent)`
                              : "primary.main",
                        color: "primary.contrastText",
                      }
                    : mark === "absent"
                      ? {
                          border: "1.5px solid",
                          borderColor: "var(--hrms-status-danger-solid)",
                          color: "var(--hrms-status-danger-fg)",
                        }
                      : // Not logged: placed, not judged.
                        { color: future ? "text.disabled" : "text.secondary" }),
                }}
              >
                {day}
              </Box>
            </Tooltip>
          );
        })}
      </Box>

      {/* At corner size the two marks explain themselves and a legend would be
          most of the card. At full size the cells are big enough that the
          difference between a filled circle and a ringed one invites the
          question — so answer it. */}
      {full ? (
        <Stack direction="row" spacing={2} sx={{ mt: 2, flexWrap: "wrap", rowGap: 1 }}>
          {[
            { label: "Present", swatch: { bgcolor: "primary.main" } },
            { label: "Late", swatch: { bgcolor: "var(--hrms-status-warning-solid)" } },
            {
              label: "Half day",
              swatch: {
                bgcolor: (t: import("@mui/material/styles").Theme) =>
                  `color-mix(in srgb, ${t.vars.palette.primary.main} 55%, transparent)`,
              },
            },
            {
              label: "Absent",
              swatch: { border: "1.5px solid", borderColor: "var(--hrms-status-danger-solid)" },
            },
          ].map((item) => (
            <Stack key={item.label} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 10, height: 10, borderRadius: "50%", ...item.swatch }} />
              <Typography variant="caption" color="text.secondary">
                {item.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Box>
  );
}
