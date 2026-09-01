"use client";

import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Columns from "@/components/charts/Columns";
import type { TrainingProgram } from "@/types/training";

/**
 * Which programmes anybody can actually attend.
 *
 * A programme with no sessions cannot be enrolled in. Every enrolment hangs
 * off a `TrainingSession`, so `session_count: 0` means the programme is a
 * description of a course rather than a course — and the catalogue below cannot
 * show that, because a card with no sessions looks exactly like a card.
 *
 * **Ranked by what is missing, not alphabetically.** The catalogue below is a
 * browsing surface; this is a maintenance one. Programmes with nothing
 * scheduled come first because they are the ones somebody has to act on, and
 * everything else is one line of reassurance.
 *
 * **Counts sessions, not attendance.** A scheduled session is the most this
 * page's data can honestly speak to — whether people turned up is an enrolment
 * question, and the enrolments are fetched per-employee further down. Inventing
 * an attendance figure from a session count would be a number that looks like
 * measurement and is not.
 */

export default function CatalogueReadiness({ programs }: { programs: TrainingProgram[] }) {
  const active = programs.filter((p) => p.is_active);
  if (active.length === 0) return null;

  const empty = active.filter((p) => p.session_count === 0);
  const scheduled = active.filter((p) => p.session_count > 0);
  const sessions = scheduled.reduce((sum, p) => sum + p.session_count, 0);

  // Is there anything for a chart to show? Something hollow, or counts that
  // differ. Two programmes minimum, because one bar is not a comparison.
  const counts = new Set(active.map((p) => p.session_count));
  const discriminates = active.length > 1 && (empty.length > 0 || counts.size > 1);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            What can actually be attended
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {active.length} active {active.length === 1 ? "programme" : "programmes"} · {sessions}{" "}
            {sessions === 1 ? "session" : "sessions"}
          </Typography>
        </Stack>

        {/* The finding, in words, before the marks. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {empty.length === 0
            ? "Every active programme has at least one session scheduled."
            : `${empty.length} of ${active.length} ${empty.length === 1 ? "programme has" : "programmes have"} no session scheduled — nobody can enrol in ${empty.length === 1 ? "it" : "them"}.`}
        </Typography>

        {/* Columns, which share a baseline and can be pointed at — sessions
            per programme is a count across categories, and width-scaled tiles
            would ask the reader to compare areas instead.

            A programme with nothing scheduled is drawn **hollow**, not at zero:
            it is not a programme with few sessions, it is one nobody can enrol
            in at all.

            The marks appear only when they discriminate — something is missing,
            or the counts vary. A column chart encodes *difference*, so a set of
            equal bars reads as broken scaling rather than as uniformity, and
            the sentence above is then the whole card. */}
        {discriminates ? (
          <Columns
            data={[...empty, ...scheduled].map((program) => ({
              label: program.title,
              value: program.session_count,
              empty: program.session_count === 0,
            }))}
            height={170}
            badge={(column) =>
              column.empty
                ? `${column.label} — nothing scheduled`
                : `${column.label} — ${column.value} session${column.value === 1 ? "" : "s"}`
            }
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
