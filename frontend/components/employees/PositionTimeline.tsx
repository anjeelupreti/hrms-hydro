"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import DateText from "@/components/common/DateText";
import type { EmployeeLogEntry } from "@/types/employees";

/**
 * How long somebody has been in each role, since they joined.
 *
 * **The record history already existed and answered a different question.** It
 * lists field changes — *designation: Engineer → Senior Engineer, changed by HR
 * Admin on 12 August* — which is what an audit trail is for and is nearly
 * useless as a career. Nobody asks "which fields were edited"; they ask **how
 * long has this person been doing this job**, and that is a span, not an event.
 *
 * So this reconstructs spans from the same log. The changes are the *boundaries*
 * between positions; the positions themselves are what gets drawn.
 *
 * **Joining is the first boundary and it is not in the log.** An employee's
 * first role was never "changed to", so the earliest entry's `from_value` is
 * what they started as — and its start date is `date_joined`, not the date of
 * the first change. Building the timeline from log rows alone loses the whole
 * first span, which on most records is the longest one.
 */

export type PositionSpan = {
  title: string;
  from: string;
  /** Null while current. */
  to: string | null;
  months: number;
};

function monthsBetween(from: string, to: string | null): number {
  const start = new Date(from);
  const end = to ? new Date(to) : new Date();
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return Math.max(months, 0);
}

/** "2 yr 3 mo", "7 mo", "under a month" — a duration people say out loud. */
function humanDuration(months: number): string {
  if (months < 1) return "under a month";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return `${rest} mo`;
  return rest ? `${years} yr ${rest} mo` : `${years} yr`;
}

/**
 * Turn the change log into spans.
 *
 * Exported for the test: the reconstruction is the part with the reasoning in
 * it, and it is easier to be sure about against a list of rows than through a
 * rendered component.
 */
export function buildSpans(
  logs: EmployeeLogEntry[],
  { dateJoined, currentTitle }: { dateJoined: string | null; currentTitle: string },
): PositionSpan[] {
  if (!dateJoined) return [];

  const changes = logs
    .filter((l) => l.field === "designation")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  if (changes.length === 0) {
    return [
      {
        title: currentTitle,
        from: dateJoined,
        to: null,
        months: monthsBetween(dateJoined, null),
      },
    ];
  }

  const spans: PositionSpan[] = [];
  // The role they joined as: what the first recorded change moved *away* from.
  let title = changes[0].from_value || currentTitle;
  let from = dateJoined;

  for (const change of changes) {
    spans.push({
      title,
      from,
      to: change.created_at,
      months: monthsBetween(from, change.created_at),
    });
    title = change.to_value || title;
    from = change.created_at;
  }

  spans.push({ title, from, to: null, months: monthsBetween(from, null) });
  return spans;
}

export default function PositionTimeline({
  logs,
  dateJoined,
  currentTitle,
  department,
}: {
  logs: EmployeeLogEntry[] | undefined;
  dateJoined: string | null;
  currentTitle: string;
  department?: string | null;
}) {
  const spans = buildSpans(logs ?? [], { dateJoined, currentTitle });
  if (spans.length === 0) return null;

  // Newest first — the current role is the one being asked about.
  const ordered = [...spans].reverse();
  const total = spans.reduce((sum, s) => sum + s.months, 0);

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", gap: 1, mb: 2, flexWrap: "wrap" }}>
          <Typography variant="overline" color="text.secondary">
            Positions held
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {spans.length === 1
              ? `${humanDuration(total)} in one role`
              : `${spans.length} roles over ${humanDuration(total)}`}
          </Typography>
        </Stack>

        <Stack spacing={0}>
          {ordered.map((span, i) => {
            const current = span.to === null;
            return (
              <Stack key={`${span.title}-${span.from}`} direction="row" spacing={2}>
                {/* The rail: a dot per position and a line between them, so the
                    eye reads it as one continuous employment rather than a
                    stack of unrelated cards. */}
                <Stack sx={{ alignItems: "center", width: 14, flexShrink: 0 }}>
                  <Box
                    sx={{
                      width: current ? 12 : 8,
                      height: current ? 12 : 8,
                      borderRadius: "50%",
                      mt: 0.75,
                      bgcolor: current ? "primary.main" : "divider",
                      border: current ? "none" : "2px solid",
                      borderColor: "divider",
                    }}
                  />
                  {i < ordered.length - 1 && (
                    <Box sx={{ flex: 1, width: "2px", bgcolor: "divider", my: 0.5, minHeight: 24 }} />
                  )}
                </Stack>

                <Box sx={{ pb: i < ordered.length - 1 ? 2.5 : 0, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {span.title}
                    </Typography>
                    {current && <Chip size="small" label="Current" color="primary" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    <DateText value={span.from} />
                    {" — "}
                    {span.to ? <DateText value={span.to} /> : "now"}
                    {" · "}
                    {humanDuration(span.months)}
                    {current && department ? ` · ${department}` : ""}
                  </Typography>
                </Box>
              </Stack>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
