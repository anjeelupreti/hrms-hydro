"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import EmptyState from "@/components/common/EmptyState";

/**
 * When the office actually starts, drawn on a clock.
 *
 * **Why not another bar chart.** The question is not *how many were late* —
 * that is a percentage, it goes in a report, and it changes nothing. The
 * question is *does the start time we publish match the one people keep*, and
 * that is a shape: where the mass of arrivals sits relative to the line. An
 * office whose bulk lands forty minutes past its own start does not have a
 * lateness problem, it has a start-time problem, and no amount of counting late
 * arrivals will ever show that.
 *
 * **A clock, because time of day is cyclical and everyone can already read
 * one.** A horizontal histogram of the same data needs an axis, a legend and a
 * caption to say what it is. A dial with hour marks needs none of that: the
 * reader knows instantly that further clockwise is later, and the official
 * start drawn as a hand shows immediately which side the weight falls on.
 *
 * **Bar length is arrivals, so the widest arc is the habit.** The scale is
 * anchored to the busiest slot rather than to a fixed maximum, because the
 * comparison that matters is between the slots, not against some absolute
 * number of people.
 *
 * Hand-drawn SVG rather than a chart library: the form does not exist in one,
 * and the geometry is a dozen lines of trigonometry.
 */

type Slot = { minute: number; label: string; count: number };

const SIZE = 300;
const CENTRE = SIZE / 2;
const INNER = 58;
const OUTER = 128;

/** Minutes past midnight → the angle on a 12-hour dial, noon-up, clockwise. */
function angleFor(minute: number) {
  const onDial = minute % (12 * 60);
  return (onDial / (12 * 60)) * 2 * Math.PI - Math.PI / 2;
}

function point(angle: number, radius: number) {
  return { x: CENTRE + Math.cos(angle) * radius, y: CENTRE + Math.sin(angle) * radius };
}

/** The wedge for one half-hour slot, drawn out to `radius`. */
function wedge(minute: number, radius: number) {
  // A hair under a full half-hour, so neighbouring wedges are separated by the
  // surface rather than by a stroke — a border around a mark is the thing to
  // avoid; a gap is not.
  const from = angleFor(minute + 1);
  const to = angleFor(minute + 29);
  const a = point(from, INNER);
  const b = point(from, radius);
  const c = point(to, radius);
  const d = point(to, INNER);
  return `M${a.x} ${a.y} L${b.x} ${b.y} A${radius} ${radius} 0 0 1 ${c.x} ${c.y} L${d.x} ${d.y} A${INNER} ${INNER} 0 0 0 ${a.x} ${a.y} Z`;
}

function clock(minute: number) {
  const hours = Math.floor(minute / 60);
  const mins = minute % 60;
  const suffix = hours < 12 ? "am" : "pm";
  const shown = hours % 12 === 0 ? 12 : hours % 12;
  return `${shown}:${String(mins).padStart(2, "0")}${suffix}`;
}

