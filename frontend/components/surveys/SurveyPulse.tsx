"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useState } from "react";

import type { Survey } from "@/hooks/useSurveys";

/**
 * Whether the open surveys are actually collecting anything.
 *
 * **Deliberately not a response *rate*.** A rate needs a denominator — how many
 * people were asked — and the survey payload does not carry one. It would be
 * easy to divide by headcount and print a percentage, and it would be wrong the
 * moment a survey targets one department: the number would look precise, be
 * false, and nobody could tell by looking. So this reports what is actually
 * known — responses, and how long the survey has been open to collect them.
 *
 * **Age is reported beside the count, not plotted against it.** Twelve responses
 * is good on day one and a failure on day thirty, so both numbers have to be
 * there — but a company runs two or three surveys at a time, and a scatter of
 * three points is a chart nobody can read without hovering. A row carries the
 * name, the count, the age and the length at any n.
 *
 * **Drafts are counted but not plotted.** A draft collects nothing by design,
 * so giving it an empty bar would read as a survey that failed rather than one
 * that has not started. It is named in the sentence instead.
 */

function daysOpen(createdAt: string, now: number) {
  const created = new Date(createdAt);
  return Math.max(0, Math.floor((now - created.getTime()) / 86_400_000));
}

export default function SurveyPulse({ surveys }: { surveys: Survey[] }) {
  // Once per mount — see the note in `CycleProgress`; a helper hides the
  // impurity from the linter but not from React.
  const [now] = useState(() => Date.now());

  const active = surveys.filter((s) => s.status === "active");
  const drafts = surveys.filter((s) => s.status === "draft");

  // Nothing open means there is no pulse to take. The list below says the rest.
  if (active.length === 0 && drafts.length === 0) return null;

  const ranked = [...active].sort((a, b) => a.response_count - b.response_count);
  // The busiest survey sets the scale, so the bars compare against each other
  // rather than against a number nobody chose. Floored at 1 so a set of
  // all-zero surveys does not divide by zero.
  const mostResponses = Math.max(1, ...active.map((s) => s.response_count));
  const quietest = ranked[0];

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            What is still collecting
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {active.length} open{drafts.length ? ` · ${drafts.length} draft` : ""}
            {drafts.length > 1 ? "s" : ""}
          </Typography>
        </Stack>

        {/* The finding, in words, first. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {active.length === 0
            ? `Nothing is open — ${drafts.length === 1 ? "a survey is" : `${drafts.length} surveys are`} still in draft and collecting nothing.`
            : quietest && quietest.response_count === 0
              ? `“${quietest.title}” has been open ${daysOpen(quietest.created_at, now)} day${daysOpen(quietest.created_at, now) === 1 ? "" : "s"} with no responses at all.`
              : `Quietest is “${quietest?.title}” — ${quietest?.response_count} response${quietest?.response_count === 1 ? "" : "s"} in ${daysOpen(quietest?.created_at ?? "", now)} day${daysOpen(quietest?.created_at ?? "", now) === 1 ? "" : "s"}.`}
        </Typography>

        {ranked.length === 0 ? null : (
          /* A row per survey rather than a scatter. The pairing a scatter
             would draw is right — twelve responses is good on day one and a
             failure on day thirty — but a scatter needs a population, and a
             company runs two or three surveys at a time: three dots in a 240px
             frame is a chart you have to hover to read.

             A row carries both numbers *and* the name, at three rows
             or at twelve. And it adds the one signal nobody was showing:
             **how many questions it asks**. A twenty-question survey with two
             responses is a different problem from a three-question one with
             two — the first is too long, the second is not being seen — and
             length is the half somebody can actually do something about. */
          <Stack spacing={1.4}>
            {ranked.map((survey) => {
              const age = daysOpen(survey.created_at, now);
              const perDay = age > 0 ? survey.response_count / age : survey.response_count;
              const stalled = age >= 14 && survey.response_count === 0;
              const longForm = survey.questions.length >= 10;
              return (
                <Box key={survey.id}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 0.4 }}>
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }}
                      noWrap
                      title={survey.title}
                    >
                      {survey.title}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}
                    >
                      {survey.response_count}
                    </Typography>
                  </Stack>

                  <Box
                    sx={{
                      position: "relative",
                      height: 8,
                      borderRadius: 1,
                      bgcolor: "action.hover",
                      overflow: "hidden",
                      mb: 0.4,
                    }}
                  >
                    <Box
                      sx={{
                        position: "absolute",
                        inset: 0,
                        width: `${(survey.response_count / mostResponses) * 100}%`,
                        borderRadius: 1,
                        bgcolor: stalled
                          ? "var(--hrms-status-warning-solid)"
                          : "primary.main",
                      }}
                    />
                  </Box>

                  {/* Everything the bar cannot carry, in one line: how long it
                      has had, what that works out at, and how much it asks. */}
                  <Typography variant="caption" color="text.disabled">
                    {age}d open
                    {survey.response_count > 0
                      ? ` · ${perDay >= 1 ? perDay.toFixed(1) : perDay.toFixed(2)} a day`
                      : " · nothing yet"}
                    {" · "}
                    {survey.questions.length}{" "}
                    {survey.questions.length === 1 ? "question" : "questions"}
                    {longForm && survey.response_count === 0 ? " — long, and unanswered" : ""}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
