"use client";

import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * The three short answers, in one card instead of three.
 *
 * Three answers in one card: who is off today, who has just clocked in, and how
 * many are remote. Given a card each they are three framed boxes reading
 * "Everyone is in today", "No check-ins yet today" and "0" — most of a screen
 * row spent saying nothing happened, and empty cards weighted like full ones.
 *
 * **Merged rather than hidden.** Dropping them when empty would be worse — "is
 * anybody off today" is a real question and "nobody" is a real answer, and a
 * card that disappears when the answer is no teaches people not to trust the
 * page. They keep their answers and give up their frames.
 *
 * **Names, not just counts, where there are few enough.** "3 on leave" sends
 * somebody to another screen; three names answer the question here. Past four
 * it becomes a count with a remainder, because a list that scrolls inside a
 * summary card is a list in the wrong place.
 */

// The payload's own shapes, imported rather than restated — a local guess at
// `{ id, name }` would compile and render blanks, because the API sends
// `employee` and `employee_id`.
import type { OnLeaveEntry, RecentCheckin } from "@/types/dashboard";

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function Line({
  label,
  count,
  empty,
  children,
}: {
  label: string;
  count: number;
  empty: string;
  children?: React.ReactNode;
}) {
  return (
    <Box sx={{ py: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: count ? 1 : 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 650 }}>
          {label}
        </Typography>
        <Typography
          sx={{
            fontWeight: 800,
            fontSize: "1.15rem",
            lineHeight: 1,
            // A zero is an answer, not an alarm. Recessive rather than red.
            color: count ? "text.primary" : "text.disabled",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </Typography>
      </Stack>
      {count ? (
        children
      ) : (
        <Typography variant="caption" color="text.secondary">
          {empty}
        </Typography>
      )}
    </Box>
  );
}

export default function RightNowCard({
  onLeave = [],
  checkins = [],
  remoteToday = null,
}: {
  onLeave?: OnLeaveEntry[];
  checkins?: RecentCheckin[];
  /**
   * `null` when the caller does not have the figure — the line is then omitted
   * entirely.
   *
   * Nullable, not defaulted to `0`. `remote_today` lives on the WFH summary
   * rather than this one, and a dashboard that does not fetch it would
   * otherwise print a confident "Nobody is remote today" about data it never
   * loaded.
   */
  remoteToday?: number | null;
}) {
  const shownLeave = onLeave.slice(0, 4);
  const moreLeave = Math.max(onLeave.length - shownLeave.length, 0);

  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.25 }}>
          Right now
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Who is out, who has arrived, who is remote
        </Typography>

        <Divider sx={{ mt: 1.5 }} />

        <Line label="On leave" count={onLeave.length} empty="Everyone is in today.">
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75 }}>
            {shownLeave.map((person) => (
              <Stack
                key={person.employee_id}
                direction="row"
                spacing={0.75}
                sx={{
                  alignItems: "center",
                  pr: 1,
                  pl: 0.5,
                  py: 0.25,
                  borderRadius: 999,
                  bgcolor: "action.hover",
                }}
              >
                <Avatar sx={{ width: 20, height: 20, fontSize: 10 }}>
                  {initials(person.employee)}
                </Avatar>
                <Typography variant="caption" noWrap sx={{ maxWidth: 110 }}>
                  {person.employee}
                </Typography>
              </Stack>
            ))}
            {moreLeave ? (
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                +{moreLeave} more
              </Typography>
            ) : null}
          </Stack>
        </Line>

        <Divider />

        <Line label="Checked in" count={checkins.length} empty="Nobody has clocked in yet.">
          <Stack spacing={0.5}>
            {checkins.slice(0, 3).map((entry) => (
              <Stack key={entry.employee_id} direction="row" sx={{ justifyContent: "space-between" }}>
                <Typography variant="caption" noWrap sx={{ maxWidth: 150 }}>
                  {entry.employee}
                </Typography>
                {entry.time ? (
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {entry.time}
                  </Typography>
                ) : null}
              </Stack>
            ))}
          </Stack>
        </Line>

        {remoteToday === null ? null : (
          <>
            <Divider />
            <Line label="Working remotely" count={remoteToday} empty="Nobody is remote today." />
          </>
        )}
      </CardContent>
    </Card>
  );
}