export default function ArrivalClock({
  slots,
  officeStart,
  median,
  total,
  afterStart,
}: {
  slots: Slot[];
  /** Minutes past midnight, or null when the system has not set one. */
  officeStart: number | null;
  median: number | null;
  total: number;
  afterStart: number | null;
}) {
  if (!slots.length || median === null) {
    return (
      <EmptyState
        compact
        title="No arrivals recorded yet"
        description="Once people start checking in, this shows the time of day they actually arrive — against the start time your publishes."
      />
    );
  }

  const busiest = Math.max(...slots.map((s) => s.count), 1);

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ alignItems: "center" }}>
      <Box
        component="svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Arrival times over the last four weeks. Typical arrival ${clock(median)}.`}
        sx={{ width: SIZE, maxWidth: "100%", flexShrink: 0 }}
      >
        {/* The dial. Faint, because it is furniture — the arrivals are the
            content and the ring only has to say "this is a clock". */}
        <circle cx={CENTRE} cy={CENTRE} r={OUTER} fill="none" stroke="currentColor" strokeOpacity={0.08} />
        <circle cx={CENTRE} cy={CENTRE} r={INNER} fill="none" stroke="currentColor" strokeOpacity={0.08} />

        {Array.from({ length: 12 }, (_, hour) => {
          const angle = angleFor(hour * 60);
          const tick = point(angle, OUTER + 6);
          return (
            <text
              key={hour}
              x={tick.x}
              y={tick.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={10}
              fill="currentColor"
              opacity={0.45}
            >
              {hour === 0 ? 12 : hour}
            </text>
          );
        })}

        {slots.map((slot) => {
          if (slot.count === 0) return null;
          const radius = INNER + ((OUTER - INNER) * slot.count) / busiest;
          const late = officeStart !== null && slot.minute > officeStart;
          return (
            <Tooltip
              key={slot.minute}
              title={`${clock(slot.minute)} — ${slot.count} ${slot.count === 1 ? "arrival" : "arrivals"}`}
            >
              <path
                d={wedge(slot.minute, radius)}
                // Late slots stay semantic rather than taking the accent: a
                // problem tinted toward the house colour stops reading as one.
                fill={late ? "var(--hrms-status-warning-solid)" : "var(--mui-palette-primary-main)"}
                opacity={0.9}
              />
            </Tooltip>
          );
        })}

        {/* The published start, as a hand. This is the whole comparison — every
            wedge clockwise of it arrived after the office opened. */}
        {officeStart !== null
          ? (() => {
              const angle = angleFor(officeStart);
              const tip = point(angle, OUTER + 2);
              return (
                <g>
                  <line
                    x1={CENTRE}
                    y1={CENTRE}
                    x2={tip.x}
                    y2={tip.y}
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    opacity={0.75}
                  />
                  <circle cx={CENTRE} cy={CENTRE} r={3.5} fill="currentColor" opacity={0.75} />
                </g>
              );
            })()
          : null}

        {/* The typical arrival, in the middle, because it is the one figure
            somebody quotes afterwards. */}
        <text
          x={CENTRE}
          y={CENTRE - 6}
          textAnchor="middle"
          fontSize={22}
          fontWeight={800}
          fill="currentColor"
        >
          {clock(median)}
        </text>
        <text
          x={CENTRE}
          y={CENTRE + 12}
          textAnchor="middle"
          fontSize={9}
          fill="currentColor"
          opacity={0.55}
          letterSpacing={0.6}
        >
          TYPICAL
        </text>
      </Box>

      <Stack spacing={1.5} sx={{ minWidth: 0, flex: 1 }}>
        <Reading
          label="Office opens"
          value={officeStart === null ? "not set" : clock(officeStart)}
          hint={
            officeStart === null
              ? "Set it in company settings and this dial gains a reference line."
              : median > officeStart
                ? `Most people arrive ${median - officeStart} minutes after that.`
                : "Most people are in before it."
          }
        />
        <Reading
          label="Arrivals counted"
          value={total.toLocaleString()}
          hint="Check-ins over the last four weeks — a habit, not a quarter's average."
        />
        {afterStart !== null ? (
          <Reading
            label="After opening"
            value={`${Math.round((afterStart / total) * 100)}%`}
            hint={`${afterStart.toLocaleString()} of ${total.toLocaleString()} arrivals.`}
            tone={afterStart / total > 0.5 ? "warning" : "default"}
          />
        ) : null}
      </Stack>
    </Stack>
  );
}

function Reading({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "warning";
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.04em" }}>
        {label.toUpperCase()}
      </Typography>
      <Typography
        className="hrms-display-num"
        variant="h6"
        sx={{ fontWeight: 800, lineHeight: 1.2, color: tone === "warning" ? "warning.main" : "text.primary" }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {hint}
      </Typography>
    </Box>
  );
}
